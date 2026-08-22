import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// AI Campaigns v1 — AudienceSpec validation, injection detection, provenance
// schema, prompt privacy, auth boundary, and security tests.
//
// A) Real unit tests: IMPORT the production validator (no duplication).
// B) Source structural tests: assert deployed source contains required wiring
//    for all 9 owner-review blockers.
// ---------------------------------------------------------------------------

import {
  validateAudienceSpec,
  containsSqlFragment,
  isUnfilteredSpec,
  isPlausibleEmail,
  canonicalSpecJson,
  normalizeEmail,
  detectPiiPatterns,
  piiRejectionMessage,
  INDUSTRY_CATEGORY_VALUES,
  PROJECT_SEGMENT_VALUES,
  US_STATE_CODES,
  CUSTOMER_STATUS_VALUES,
  MAX_RESULTS_HARD_CAP,
  MAX_RESULTS_DEFAULT,
  BRIEF_MAX_LENGTH,
  type AudienceSpecV1,
} from "../supabase/functions/_shared/audience-spec";

const read = (...parts: string[]) =>
  readFileSync(path.resolve(__dirname, "..", ...parts), "utf8");

async function specHash(spec: AudienceSpecV1): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(canonicalSpecJson(spec)).digest("hex");
}

const validSpec: AudienceSpecV1 = {
  version: 1,
  filters: {
    industry_category_values: ["hospital", "fqhc"],
    project_segment_values: ["rural_hospital"],
    state_values: ["MN", "WI"],
  },
  exclude_customers: true,
  exclude_former_customers: true,
  exclude_partners: true,
  exclude_suppressed: true,
  exclude_active_enrollments: true,
  max_results: 500,
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// A. REAL UNIT TESTS — production functions imported, not duplicated
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("AudienceSpec v1 — enum validation (production validator)", () => {
  it("accepts a valid spec", () => { expect(validateAudienceSpec(validSpec)).toEqual([]); });
  it("rejects unknown industry_category", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { industry_category_values: ["FAKE"] } })
      .some((e) => e.message.includes("unknown value"))).toBe(true);
  });
  it("rejects unknown project_segment", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { project_segment_values: ["MEGA"] } })
      .some((e) => e.message.includes("unknown value"))).toBe(true);
  });
  it("rejects unknown state codes", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { state_values: ["XX"] } })
      .some((e) => e.message.includes("unknown value"))).toBe(true);
  });
  it("rejects non-array filter values", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { industry_category_values: "hospital" } })
      .some((e) => e.message.includes("must be an array"))).toBe(true);
  });
  it("rejects unknown filter keys", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { email_patterns: ["%@hospital%"] } })
      .some((e) => e.message.includes("Unknown filter key"))).toBe(true);
  });
  it("rejects fte_min/fte_max as unknown filter keys", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { fte_min: 50 } }).some((e) => e.field === "filters.fte_min")).toBe(true);
    expect(validateAudienceSpec({ ...validSpec, filters: { fte_max: 500 } }).some((e) => e.field === "filters.fte_max")).toBe(true);
  });
  it("rejects unknown top-level keys", () => {
    expect(validateAudienceSpec({ ...validSpec, raw_sql: "SELECT * FROM contacts" })
      .some((e) => e.message.includes("Unknown spec key"))).toBe(true);
  });
  it("rejects max_results above hard cap", () => {
    expect(validateAudienceSpec({ ...validSpec, max_results: 5000 }).some((e) => e.message.includes("cannot exceed"))).toBe(true);
  });
  it("rejects max_results of 0 or negative", () => {
    expect(validateAudienceSpec({ ...validSpec, max_results: 0 }).length).toBeGreaterThan(0);
    expect(validateAudienceSpec({ ...validSpec, max_results: -1 }).length).toBeGreaterThan(0);
  });
  it("rejects decimal max_results", () => {
    expect(validateAudienceSpec({ ...validSpec, max_results: 500.5 }).some((e) => e.message.includes("positive integer"))).toBe(true);
  });
  it("rejects Infinity and NaN max_results", () => {
    expect(validateAudienceSpec({ ...validSpec, max_results: Infinity }).length).toBeGreaterThan(0);
    expect(validateAudienceSpec({ ...validSpec, max_results: NaN }).length).toBeGreaterThan(0);
  });
  it("rejects exclusion flags set to false", () => {
    for (const flag of ["exclude_customers", "exclude_former_customers", "exclude_partners", "exclude_suppressed", "exclude_active_enrollments"]) {
      expect(validateAudienceSpec({ ...validSpec, [flag]: false }).some((e) => e.field === flag)).toBe(true);
    }
  });
  it("rejects missing version", () => {
    const { version: _, ...noVersion } = validSpec;
    expect(validateAudienceSpec(noVersion).some((e) => e.field === "version")).toBe(true);
  });
  it("accepts empty filters (unfiltered guard is separate)", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: {} })).toEqual([]);
  });
  it("rejects empty arrays (must omit key instead)", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { industry_category_values: [] } })
      .some((e) => e.message.includes("must not be an empty array"))).toBe(true);
  });
  it("rejects null/non-object spec", () => {
    expect(validateAudienceSpec(null).length).toBeGreaterThan(0);
    expect(validateAudienceSpec("string").length).toBeGreaterThan(0);
    expect(validateAudienceSpec(42).length).toBeGreaterThan(0);
  });
  it("rejects non-string values in enum arrays", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { industry_category_values: [123] } })
      .some((e) => e.message.includes("must be strings"))).toBe(true);
  });
  it("rejects empty strings in enum arrays", () => {
    expect(validateAudienceSpec({ ...validSpec, filters: { industry_category_values: ["hospital", ""] } })
      .some((e) => e.message.includes("empty strings"))).toBe(true);
  });
});

describe("ambiguous/unsupported criteria validation", () => {
  it("accepts valid string arrays", () => {
    expect(validateAudienceSpec({ ...validSpec, ambiguous_criteria: ["unclear region"] })).toEqual([]);
  });
  it("rejects non-array", () => {
    expect(validateAudienceSpec({ ...validSpec, ambiguous_criteria: "not array" }).some((e) => e.field === "ambiguous_criteria")).toBe(true);
  });
  it("rejects non-string entries", () => {
    expect(validateAudienceSpec({ ...validSpec, unsupported_criteria: [42] }).some((e) => e.field === "unsupported_criteria")).toBe(true);
  });
  it("rejects empty strings", () => {
    expect(validateAudienceSpec({ ...validSpec, ambiguous_criteria: ["valid", "  "] }).some((e) => e.message.includes("empty strings"))).toBe(true);
  });
  it("rejects SQL fragments", () => {
    expect(validateAudienceSpec({ ...validSpec, unsupported_criteria: ["SELECT * FROM contacts"] }).some((e) => e.message.includes("SQL fragment"))).toBe(true);
  });
});

describe("SQL injection detection (production containsSqlFragment)", () => {
  it.each([
    ["; DROP TABLE contacts;", true],
    ["SELECT * FROM users", true],
    ["hospital' UNION SELECT * --", true],
    ["hospital ILIKE '%test%'", true],
    ["%hospital%", true],
    ["' OR 1=1", true],
    ["x != y", true],
    ["hospital <> 'test'", true],
  ])("detects %s as injection = %s", (input, expected) => {
    expect(containsSqlFragment(input)).toBe(expected);
  });

  it.each([
    ["hospital", false],
    ["rural_hospital", false],
    ["fqhc", false],
    ["MN", false],
    ["community_health_center", false],
  ])("allows clean value %s", (input, expected) => {
    expect(containsSqlFragment(input)).toBe(expected);
  });
});

describe("isUnfilteredSpec — empty-spec guard", () => {
  it("true for empty filters", () => { expect(isUnfilteredSpec({ ...validSpec, filters: {} })).toBe(true); });
  it("false when any filter populated", () => {
    expect(isUnfilteredSpec({ ...validSpec, filters: { industry_category_values: ["hospital"] } })).toBe(false);
    expect(isUnfilteredSpec({ ...validSpec, filters: { state_values: ["MN"] } })).toBe(false);
  });
});

describe("isPlausibleEmail — invalid email exclusion", () => {
  it("accepts valid emails", () => { expect(isPlausibleEmail("user@example.com")).toBe(true); });
  it("rejects missing @", () => { expect(isPlausibleEmail("userexample.com")).toBe(false); });
  it("rejects empty/null", () => {
    expect(isPlausibleEmail("")).toBe(false);
    expect(isPlausibleEmail(null as unknown as string)).toBe(false);
  });
  it("rejects domain without dot", () => { expect(isPlausibleEmail("user@localhost")).toBe(false); });
});

describe("canonical hash (production canonicalSpecJson)", () => {
  it("produces 64-char hex", async () => { expect(await specHash(validSpec)).toMatch(/^[0-9a-f]{64}$/); });
  it("is deterministic", async () => { expect(await specHash(validSpec)).toBe(await specHash(validSpec)); });
  it("is order-independent", async () => {
    const a = { ...validSpec, filters: { industry_category_values: ["fqhc", "hospital"] } } as AudienceSpecV1;
    const b = { ...validSpec, filters: { industry_category_values: ["hospital", "fqhc"] } } as AudienceSpecV1;
    expect(await specHash(a)).toBe(await specHash(b));
  });
  it("changes when values change", async () => {
    const a = { ...validSpec, filters: { industry_category_values: ["hospital"] } } as AudienceSpecV1;
    const b = { ...validSpec, filters: { industry_category_values: ["fqhc"] } } as AudienceSpecV1;
    expect(await specHash(a)).not.toBe(await specHash(b));
  });
  it("excludes fte from canonical JSON", () => { expect(canonicalSpecJson(validSpec)).not.toContain("fte"); });
});

describe("normalizeEmail (production)", () => {
  it("lowercases and trims", () => { expect(normalizeEmail("  Foo@Bar.COM  ")).toBe("foo@bar.com"); });
  it("handles null/undefined", () => { expect(normalizeEmail(null)).toBe(""); expect(normalizeEmail(undefined)).toBe(""); });
});

describe("Exported constants (production)", () => {
  it("correct counts", () => {
    expect(INDUSTRY_CATEGORY_VALUES.length).toBe(81);
    expect(PROJECT_SEGMENT_VALUES.length).toBe(12);
    expect(US_STATE_CODES.length).toBe(51);
    expect([...CUSTOMER_STATUS_VALUES]).toEqual(["client", "prospect", "former_client"]);
    expect(MAX_RESULTS_HARD_CAP).toBe(2000);
    expect(MAX_RESULTS_DEFAULT).toBe(500);
    expect(BRIEF_MAX_LENGTH).toBe(2000);
  });
});

// ── Blocker 3: PII detection (production detectPiiPatterns) ───────────────

describe("PII detection guard (production detectPiiPatterns)", () => {
  it("detects email addresses", () => {
    const found = detectPiiPatterns("Send to john.doe@hospital.org in Minnesota");
    expect(found).toContain("email address");
  });

  it("detects US phone numbers", () => {
    expect(detectPiiPatterns("Call 612-555-1234 for details")).toContain("phone number");
    expect(detectPiiPatterns("Phone: (612) 555-1234")).toContain("phone number");
    expect(detectPiiPatterns("Call +1 612.555.1234")).toContain("phone number");
  });

  it("detects SSN patterns", () => {
    expect(detectPiiPatterns("SSN is 123-45-6789")).toContain("Social Security number");
  });

  it("detects multiple PII types at once", () => {
    const found = detectPiiPatterns("Email jane@test.com or call 555-123-4567");
    expect(found).toContain("email address");
    expect(found).toContain("phone number");
    expect(found.length).toBe(2);
  });

  it("returns empty for clean briefs", () => {
    expect(detectPiiPatterns("Hospitals in Minnesota with over 500 employees")).toEqual([]);
    expect(detectPiiPatterns("Rural FQHCs in the Pacific Northwest")).toEqual([]);
    expect(detectPiiPatterns("")).toEqual([]);
  });

  it("does not false-positive on non-PII numbers", () => {
    // Short numbers and years should not trigger phone detection
    expect(detectPiiPatterns("Organizations with 500 FTEs founded in 2020")).toEqual([]);
  });

  it("handles null/undefined without throwing", () => {
    expect(detectPiiPatterns(null as unknown as string)).toEqual([]);
    expect(detectPiiPatterns(undefined as unknown as string)).toEqual([]);
  });
});

describe("piiRejectionMessage", () => {
  it("produces actionable guidance", () => {
    const msg = piiRejectionMessage(["email address"]);
    expect(msg).toContain("email address");
    expect(msg).toContain("Remove personal contact information");
  });

  it("joins multiple PII types", () => {
    const msg = piiRejectionMessage(["email address", "phone number"]);
    expect(msg).toContain("email address and phone number");
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// B. SOURCE STRUCTURAL TESTS — all 9 owner-review blockers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Blocker 1: Retention redaction uses NULL (not literal string)", () => {
  const migration = read("supabase", "migrations", "20260822020000_campaign_audience_provenance.sql");

  it("email_normalized is nullable (no NOT NULL)", () => {
    // Extract the members table definition
    const membersTable = migration.slice(
      migration.indexOf("create table if not exists public.campaign_audience_run_members"),
      migration.indexOf("create index if not exists idx_audience_members_run"),
    );
    // Should NOT have "email_normalized text not null"
    expect(membersTable).not.toMatch(/email_normalized\s+text\s+not null/);
    // Should have email_normalized as a column
    expect(membersTable).toContain("email_normalized");
  });

  it("redaction sets email_normalized = null (not literal string)", () => {
    const redactFn = migration.slice(
      migration.indexOf("function public.audience_run_redact_expired"),
      migration.indexOf("revoke all on function public.audience_run_redact_expired"),
    );
    // Must use NULL, not 'redacted'
    expect(redactFn).toContain("email_normalized = null");
    expect(redactFn).not.toContain("email_normalized = 'redacted'");
  });

  it("UNIQUE(run_id, email_normalized) exists — multiple NULLs are safe", () => {
    expect(migration).toContain("unique (run_id, email_normalized)");
  });

  it("RPC validates email_normalized NOT NULL on insert", () => {
    const rpc = migration.slice(
      migration.indexOf("function public.create_audience_run_with_members"),
      migration.indexOf("revoke all on function public.create_audience_run_with_members"),
    );
    expect(rpc).toContain("non-empty email_normalized on insert");
  });
});

describe("Blocker 2: Interpretation provenance binding", () => {
  const migration = read("supabase", "migrations", "20260822020000_campaign_audience_provenance.sql");
  const edgeFn = read("supabase", "functions", "playbook-ai", "index.ts");

  it("interpretation table exists with required columns", () => {
    expect(migration).toContain("create table if not exists public.campaign_audience_interpretations");
    expect(migration).toContain("brief");
    expect(migration).toContain("spec_hash");
    expect(migration).toContain("consumed_at");
    expect(migration).toContain("consumed_by_run_id");
    expect(migration).toContain("expires_at");
  });

  it("create_audience_interpretation RPC exists (service_role only)", () => {
    expect(migration).toContain("create_audience_interpretation");
    expect(migration).toContain("revoke all on function public.create_audience_interpretation");
    expect(migration).toContain("grant execute on function public.create_audience_interpretation");
    expect(migration).toContain("to service_role");
  });

  it("run table has interpretation_id FK", () => {
    const runsTable = migration.slice(
      migration.indexOf("create table if not exists public.campaign_audience_runs"),
      migration.indexOf("create index if not exists idx_audience_runs_user"),
    );
    expect(runsTable).toContain("interpretation_id");
  });

  it("RPC binds interpretation atomically: FOR UPDATE, ownership, expiry, consumed checks", () => {
    const rpc = migration.slice(
      migration.indexOf("function public.create_audience_run_with_members"),
      migration.indexOf("revoke all on function public.create_audience_run_with_members"),
    );
    expect(rpc).toContain("for update");
    expect(rpc).toContain("Interpretation belongs to a different user");
    expect(rpc).toContain("Interpretation already consumed");
    expect(rpc).toContain("Interpretation has expired");
  });

  it("manual path forces model_id='manual' and raw_prompt=NULL in SQL", () => {
    const rpc = migration.slice(
      migration.indexOf("function public.create_audience_run_with_members"),
      migration.indexOf("revoke all on function public.create_audience_run_with_members"),
    );
    expect(rpc).toMatch(/v_model_id\s+:= 'manual'/);
    expect(rpc).toMatch(/v_raw_prompt\s+:= null/);
  });

  it("interpret-audience stores interpretation via RPC and returns interpretation_id", () => {
    const interpFn = edgeFn.slice(
      edgeFn.indexOf("async function interpretAudience"),
      edgeFn.indexOf("// ── AI Audience: resolve-audience"),
    );
    expect(interpFn).toContain("create_audience_interpretation");
    expect(interpFn).toContain("interpretation_id: interpId");
  });

  it("resolve-audience accepts interpretation_id (AI path) or spec (manual path)", () => {
    const handler = edgeFn.slice(
      edgeFn.indexOf('action === "resolve-audience"'),
      edgeFn.indexOf("return json({ error: `Unknown action"),
    );
    expect(handler).toContain("interpretation_id");
    expect(handler).toContain("AI path");
    expect(handler).toContain("manual path");
    // Never accepts client model_id or raw_prompt on resolve
    expect(handler).not.toContain("body.model_id");
    expect(handler).not.toContain("body.raw_prompt");
  });

  it("resolveAudience loads interpretation and passes interpretation_id to RPC", () => {
    const resolveFn = edgeFn.slice(
      edgeFn.indexOf("async function resolveAudience"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(resolveFn).toContain("campaign_audience_interpretations");
    expect(resolveFn).toContain("p_interpretation_id: interpretationId");
    // Does NOT set model_id or raw_prompt — SQL RPC handles that
    expect(resolveFn).not.toContain("model_id: resolveModelId");
    expect(resolveFn).not.toContain("raw_prompt:");
  });

  it("cleanup preserves consumed interpretations (durable audit), only deletes expired unconsumed", () => {
    const cleanupFn = migration.slice(
      migration.indexOf("function public.audience_interpretation_cleanup"),
      migration.indexOf("revoke all on function public.audience_interpretation_cleanup"),
    );
    // Must only delete expired unconsumed — never consumed records
    expect(cleanupFn).toContain("consumed_at is null");
    expect(cleanupFn).not.toContain("consumed_at is not null");
    // Comment block (between section header and function signature)
    // must document the durable audit rationale
    const sectionStart = migration.indexOf("── 9. RPC: audience_interpretation_cleanup");
    const fnStart = migration.indexOf("create or replace function public.audience_interpretation_cleanup");
    const cleanupComment = migration.slice(sectionStart, fnStart);
    expect(cleanupComment).toContain("NEVER");
    expect(cleanupComment).toContain("durable audit");
  });

  it("90-day redaction RPC redacts consumed interpretation briefs (not deletes them)", () => {
    const redactFn = migration.slice(
      migration.indexOf("function public.audience_run_redact_expired"),
      migration.indexOf("revoke all on function public.audience_run_redact_expired"),
    );
    // Must redact brief on consumed interpretations past retention
    expect(redactFn).toContain("campaign_audience_interpretations");
    expect(redactFn).toContain("[redacted]");
    // Must NOT delete consumed interpretations
    expect(redactFn).not.toContain("delete from public.campaign_audience_interpretations");
  });
});

describe("Blocker 3: PII guard on brief", () => {
  const edgeFn = read("supabase", "functions", "playbook-ai", "index.ts");

  it("interpretAudience calls detectPiiPatterns before AI call", () => {
    const interpFn = edgeFn.slice(
      edgeFn.indexOf("async function interpretAudience"),
      edgeFn.indexOf("// ── AI Audience: resolve-audience"),
    );
    // PII check must appear before callClaude
    const piiIdx = interpFn.indexOf("detectPiiPatterns");
    const claudeIdx = interpFn.indexOf("callClaude");
    expect(piiIdx).toBeGreaterThan(-1);
    expect(claudeIdx).toBeGreaterThan(-1);
    expect(piiIdx).toBeLessThan(claudeIdx);
  });

  it("imports detectPiiPatterns and piiRejectionMessage", () => {
    expect(edgeFn).toContain("detectPiiPatterns");
    expect(edgeFn).toContain("piiRejectionMessage");
  });
});

describe("Blocker 4: Case-insensitive enrollment matching", () => {
  const migration = read("supabase", "migrations", "20260822020000_campaign_audience_provenance.sql");
  const edgeFn = read("supabase", "functions", "playbook-ai", "index.ts");

  it("check_active_enrollments_normalized RPC exists (service_role only)", () => {
    expect(migration).toContain("check_active_enrollments_normalized");
    expect(migration).toContain("lower(trim(ce.email))");
    expect(migration).toContain("revoke all on function public.check_active_enrollments_normalized");
  });

  it("functional index on lower(trim(email)) exists", () => {
    expect(migration).toContain("idx_campaign_enrollments_email_lower_active");
    expect(migration).toContain("lower(trim(email))");
    expect(migration).toContain('where status = \'active\'');
  });

  it("resolveAudience uses the normalized RPC (not raw .in())", () => {
    const resolveFn = edgeFn.slice(
      edgeFn.indexOf("async function resolveAudience"),
      edgeFn.indexOf("// ── HTTP handler"),
    );
    expect(resolveFn).toContain("check_active_enrollments_normalized");
    // Must NOT use the old .from("campaign_enrollments").in("email", ...) pattern
    expect(resolveFn).not.toContain('.from("campaign_enrollments")');
  });
});

describe("Blocker 5: True keyset pagination + truncation probe", () => {
  const edgeFn = read("supabase", "functions", "playbook-ai", "index.ts");
  const resolveFn = edgeFn.slice(
    edgeFn.indexOf("async function resolveAudience"),
    edgeFn.indexOf("// ── HTTP handler"),
  );

  it("uses .gt('id', lastContactId) for keyset pagination", () => {
    expect(resolveFn).toContain('.gt("id", lastContactId)');
    expect(resolveFn).toContain(".limit(CONTACT_PAGE)");
  });

  it("does NOT use .range() for contact pagination", () => {
    const contactLoop = resolveFn.slice(
      resolveFn.indexOf("while (totalScanned < SCAN_HARD_CAP)"),
      resolveFn.indexOf("// 4. Service-role checks"),
    );
    expect(contactLoop).not.toContain(".range(");
  });

  it("truthful truncation probe at SCAN_HARD_CAP queries for one more row", () => {
    expect(resolveFn).toContain("Truthful truncation probe");
    expect(resolveFn).toContain(".limit(1)");
    expect(resolveFn).toContain("probe");
  });

  it("processes the cap-th contact before probing (no pre-process break)", () => {
    // The for-loop body must NOT break before processing the contact.
    // The truncation check happens AFTER the for-loop (outside), not inside it.
    const contactLoop = resolveFn.slice(
      resolveFn.indexOf("while (totalScanned < SCAN_HARD_CAP)"),
      resolveFn.indexOf("// 4. Service-role checks"),
    );
    const forBody = contactLoop.slice(
      contactLoop.indexOf("for (const c of contacts)"),
      contactLoop.indexOf("if (contacts.length < CONTACT_PAGE)"),
    );
    // The for-loop body must not contain the truncation probe —
    // it happens after the for-loop completes the page.
    expect(forBody).not.toContain("Truthful truncation probe");
    // The for-loop body must process: accounts, email, disposition, push
    expect(forBody).toContain("c.accounts");
    expect(forBody).toContain("normalizeEmail");
    expect(forBody).toContain("members.push");
  });
});

describe("Retention RPCs and scheduling policy", () => {
  const migration = read("supabase", "migrations", "20260822020000_campaign_audience_provenance.sql");

  it("redaction and cleanup RPCs exist as service-role-only", () => {
    expect(migration).toContain("audience_run_redact_expired");
    expect(migration).toContain("audience_interpretation_cleanup");
    expect(migration).toContain("to service_role");
  });

  it("schedules retention idempotently via pg_cron (Staging-only migration)", () => {
    expect(migration).toContain("cron.schedule");
    expect(migration).toContain("audience-provenance-redact-daily");
    expect(migration).toContain("audience-interpretations-cleanup-daily");
    // Unschedule before schedule for idempotency
    expect(migration).toContain("cron.unschedule");
  });

  it("documents Staging-only scope and Production requires approval", () => {
    expect(migration).toContain("Staging-only");
    expect(migration).toContain("Nathan");
  });
});

describe("Blocker 7: user_id ON DELETE SET NULL (audit survives user deletion)", () => {
  const migration = read("supabase", "migrations", "20260822020000_campaign_audience_provenance.sql");

  it("runs table: user_id is nullable with ON DELETE SET NULL", () => {
    const runsStart = migration.indexOf("create table if not exists public.campaign_audience_runs");
    const runsEnd = migration.indexOf("alter table public.campaign_audience_interpretations", runsStart);
    const runsTable = migration.slice(runsStart, runsEnd);
    expect(runsTable).toContain("on delete set null");
    expect(runsTable).not.toContain("user_id              uuid not null");
  });

  it("interpretations table: user_id is nullable with ON DELETE SET NULL", () => {
    const interpTable = migration.slice(
      migration.indexOf("create table if not exists public.campaign_audience_interpretations"),
      migration.indexOf("create index if not exists idx_audience_interp_user"),
    );
    expect(interpTable).toContain("on delete set null");
  });

  it("RLS: orphaned runs (user_id NULL) are admin-only visible", () => {
    // Rep policy: user_id = auth.uid() — NULL != anything → invisible to non-admin
    // Admin policy: is_admin() — independent of user_id
    expect(migration).toContain("user_id = (select auth.uid())");
    expect(migration).toContain("(select public.is_admin())");
  });

  it("RPC still requires user_id on insert", () => {
    const rpc = migration.slice(
      migration.indexOf("function public.create_audience_run_with_members"),
      migration.indexOf("revoke all on function public.create_audience_run_with_members"),
    );
    expect(rpc).toContain("user_id is required");
  });
});

describe("Blocker 8: SQL-level validation in RPC", () => {
  const migration = read("supabase", "migrations", "20260822020000_campaign_audience_provenance.sql");
  const rpc = migration.slice(
    migration.indexOf("function public.create_audience_run_with_members"),
    migration.indexOf("revoke all on function public.create_audience_run_with_members"),
  );

  it("validates summary arithmetic: total_matched = sum of dispositions", () => {
    expect(rpc).toContain("Summary arithmetic mismatch");
    expect(rpc).toContain("total_eligible");
    expect(rpc).toContain("total_excluded");
    expect(rpc).toContain("total_ambiguous");
    expect(rpc).toContain("total_active_enrollment");
  });

  it("validates member dispositions against allowed set", () => {
    expect(rpc).toContain("Invalid member disposition value");
    expect(rpc).toContain("'eligible','excluded','ambiguous','duplicate','active_enrollment'");
  });

  it("validates member count matches total_matched after insert", () => {
    expect(rpc).toContain("Member count");
    expect(rpc).toContain("does not match total_matched");
    expect(rpc).toContain("get diagnostics v_member_count = row_count");
  });

  it("validates spec is a JSON object (manual path)", () => {
    expect(rpc).toContain("spec must be a JSON object");
    expect(rpc).toContain("jsonb_typeof");
  });

  it("validates spec_hash with hex regex, not just length", () => {
    // Must use a regex pattern like ^[0-9a-f]{64}$, not just length check
    expect(rpc).toContain("!~ '^[0-9a-f]{64}$'");
    expect(rpc).toContain("lowercase hex string");
  });

  it("interpretation RPC also validates spec_hash with hex regex", () => {
    const interpRpc = migration.slice(
      migration.indexOf("function public.create_audience_interpretation"),
      migration.indexOf("revoke all on function public.create_audience_interpretation"),
    );
    expect(interpRpc).toContain("!~ '^[0-9a-f]{64}$'");
  });
});

describe("Blocker 9: Cross-cutting structural guarantees", () => {
  const migration = read("supabase", "migrations", "20260822020000_campaign_audience_provenance.sql");
  const edgeFn = read("supabase", "functions", "playbook-ai", "index.ts");

  it("immutability triggers use GUC bypass (race-safe, not disable trigger)", () => {
    expect(migration).toContain("app.audience_provenance_rpc");
    expect(migration).not.toContain("disable trigger");
  });

  it("transaction wrapping with PostgREST notify", () => {
    expect(migration.indexOf("begin;")).toBeLessThan(migration.indexOf("commit;"));
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });

  it("anon blocked from all provenance tables", () => {
    expect(migration).toContain("revoke all on public.campaign_audience_runs from anon");
    expect(migration).toContain("revoke all on public.campaign_audience_run_members from anon");
    expect(migration).toContain("revoke all on public.campaign_audience_interpretations from anon");
  });

  it("RLS InitPlan wraps on all tables", () => {
    const adminPolicies = migration.match(/\(select public\.is_admin\(\)\)/g) ?? [];
    const uidPolicies = migration.match(/\(select auth\.uid\(\)\)/g) ?? [];
    // 3 tables × 1 admin policy + 3 tables × 1 owner policy
    expect(adminPolicies.length).toBeGreaterThanOrEqual(3);
    expect(uidPolicies.length).toBeGreaterThanOrEqual(3);
  });

  it("all existing playbook-ai actions still dispatched", () => {
    for (const a of ["generate-ideas", "generate-campaign", "suggest-campaign", "regenerate-email", "analyze-campaign", "campaign-insights"]) {
      expect(edgeFn).toContain(`action === "${a}"`);
    }
  });
});

describe("Prompt privacy — no CRM rows, no contradictions", () => {
  const prompts = read("supabase", "functions", "_shared", "playbook-prompts.ts");
  it("single audienceInterpretSystem", () => { expect((prompts.match(/export function audienceInterpretSystem/g) ?? []).length).toBe(1); });
  it("prohibits SQL/ILIKE/contact IDs", () => { expect(prompts).toContain("NEVER output SQL"); });
  it("regions go to ambiguous_criteria", () => { expect(prompts).not.toContain("list the individual state codes"); });
  it("FTE unsupported, no fte in output format", () => {
    expect(prompts).toContain("company size by FTE");
    const of = prompts.slice(prompts.indexOf("OUTPUT FORMAT"), prompts.indexOf("Only include filter keys"));
    expect(of).not.toContain("fte_min");
  });
});

describe("interpretAudience — reject, never clean up", () => {
  const edgeFn = read("supabase", "functions", "playbook-ai", "index.ts");
  const fn = edgeFn.slice(edgeFn.indexOf("async function interpretAudience"), edgeFn.indexOf("// ── AI Audience: resolve-audience"));
  it("throws on validation errors", () => { expect(fn).toContain("Invalid model output"); expect(fn).not.toContain(".filter((v) =>"); });
  it("no inline containsSqlFragment", () => { expect(fn).not.toContain("containsSqlFragment"); });
});

describe("resolveAudience — structural guarantees", () => {
  const edgeFn = read("supabase", "functions", "playbook-ai", "index.ts");
  const fn = edgeFn.slice(edgeFn.indexOf("async function resolveAudience"), edgeFn.indexOf("// ── AI Audience: generate-audience-draft"));

  it("unfiltered spec guard", () => { expect(fn).toContain("isUnfilteredSpec"); expect(fn).toContain("would match all contacts"); });
  it("invalid email exclusion", () => { expect(fn).toContain("isPlausibleEmail"); });
  it("no server-side .in() for targeting (NULL ambiguity)", () => { expect(fn).not.toContain('.in("accounts.industry_category"'); });
  it("canonical duplicate representation (no embedded IDs)", () => { expect(fn).toContain('"duplicate_contact"'); expect(fn).not.toContain("duplicate_contact:${"); });
  it("authoritative partner source", () => { expect(fn).toContain('"v_partner_accounts"'); expect(fn).not.toContain('.startsWith("partner")'); });
  it("transactional RPC (not direct insert)", () => { expect(fn).toContain("create_audience_run_with_members"); expect(fn).not.toContain('.from("campaign_audience_runs")'); });
  it("no Smartlead, no launch", () => { expect(fn.toLowerCase()).not.toContain("smartlead"); });
  it("max_results cap", () => { expect(fn).toContain('"over_max_results_cap"'); });
});
