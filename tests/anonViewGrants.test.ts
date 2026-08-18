import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Regression guard for the 2026-07-10 security fix (migration
// 20260710162000_anon_revoke_and_invoker_definer_views.sql): six public
// SECURITY-DEFINER views were readable by the anon role over PostgREST,
// exposing customer PII, contract dollars and pipeline data with no login.
//
// This test scans the migration history (in timestamp order) and asserts
// that, for each of those views, the LAST anon-relevant statement is a
// revoke (or the view was dropped) — so a future migration that re-grants
// anon, or recreates one of these views without re-revoking, fails CI.
//
// It understands both literal statements ("revoke select on public.x from
// anon") and the guarded dynamic form used by the fix migrations
// (execute format('revoke select on public.%I from anon', v) over an
// array of view names).

const MIGRATIONS_DIR = path.resolve(__dirname, "../supabase/migrations");

const PROTECTED_VIEWS = [
  "account_contracts",
  "v_accounts_status_unset",
  "pipeline_summary",
  "data_health_check",
  "v_lead_last_activity",
  "v_field_inventory",
  // Revoked by the sibling migration 20260710164000, and recreated by
  // 20260727120000 to expose the auto-renewal flags — guarded here so any
  // future `create or replace` of it must re-revoke anon too.
  "active_pipeline",
  // Definer view over cron.job (20260727150000) — schedule visibility for
  // signed-in admins only; anon must never see the job inventory.
  "v_cron_jobs_admin",
] as const;

// Views converted to security_invoker so caller RLS applies (the other two
// stay definer on purpose: data_health_check counts archived rows for the
// admin page, v_field_inventory reads information_schema).
const INVOKER_VIEWS = [
  "account_contracts",
  "v_accounts_status_unset",
  "pipeline_summary",
  "v_lead_last_activity",
] as const;

type Event = { file: string; kind: "grant-anon" | "revoke-anon" | "drop" };

const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort(); // timestamp-prefixed names sort chronologically

const contents = new Map<string, string>(
  files.map((f) => [
    f,
    // strip SQL comments so commentary about grants/revokes never counts
    fs
      .readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")
      .replace(/--[^\n]*/g, "")
      .toLowerCase(),
  ]),
);

function mentionsViewInArrayOrLiteral(sql: string, view: string): boolean {
  // 'view_name' inside a foreach array, or public.view_name literally
  return sql.includes(`'${view}'`) || sql.includes(`public.${view}`);
}

function eventsFor(view: string): Event[] {
  const events: Event[] = [];
  for (const file of files) {
    const sql = contents.get(file)!;
    // literal GRANT ... TO ...anon...
    const grantRe = new RegExp(
      `grant\\s+select\\s+on\\s+(?:public\\.)?${view}\\s+to\\s+[^;]*\\banon\\b`,
    );
    if (grantRe.test(sql)) events.push({ file, kind: "grant-anon" });

    // literal REVOKE
    const revokeRe = new RegExp(
      `revoke\\s+select\\s+on\\s+(?:public\\.)?${view}\\s+from\\s+[^;]*\\banon\\b`,
    );
    // dynamic guarded form: execute format('revoke ... %i ... from anon', v)
    const dynamicRevoke =
      sql.includes("revoke select on public.%i from anon") &&
      sql.includes(`'${view}'`);
    if (revokeRe.test(sql) || dynamicRevoke)
      events.push({ file, kind: "revoke-anon" });

    const dropRe = new RegExp(
      `drop\\s+view\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${view}\\b`,
    );
    if (dropRe.test(sql)) events.push({ file, kind: "drop" });
  }
  return events;
}

describe("anon grants on report/diagnostic views", () => {
  for (const view of PROTECTED_VIEWS) {
    it(`${view}: last anon-relevant migration revokes anon (or drops the view)`, () => {
      const events = eventsFor(view);
      expect(
        events.length,
        `no grant/revoke/drop history found for ${view} — was it renamed?`,
      ).toBeGreaterThan(0);
      const last = events[events.length - 1];
      expect(
        last.kind,
        `latest migration touching anon access for ${view} is ${last.file} (${last.kind}); ` +
          `anon must not end up with SELECT on this view`,
      ).not.toBe("grant-anon");
      expect(events.some((e) => e.kind !== "grant-anon")).toBe(true);
    });
  }

  // ── Full-inventory guard (survey T9, 2026-08-17) ──────────────────────
  //
  // The list above is the 2026-07-10 incident set; this block guards ALL
  // views. Two rules, derived from how Supabase grants actually behave:
  //
  //  * A view whose latest CREATE predates the default-privileges door
  //    (migration 20260817103000) was born with an automatic anon SELECT
  //    grant, so it must show an explicit anon revoke somewhere in the
  //    history (grants survive CREATE OR REPLACE, so a revoke at any
  //    point covers later or-replaces) — or be dropped.
  //  * A view created after the door is born without the grant, so it
  //    only fails if some migration explicitly GRANTs anon afterwards
  //    without a following revoke.
  //
  // Statement-level parsing handles the comma-list form
  // ("revoke select on public.a, public.b from anon") that a naive
  // one-view regex misses — that exact form protects v_mql_leads_qtd and
  // v_mql_dedup (20260616000001).
  const DOOR_MIGRATION = "20260817103000";

  type ViewHistory = {
    lastCreate: string;
    droppedAfterCreate: boolean;
    lastAnonEvent: "grant" | "revoke" | null;
    lastAnonEventFile: string;
    everRevoked: boolean;
  };

  function allViewHistories(): Map<string, ViewHistory> {
    const hist = new Map<string, ViewHistory>();
    const nameRe = /(?:public\.)?([a-z_][a-z0-9_]*)/g;
    for (const file of files) {
      const sql = contents.get(file)!;
      // creates
      for (const m of sql.matchAll(
        /create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/g,
      )) {
        const prev = hist.get(m[1]);
        hist.set(m[1], {
          lastCreate: file,
          droppedAfterCreate: false,
          lastAnonEvent: prev?.lastAnonEvent ?? null,
          lastAnonEventFile: prev?.lastAnonEventFile ?? "",
          everRevoked: prev?.everRevoked ?? false,
        });
      }
      // drops
      for (const m of sql.matchAll(
        /drop\s+(?:materialized\s+)?view\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/g,
      )) {
        const v = hist.get(m[1]);
        if (v) v.droppedAfterCreate = true;
      }
      // clause-level grant/revoke mentioning anon (comma lists included;
      // matches anywhere in a statement, so revokes nested inside DO
      // blocks — e.g. 20260727120000's guarded re-revoke — count too)
      for (const m of sql.matchAll(
        /\b(grant|revoke)\s+[^;]*?\bon\s+([^;]*?)\s+(to|from)\s+([^;]*)/g,
      )) {
        const [, verb, onPart, dir, rolePart] = m;
        if (!/\banon\b/.test(rolePart)) continue;
        const isGrant = verb === "grant" && dir === "to";
        const isRevoke = verb === "revoke" && dir === "from";
        if (!isGrant && !isRevoke) continue;
        for (const nm of onPart.matchAll(nameRe)) {
          const v = hist.get(nm[1]);
          if (!v) continue;
          v.lastAnonEvent = isGrant ? "grant" : "revoke";
          v.lastAnonEventFile = file;
          if (isRevoke) v.everRevoked = true;
        }
      }
      // dynamic guarded revoke over an array of quoted names
      if (
        sql.includes("revoke select on public.%i from anon") ||
        sql.includes("revoke all on public.%i from anon")
      ) {
        for (const nm of sql.matchAll(/'([a-z_][a-z0-9_]*)'/g)) {
          const v = hist.get(nm[1]);
          if (!v) continue;
          v.lastAnonEvent = "revoke";
          v.lastAnonEventFile = file;
          v.everRevoked = true;
        }
      }
    }
    return hist;
  }

  it("every live view is unreadable by anon (revoked, or born after the default-privileges door)", () => {
    const hist = allViewHistories();
    const offenders: string[] = [];
    for (const [name, v] of hist) {
      if (v.droppedAfterCreate) continue;
      if (v.lastAnonEvent === "grant") {
        offenders.push(
          `${name}: last anon event is a GRANT (${v.lastAnonEventFile})`,
        );
        continue;
      }
      const bornBeforeDoor = v.lastCreate.slice(0, 14) < DOOR_MIGRATION;
      if (bornBeforeDoor && !v.everRevoked) {
        offenders.push(
          `${name}: created ${v.lastCreate} (pre-door, auto-granted to anon) with no revoke anywhere in history`,
        );
      }
    }
    expect(
      offenders,
      `anon-readable view candidates — add "revoke all on public.<view> from anon" ` +
        `to a migration for each:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  for (const view of INVOKER_VIEWS) {
    it(`${view}: ends with security_invoker = on (caller RLS applies)`, () => {
      let lastState: "on" | "off" | null = null;
      let lastStateFile = "";
      for (const file of files) {
        const sql = contents.get(file)!;
        const literalOn = new RegExp(
          `alter\\s+view\\s+(?:public\\.)?${view}\\s+set\\s*\\(\\s*security_invoker\\s*=\\s*on`,
        ).test(sql);
        const dynamicOn =
          sql.includes("set (security_invoker = on)") &&
          sql.includes("%i") &&
          mentionsViewInArrayOrLiteral(sql, view);
        const literalOff = new RegExp(
          `alter\\s+view\\s+(?:public\\.)?${view}\\s+set\\s*\\(\\s*security_invoker\\s*=\\s*off`,
        ).test(sql);
        if (literalOn || dynamicOn) {
          lastState = "on";
          lastStateFile = file;
        }
        if (literalOff) {
          lastState = "off";
          lastStateFile = file;
        }
      }
      // A drop after the last invoker-on is fine (view gone entirely).
      const events = eventsFor(view);
      const dropped =
        events.length > 0 && events[events.length - 1].kind === "drop";
      if (dropped) return;
      expect(
        lastState,
        `${view} must have security_invoker = on set by a migration ` +
          `(last seen: ${lastStateFile || "never"})`,
      ).toBe("on");
    });
  }
});
