import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateCloseReadiness,
  getEnforcedCloseKeys,
  checkCloseReadiness,
  formatCloseReadinessMessage,
  CLOSE_READINESS_KEYS,
  type CloseReadinessKey,
} from "@/lib/closeReadiness";

const ALL: CloseReadinessKey[] = [...CLOSE_READINESS_KEYS];

// A "complete" account + one emailed contact — the passing baseline the
// individual cases below each break in exactly one way.
const fullAccount = {
  phone: "801-555-0100",
  fte_range: "51-100",
  billing_street: "123 Main St",
  billing_city: "Provo",
  billing_state: "UT",
  billing_zip: "84601",
};
const emailedContact = { is_primary: true, first_name: "Jane", last_name: "Doe", email: "jane@acme.com" };

describe("evaluateCloseReadiness (pure decision logic)", () => {
  it("passes when the account and a contact email are complete", () => {
    expect(evaluateCloseReadiness(ALL, fullAccount, [emailedContact])).toEqual([]);
  });

  it("blocks with a clear message when the account row is missing", () => {
    expect(evaluateCloseReadiness(ALL, null, [])).toEqual([
      "Account information could not be loaded",
    ]);
  });

  it("flags a blank phone", () => {
    expect(evaluateCloseReadiness(ALL, { ...fullAccount, phone: "" }, [emailedContact])).toEqual([
      "Account phone number",
    ]);
  });

  it("treats a whitespace-only phone as blank", () => {
    expect(evaluateCloseReadiness(ALL, { ...fullAccount, phone: "   " }, [emailedContact])).toEqual([
      "Account phone number",
    ]);
  });

  it("flags a blank FTE range", () => {
    expect(evaluateCloseReadiness(ALL, { ...fullAccount, fte_range: null }, [emailedContact])).toEqual([
      "FTE range",
    ]);
  });

  it("requires street, city, state AND zip for the billing address", () => {
    for (const missingCol of ["billing_street", "billing_city", "billing_state", "billing_zip"] as const) {
      const acct = { ...fullAccount, [missingCol]: "" };
      expect(evaluateCloseReadiness(ALL, acct, [emailedContact])).toEqual(["Billing address"]);
    }
  });

  it("accepts a complete billing address", () => {
    expect(
      evaluateCloseReadiness(["account_billing_address"], fullAccount, []),
    ).toEqual([]);
  });

  it("flags a missing contact email when the account has no contacts", () => {
    expect(evaluateCloseReadiness(["contact_email"], fullAccount, [])).toEqual([
      "A contact email address",
    ]);
  });

  it("is satisfied by any of email / email2 / email3", () => {
    expect(
      evaluateCloseReadiness(["contact_email"], fullAccount, [
        { is_primary: false, email: null, email2: null, email3: "backup@acme.com" },
      ]),
    ).toEqual([]);
  });

  it("is satisfied by a NON-primary contact's email even if the primary has none", () => {
    expect(
      evaluateCloseReadiness(["contact_email"], fullAccount, [
        { is_primary: true, first_name: "Pat", last_name: "Lee", email: null },
        { is_primary: false, first_name: "Sam", last_name: "Ng", email: "sam@acme.com" },
      ]),
    ).toEqual([]);
  });

  it("names the primary contact in the message when nobody has an email", () => {
    expect(
      evaluateCloseReadiness(["contact_email"], fullAccount, [
        { is_primary: true, first_name: "Jane", last_name: "Doe", email: "", email2: "  ", email3: null },
      ]),
    ).toEqual(["A contact email address (primary contact Jane Doe has none)"]);
  });

  it("falls back to the generic label when there is no primary contact", () => {
    expect(
      evaluateCloseReadiness(["contact_email"], fullAccount, [
        { is_primary: false, first_name: "Al", last_name: "Roe", email: "" },
      ]),
    ).toEqual(["A contact email address"]);
  });

  it("only enforces the configured subset of keys", () => {
    // Everything blank, but only phone is enforced -> only phone is flagged.
    const blank = { phone: "", fte_range: "", billing_street: "", billing_city: "", billing_state: "", billing_zip: "" };
    expect(evaluateCloseReadiness(["account_phone"], blank, [])).toEqual(["Account phone number"]);
  });

  it("reports multiple missing items in key order", () => {
    const blank = { phone: "", fte_range: "", billing_street: "", billing_city: "", billing_state: "", billing_zip: "" };
    expect(evaluateCloseReadiness(ALL, blank, [])).toEqual([
      "Account phone number",
      "Billing address",
      "FTE range",
      "A contact email address",
    ]);
  });

  it("returns no missing items when the enforced key set is empty", () => {
    const blank = { phone: "", fte_range: "", billing_street: "", billing_city: "", billing_state: "", billing_zip: "" };
    expect(evaluateCloseReadiness([], blank, [])).toEqual([]);
  });
});

describe("formatCloseReadinessMessage", () => {
  it("returns an empty string when nothing is missing", () => {
    expect(formatCloseReadinessMessage([])).toBe("");
  });

  it("lists the missing items and points at the account", () => {
    const msg = formatCloseReadinessMessage(["Account phone number", "FTE range"]);
    expect(msg).toContain("Closed Won");
    expect(msg).toContain("Account phone number, FTE range");
    expect(msg.toLowerCase()).toContain("open the account");
  });
});

// --- Lightweight Supabase mock (no network) --------------------------------
// Each table resolves to a preset { data, error }. The builder is a thenable
// and also exposes .maybeSingle(), mirroring how the checker awaits it.
function mockClient(tables: Record<string, { data: unknown; error: unknown }>): SupabaseClient {
  function builder(result: { data: unknown; error: unknown }) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      is: () => b,
      maybeSingle: () => Promise.resolve(result),
      then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onF, onR),
    };
    return b;
  }
  return {
    from: (table: string) => builder(tables[table] ?? { data: null, error: null }),
  } as unknown as SupabaseClient;
}

describe("getEnforcedCloseKeys (config-driven)", () => {
  it("enforces all four when config rows are absent", async () => {
    const client = mockClient({ required_field_config: { data: [], error: null } });
    expect(await getEnforcedCloseKeys(client)).toEqual(ALL);
  });

  it("enforces all four when the config query errors", async () => {
    const client = mockClient({ required_field_config: { data: null, error: { message: "boom" } } });
    expect(await getEnforcedCloseKeys(client)).toEqual(ALL);
  });

  it("enforces only the configured subset of known keys", async () => {
    const client = mockClient({
      required_field_config: {
        data: [{ field_key: "account_phone" }, { field_key: "contact_email" }],
        error: null,
      },
    });
    expect(await getEnforcedCloseKeys(client)).toEqual(["account_phone", "contact_email"]);
  });

  it("ignores unknown keys and falls back to all four if none are known", async () => {
    const client = mockClient({
      required_field_config: { data: [{ field_key: "some_future_key" }], error: null },
    });
    expect(await getEnforcedCloseKeys(client)).toEqual(ALL);
  });
});

describe("checkCloseReadiness (wiring + fallback)", () => {
  it("returns not-ready with a clear message when accountId is missing", async () => {
    const client = mockClient({});
    expect(await checkCloseReadiness(client, null)).toEqual({
      ready: false,
      missing: ["Account information could not be loaded"],
    });
  });

  it("enforces all four when config is absent and blocks an incomplete account", async () => {
    // Mirrors the live staging state: no config rows yet, account missing
    // phone + FTE, and no contacts -> phone, FTE, and contact email flagged.
    const client = mockClient({
      required_field_config: { data: [], error: null },
      accounts: {
        data: {
          phone: null,
          fte_range: null,
          billing_street: "123 Main St",
          billing_city: "Provo",
          billing_state: "UT",
          billing_zip: "84601",
        },
        error: null,
      },
      contacts: { data: [], error: null },
    });
    const res = await checkCloseReadiness(client, "acct-1");
    expect(res.ready).toBe(false);
    expect(res.missing).toEqual(["Account phone number", "FTE range", "A contact email address"]);
  });

  it("returns ready when the account is complete and a contact has an email", async () => {
    const client = mockClient({
      required_field_config: { data: [], error: null },
      accounts: { data: fullAccount, error: null },
      contacts: { data: [emailedContact], error: null },
    });
    expect(await checkCloseReadiness(client, "acct-1")).toEqual({ ready: true, missing: [] });
  });

  it("blocks when the account row cannot be loaded", async () => {
    const client = mockClient({
      required_field_config: { data: [], error: null },
      accounts: { data: null, error: { message: "rls" } },
    });
    const res = await checkCloseReadiness(client, "acct-1");
    expect(res.ready).toBe(false);
    expect(res.missing).toEqual(["Account information could not be loaded"]);
  });
});
