import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";

/**
 * Regression guards for the service-role auth convention in edge functions
 * and the failure-visibility convention in cron workflows.
 *
 * Background: exact-string-matching the service-role key
 * (`authHeader === `Bearer ${SERVICE_ROLE_KEY}``) breaks whenever the
 * project's injected key differs from the caller's stored key (key
 * rotation, Supabase's dual legacy-vs-new keys, stray whitespace in a GH
 * secret). That mismatch caused the 2026-07-05 email-sync outage. The
 * repo convention (see supabase/functions/sync-emails/index.ts) is to
 * deploy with JWT verification ON and trust the gateway-verified token's
 * `role` claim instead.
 *
 * Separately, cron workflows must call curl with -f so an HTTP >=400 from
 * the function fails the Action instead of staying silently green — the
 * other half of the same outage class.
 */

const repoRoot = path.resolve(__dirname, "..");
const functionsDir = path.join(repoRoot, "supabase", "functions");
const workflowsDir = path.join(repoRoot, ".github", "workflows");

function edgeFunctionSources(): { name: string; source: string }[] {
  return readdirSync(functionsDir)
    .filter((entry) => {
      const indexPath = path.join(functionsDir, entry, "index.ts");
      try {
        return statSync(indexPath).isFile();
      } catch {
        return false;
      }
    })
    .map((entry) => ({
      name: entry,
      source: readFileSync(path.join(functionsDir, entry, "index.ts"), "utf8"),
    }));
}

describe("edge function service-role auth convention", () => {
  const fns = edgeFunctionSources();

  it("finds edge functions to scan (sanity)", () => {
    expect(fns.length).toBeGreaterThan(10);
  });

  it("no edge function exact-matches the service-role key as an auth gate", () => {
    // The literal template `Bearer ${...SERVICE_ROLE_KEY}` used in a
    // comparison is the outage-causing anti-pattern. (Using the key to
    // BUILD an outbound Authorization header is fine — this only flags
    // equality comparisons against the incoming header.)
    const antiPattern = /===\s*`Bearer \$\{\s*(?:SUPABASE_)?SERVICE_ROLE_KEY\s*\}`/;
    const offenders = fns.filter((f) => antiPattern.test(f.source)).map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it("every isServiceRole gate trusts the verified role claim instead", () => {
    const gated = fns.filter((f) => /function isServiceRole\b/.test(f.source));
    // The three playbook functions + sync-emails + outlook-calendar-sync
    // all define this gate today; keep the floor so a rename doesn't
    // silently skip the check.
    expect(gated.length).toBeGreaterThanOrEqual(5);
    for (const f of gated) {
      expect(f.source, `${f.name} isServiceRole must check the token's role claim`).toMatch(
        /role\s*===\s*["']service_role["']/,
      );
    }
  });
});

describe("cron workflow failure visibility", () => {
  it("no scheduled workflow invokes curl silently (bare -s without -f)", () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(workflowsDir)) {
      if (!/\.ya?ml$/.test(entry)) continue;
      const source = readFileSync(path.join(workflowsDir, entry), "utf8");
      // `curl -s ` swallows HTTP errors (exit 0 on a 401/403/500);
      // the convention is `curl -fsS` so failures fail the step (or are
      // at least printed, where a step deliberately stays green).
      if (/curl -s /.test(source)) offenders.push(entry);
    }
    expect(offenders).toEqual([]);
  });
});
