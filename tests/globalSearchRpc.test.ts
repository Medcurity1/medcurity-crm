import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Static guard for the global_search_v2 RPC
// (supabase/migrations/20260817120000_global_search_v2.sql).
//
// This function is reachable from every signed-in browser session and takes a
// raw user string, so three properties are load-bearing and easy to break in a
// later "quick fix":
//
//  1. SECURITY INVOKER. A definer search function would hand every caller the
//     owner's visibility over accounts, contacts, deals and email bodies,
//     silently defeating RLS. The house rule (20260817103000, and
//     anonViewGrants.test.ts for views) is that nothing readable is exposed
//     past the caller's own permissions.
//  2. anon cannot execute it. Same incident class as the 2026-07-10
//     anon-readable views.
//  3. ILIKE wildcards in user input are escaped. Unescaped, a typed "%" turns
//     `%q%` into `%%%` and matches every row in the table — a whole-table
//     scan plus a nonsense result list, triggerable by anyone typing a percent
//     sign.
//
// Comments are stripped before matching so the migration's own prose (which
// says things like "deliberately NOT definer") can never satisfy or trip an
// assertion.

const MIGRATION = path.resolve(
  __dirname,
  "../supabase/migrations/20260817120000_global_search_v2.sql",
);

const raw = fs.readFileSync(MIGRATION, "utf8");
const sql = raw.replace(/--[^\n]*/g, "").toLowerCase();

describe("global_search_v2 RPC migration", () => {
  it("is declared SECURITY INVOKER and never definer", () => {
    expect(sql).toMatch(/security\s+invoker/);
    expect(sql).not.toMatch(/security\s+definer/);
  });

  it("revokes execute from public and anon, and grants only authenticated", () => {
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.global_search_v2[^;]*from[^;]*\bpublic\b[^;]*\banon\b/,
    );
    expect(sql).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.global_search_v2[^;]*to\s+authenticated/,
    );
    // No grant that hands the function to anon.
    expect(sql).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.global_search_v2[^;]*to[^;]*\banon\b/,
    );
  });

  it("escapes ILIKE wildcards in the user-supplied query", () => {
    // Backslash must be doubled FIRST, otherwise the escapes added for % and _
    // get re-escaped and match literally.
    const backslash = sql.indexOf("'\\', '\\\\'");
    const percent = sql.indexOf("'%', '\\%'");
    const underscore = sql.indexOf("'_', '\\_'");
    expect(backslash, "backslash escape missing").toBeGreaterThan(-1);
    expect(percent, "% escape missing").toBeGreaterThan(-1);
    expect(underscore, "_ escape missing").toBeGreaterThan(-1);
    expect(backslash, "backslash must be escaped before % and _").toBeLessThan(
      percent,
    );
    expect(backslash).toBeLessThan(underscore);
  });

  it("gives every ILIKE an explicit ESCAPE clause", () => {
    const ilikes = sql.match(/\bilike\b/g)?.length ?? 0;
    const escapes = sql.match(/escape\s+'\\'/g)?.length ?? 0;
    expect(ilikes, "expected the function to use ILIKE").toBeGreaterThan(0);
    expect(
      escapes,
      `${ilikes} ILIKE(s) but ${escapes} ESCAPE clause(s) — every pattern built from user input needs one`,
    ).toBe(ilikes);
  });

  it("caps every group instead of counting the whole table", () => {
    // Four per-group CTEs, each bounded, so `total` is min(matches, 50) and no
    // keystroke can trigger an unbounded count(*) over activities.
    const caps = sql.match(/limit\s+50/g)?.length ?? 0;
    expect(caps, "each of the 4 group CTEs must carry `limit 50`").toBe(4);
  });

  it("returns all four groups", () => {
    for (const group of ["accounts", "contacts", "opportunities", "activities"]) {
      expect(sql).toMatch(new RegExp(`'${group}',\\s*jsonb_build_object`));
    }
  });

  it("only searches activity bodies at >= 3 characters", () => {
    expect(sql).toMatch(/length\(raw\)\s*>=\s*3/);
  });

  it("is idempotent (re-runnable)", () => {
    expect(sql).toMatch(/create\s+extension\s+if\s+not\s+exists\s+pg_trgm/);
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.global_search_v2/);
    const indexes = sql.match(/create\s+index\s+if\s+not\s+exists/g)?.length ?? 0;
    const allIndexes = sql.match(/create\s+index/g)?.length ?? 0;
    expect(indexes, "every create index must be `if not exists`").toBe(allIndexes);
  });
});
