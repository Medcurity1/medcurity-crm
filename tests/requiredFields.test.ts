import { describe, it, expect } from "vitest";
import { getMissingRequiredFields, formatFieldLabel } from "@/lib/requiredFields";
import { accountSchema } from "@/features/accounts/schema";
import { leadSchema } from "@/features/leads/schema";
import { opportunitySchema } from "@/features/opportunities/schema";

describe("getMissingRequiredFields", () => {
  describe("create mode (no original record)", () => {
    it("flags every required key with an empty submitted value", () => {
      const missing = getMissingRequiredFields(
        ["name", "owner_user_id", "status"],
        { name: "", owner_user_id: null, status: undefined },
      );
      expect(missing).toEqual(["name", "owner_user_id", "status"]);
    });

    it("passes when all required keys have non-empty values", () => {
      const missing = getMissingRequiredFields(
        ["name", "owner_user_id"],
        { name: "Acme", owner_user_id: "user-1" },
      );
      expect(missing).toEqual([]);
    });

    it("does not treat 0 or false as empty", () => {
      const missing = getMissingRequiredFields(
        ["employees", "priority_account"],
        { employees: 0, priority_account: false },
      );
      expect(missing).toEqual([]);
    });

    it("behaves the same whether original is omitted, undefined, or null", () => {
      const values = { name: "" };
      expect(getMissingRequiredFields(["name"], values)).toEqual(["name"]);
      expect(getMissingRequiredFields(["name"], values, undefined)).toEqual(["name"]);
      expect(getMissingRequiredFields(["name"], values, null)).toEqual(["name"]);
    });
  });

  describe("edit mode (with original record)", () => {
    it("grandfathers a field that was already empty on the original record", () => {
      // Jordan's bug: an imported account with a null owner must stay
      // editable even after owner_user_id becomes a required field.
      const missing = getMissingRequiredFields(
        ["name", "owner_user_id", "status", "employees"],
        { name: "Acme", owner_user_id: null, status: "active", employees: 50 },
        { name: "Acme (old)", owner_user_id: null, status: null, employees: null },
      );
      expect(missing).toEqual([]);
    });

    it("blocks clearing a field that had a value on the original record", () => {
      const missing = getMissingRequiredFields(
        ["owner_user_id"],
        { owner_user_id: "" },
        { owner_user_id: "user-1" },
      );
      expect(missing).toEqual(["owner_user_id"]);
    });

    it("allows a previously-empty field to be filled in", () => {
      const missing = getMissingRequiredFields(
        ["owner_user_id"],
        { owner_user_id: "user-1" },
        { owner_user_id: null },
      );
      expect(missing).toEqual([]);
    });

    it("allows a previously-filled field to keep its (unchanged) value", () => {
      const missing = getMissingRequiredFields(
        ["owner_user_id"],
        { owner_user_id: "user-1" },
        { owner_user_id: "user-1" },
      );
      expect(missing).toEqual([]);
    });

    it("treats a required key missing from the original object as grandfathered", () => {
      const missing = getMissingRequiredFields(
        ["owner_user_id"],
        { owner_user_id: "" },
        { name: "Acme" }, // no owner_user_id key at all
      );
      expect(missing).toEqual([]);
    });

    it("does not treat 0 or false as empty when clearing would otherwise be blocked", () => {
      const missing = getMissingRequiredFields(
        ["employees", "priority_account"],
        { employees: 0, priority_account: false },
        { employees: 50, priority_account: true },
      );
      expect(missing).toEqual([]);
    });

    it("only returns the fields actually being cleared, not every required key", () => {
      const missing = getMissingRequiredFields(
        ["name", "owner_user_id", "status", "employees"],
        { name: "Acme", owner_user_id: "", status: "active", employees: null },
        { name: "Acme", owner_user_id: "user-1", status: null, employees: null },
      );
      // owner_user_id: was filled, now cleared -> blocks
      // status: was empty originally -> grandfathered even though filled now
      // employees: was empty originally, still empty -> grandfathered
      expect(missing).toEqual(["owner_user_id"]);
    });
  });

  describe("edge cases", () => {
    it("returns an empty array for an empty requiredKeys list", () => {
      expect(getMissingRequiredFields([], { name: "" })).toEqual([]);
    });
  });
});

describe("required numeric fields through the form schemas", () => {
  // The gate runs on POST-zod values. Bare z.coerce.number() used to
  // turn a blank input ("") into 0, so a required numeric field left
  // blank on create was never flagged. These tests pin the fixed
  // end-to-end behavior: blank survives parsing as null (flagged),
  // explicit 0 stays 0 (a real value, never flagged).
  const minimalAccount = { name: "Acme", lifecycle_status: "prospect" };
  const minimalLead = { first_name: "Ada", last_name: "Lovelace", status: "new" };
  const minimalOpp = {
    account_id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    team: "sales",
    kind: "new_business",
    name: "Acme — SRA",
    stage: "details_analysis",
  };

  it("flags a required account numeric field left blank on create", () => {
    const parsed = accountSchema.parse({ ...minimalAccount, employees: "" });
    expect(parsed.employees).toBeNull();
    expect(getMissingRequiredFields(["employees"], parsed)).toEqual(["employees"]);
  });

  it("accepts an explicit 0 in a required account numeric field", () => {
    const parsed = accountSchema.parse({ ...minimalAccount, employees: "0" });
    expect(parsed.employees).toBe(0);
    expect(getMissingRequiredFields(["employees"], parsed)).toEqual([]);
  });

  it("still parses real numeric input from the form (string in, number out)", () => {
    const parsed = accountSchema.parse({ ...minimalAccount, employees: "250" });
    expect(parsed.employees).toBe(250);
  });

  it("keeps the grandfather rule on edit: blank numeric on a previously-empty record passes", () => {
    const parsed = accountSchema.parse({ ...minimalAccount, employees: "" });
    const original = { name: "Acme", employees: null };
    expect(getMissingRequiredFields(["employees"], parsed, original)).toEqual([]);
  });

  it("blocks clearing a numeric field that had a value, instead of silently saving 0", () => {
    const parsed = accountSchema.parse({ ...minimalAccount, employees: "" });
    const original = { name: "Acme", employees: 50 };
    expect(getMissingRequiredFields(["employees"], parsed, original)).toEqual(["employees"]);
  });

  it("flags a required lead numeric field left blank on create", () => {
    const parsed = leadSchema.parse({ ...minimalLead, employees: "" });
    expect(parsed.employees).toBeNull();
    expect(getMissingRequiredFields(["employees"], parsed)).toEqual(["employees"]);
  });

  it("flags a blank opportunity amount on create, but not an explicit 0", () => {
    const blank = opportunitySchema.parse({ ...minimalOpp, amount: "" });
    expect(blank.amount).toBeNull();
    expect(getMissingRequiredFields(["amount"], blank)).toEqual(["amount"]);

    const zero = opportunitySchema.parse({ ...minimalOpp, amount: "0" });
    expect(zero.amount).toBe(0);
    expect(getMissingRequiredFields(["amount"], zero)).toEqual([]);
  });

  it("keeps blank optional opportunity numerics as null instead of 0", () => {
    const parsed = opportunitySchema.parse({
      ...minimalOpp,
      amount: "1200",
      probability: "",
      discount: "",
      subtotal: "",
      fte_count: "",
    });
    expect(parsed.probability).toBeNull();
    expect(parsed.discount).toBeNull();
    expect(parsed.subtotal).toBeNull();
    expect(parsed.fte_count).toBeNull();
  });

  it("still rejects non-numeric garbage", () => {
    expect(accountSchema.safeParse({ ...minimalAccount, employees: "abc" }).success).toBe(false);
    expect(opportunitySchema.safeParse({ ...minimalOpp, amount: "abc" }).success).toBe(false);
  });
});

describe("formatFieldLabel", () => {
  it("special-cases owner_user_id to 'owner'", () => {
    expect(formatFieldLabel("owner_user_id")).toBe("owner");
  });

  it("strips a trailing _id suffix", () => {
    expect(formatFieldLabel("account_id")).toBe("account");
    expect(formatFieldLabel("primary_contact_id")).toBe("primary contact");
  });

  it("replaces underscores with spaces", () => {
    expect(formatFieldLabel("expected_close_date")).toBe("expected close date");
  });

  it("leaves a plain key unchanged aside from underscore replacement", () => {
    expect(formatFieldLabel("name")).toBe("name");
    expect(formatFieldLabel("status")).toBe("status");
  });

  it("never throws on junk input", () => {
    // @ts-expect-error deliberately passing bad input to prove it's total
    expect(() => formatFieldLabel(null)).not.toThrow();
    // @ts-expect-error deliberately passing bad input to prove it's total
    expect(() => formatFieldLabel(undefined)).not.toThrow();
    expect(formatFieldLabel("")).toBe("");
  });
});
