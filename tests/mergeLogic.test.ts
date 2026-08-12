import { describe, it, expect } from "vitest";
import {
  MERGE_FIELDS,
  buildDefaultPicks,
  buildFieldChoices,
  buildFieldRows,
  classifyPair,
  conflictCount,
  defaultSideFor,
  isBlankValue,
  recommendSurvivor,
} from "@/features/accounts/merge/merge-logic";

// A pair with one of every state:
//   phone     -> only A has it
//   website   -> only B has it
//   industry  -> identical
//   name      -> conflict
//   fax       -> both blank
const A = { name: "Extivita RTP", phone: "919-555-0100", website: "", industry: "Hospital", fax: null };
const B = { name: "Extivita-RTP, LLC", phone: null, website: "extivita.org", industry: "Hospital", fax: "" };

describe("classifyPair / isBlankValue", () => {
  it("treats null, undefined and whitespace as blank; 0 and false as real", () => {
    expect(isBlankValue(null)).toBe(true);
    expect(isBlankValue(undefined)).toBe(true);
    expect(isBlankValue("   ")).toBe(true);
    expect(isBlankValue(0)).toBe(false);
    expect(isBlankValue(false)).toBe(false);
  });

  it("classifies every combination", () => {
    expect(classifyPair("x", null)).toBe("only_a");
    expect(classifyPair("", "y")).toBe("only_b");
    expect(classifyPair(null, "  ")).toBe("both_blank");
    expect(classifyPair("same", "same")).toBe("identical");
    expect(classifyPair(" same ", "same")).toBe("identical"); // trim-insensitive
    expect(classifyPair("one", "two")).toBe("conflict");
    expect(classifyPair(5, 5)).toBe("identical");
    expect(classifyPair(5, 6)).toBe("conflict");
  });
});

describe("buildFieldRows", () => {
  it("emits one row per whitelisted field, blanks included", () => {
    const rows = buildFieldRows(A, B);
    expect(rows.length).toBe(MERGE_FIELDS.length);
    const byKey = Object.fromEntries(rows.map((r) => [r.def.key, r.state]));
    expect(byKey.phone).toBe("only_a");
    expect(byKey.website).toBe("only_b");
    expect(byKey.industry).toBe("identical");
    expect(byKey.name).toBe("conflict");
    expect(byKey.fax).toBe("both_blank");
    // Fields absent from both objects still get a row, shown as blank.
    expect(byKey.billing_street).toBe("both_blank");
  });
});

describe("default selection", () => {
  it("populated side wins when only one side has a value, regardless of survivor", () => {
    expect(defaultSideFor("only_a", "b")).toBe("a");
    expect(defaultSideFor("only_b", "a")).toBe("b");
  });

  it("survivor side wins ties: identical, conflict, both blank", () => {
    for (const state of ["identical", "conflict", "both_blank"] as const) {
      expect(defaultSideFor(state, "a")).toBe("a");
      expect(defaultSideFor(state, "b")).toBe("b");
    }
  });

  it("buildDefaultPicks covers every row and flips with the survivor", () => {
    const rows = buildFieldRows(A, B);
    const withA = buildDefaultPicks(rows, "a");
    const withB = buildDefaultPicks(rows, "b");
    expect(Object.keys(withA).length).toBe(rows.length);
    expect(withA.name).toBe("a");
    expect(withB.name).toBe("b");
    // one-sided values do NOT flip
    expect(withA.phone).toBe("a");
    expect(withB.phone).toBe("a");
    expect(withA.website).toBe("b");
    expect(withB.website).toBe("b");
  });
});

describe("buildFieldChoices (the RPC payload)", () => {
  const rows = buildFieldRows(A, B);

  it("is EMPTY when defaults keep everything the survivor already has", () => {
    // Survivor A + defaults: only 'website' (only_b) differs from A's blank.
    const picks = buildDefaultPicks(rows, "a");
    const choices = buildFieldChoices(rows, picks, "a");
    expect(choices).toEqual({ website: "extivita.org" });
  });

  it("sends the loser's value only for explicitly swapped fields", () => {
    const picks = { ...buildDefaultPicks(rows, "a"), name: "b" as const };
    const choices = buildFieldChoices(rows, picks, "a");
    expect(choices.name).toBe("Extivita-RTP, LLC");
    expect(choices.website).toBe("extivita.org");
    expect(Object.keys(choices).sort()).toEqual(["name", "website"]);
  });

  it("picking the blank side over a populated survivor value sends an explicit null", () => {
    const picks = { ...buildDefaultPicks(rows, "a"), phone: "b" as const };
    const choices = buildFieldChoices(rows, picks, "a");
    expect(choices.phone).toBeNull();
  });

  it("identical values and both-blank rows never enter the payload", () => {
    const picks = { ...buildDefaultPicks(rows, "a"), industry: "b" as const, fax: "b" as const };
    const choices = buildFieldChoices(rows, picks, "a");
    expect("industry" in choices).toBe(false);
    expect("fax" in choices).toBe(false);
  });

  it("trims string values on the way out", () => {
    const rows2 = buildFieldRows({ name: "Acme  " }, { name: " Acme Health" });
    const choices = buildFieldChoices(rows2, { name: "b" }, "a");
    expect(choices.name).toBe("Acme Health");
  });

  it("payload keys are always a subset of the whitelist (client mirror of the server guard)", () => {
    const allB = Object.fromEntries(rows.map((r) => [r.def.key, "b" as const]));
    const choices = buildFieldChoices(rows, allB, "a");
    const allowed = new Set(MERGE_FIELDS.map((f) => f.key));
    for (const k of Object.keys(choices)) expect(allowed.has(k)).toBe(true);
  });
});

describe("recommendSurvivor", () => {
  const base = { id: "aaa", created_at: "2024-01-01T00:00:00Z", has_closed_won: false };

  it("a record with a won deal beats one without, even if newer", () => {
    expect(
      recommendSurvivor(
        { ...base, id: "new-won", created_at: "2026-01-01T00:00:00Z", has_closed_won: true },
        { ...base, id: "old-lost", created_at: "2020-01-01T00:00:00Z" },
      ),
    ).toBe("a");
  });

  it("older record wins when neither (or both) have won deals", () => {
    expect(
      recommendSurvivor(
        { ...base, id: "x", created_at: "2020-01-01T00:00:00Z" },
        { ...base, id: "y", created_at: "2024-01-01T00:00:00Z" },
      ),
    ).toBe("a");
    expect(
      recommendSurvivor(
        { ...base, id: "x", created_at: "2024-01-01T00:00:00Z", has_closed_won: true },
        { ...base, id: "y", created_at: "2020-01-01T00:00:00Z", has_closed_won: true },
      ),
    ).toBe("b");
  });

  it("is deterministic on a full tie (id order)", () => {
    expect(
      recommendSurvivor(
        { ...base, id: "aaa" },
        { ...base, id: "bbb" },
      ),
    ).toBe("a");
  });
});

describe("conflictCount", () => {
  it("counts only genuine disagreements", () => {
    expect(conflictCount(buildFieldRows(A, B))).toBe(1); // just name
  });
});

describe("intentional exclusions", () => {
  it("system, financial-summary and workflow fields are NOT mergeable", () => {
    const keys = new Set(MERGE_FIELDS.map((f) => f.key));
    for (const forbidden of [
      "account_number", "customer_status", "customer_status_override",
      "archived_at", "created_at", "updated_at", "custom_fields",
      "sales_active", "sales_status", "next_follow_up_date",
      "acv", "lifetime_value", "churn_amount", "churn_date",
      "current_contract_start_date", "current_contract_end_date",
      "billing_latitude", "billing_longitude",
      "do_not_contact", "partner_prospect", // OR'd server-side, never choosable
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
  });
});
