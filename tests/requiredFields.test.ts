import { describe, it, expect } from "vitest";
import { getMissingRequiredFields, formatFieldLabel } from "@/lib/requiredFields";

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
