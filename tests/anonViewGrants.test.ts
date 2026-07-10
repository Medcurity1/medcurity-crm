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
