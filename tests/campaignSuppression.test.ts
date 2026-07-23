import { describe, it, expect } from "vitest";
import {
  partitionSuppression,
  groupSuppressionReasons,
  normalizeEmail,
  suppressionReasonLabel,
  type SuppressionEntry,
} from "@/features/playbook/suppression";

// ---------------------------------------------------------------------------
// Campaigns overhaul S2 — "never email the Do-Not-Email list" safety rail.
// partitionSuppression is the shared logic both CampaignRecipients.tsx
// (client) and playbook-smartlead/index.ts's `launch` action (server,
// hand-mirrored — Deno can't import this file) run against
// v_marketing_suppression results. These tests pin its contract so a future
// change to either side can be checked against the same expectations.
// ---------------------------------------------------------------------------

interface TestRecipient {
  email: string;
  label?: string; // just to prove non-email fields survive partitioning
}

const getEmail = (r: TestRecipient) => r.email;

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Foo@Bar.COM  ")).toBe("foo@bar.com");
  });

  it("handles null/undefined-ish input without throwing", () => {
    // @ts-expect-error deliberately passing bad input to prove it's total
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("groupSuppressionReasons", () => {
  it("collapses multiple reasons for the same (normalized) email", () => {
    const rows: SuppressionEntry[] = [
      { email: "a@x.com", reason: "customer_account" },
      { email: "A@X.com", reason: "contact_do_not_contact" },
      { email: " a@x.com ", reason: "customer_account" }, // dupe reason, different whitespace
    ];
    const grouped = groupSuppressionReasons(rows);
    expect(grouped.get("a@x.com")).toEqual(["customer_account", "contact_do_not_contact"]);
  });

  it("keeps distinct emails separate", () => {
    const rows: SuppressionEntry[] = [
      { email: "a@x.com", reason: "customer_account" },
      { email: "b@x.com", reason: "lead_avoid" },
    ];
    const grouped = groupSuppressionReasons(rows);
    expect(grouped.size).toBe(2);
    expect(grouped.get("b@x.com")).toEqual(["lead_avoid"]);
  });
});

describe("suppressionReasonLabel", () => {
  it("returns the known plain-English label for a reason code", () => {
    expect(suppressionReasonLabel("customer_account")).toBe("customer");
    expect(suppressionReasonLabel("contact_do_not_contact")).toBe("do not contact");
  });

  it("falls back to a de-underscored version of an unknown reason code", () => {
    expect(suppressionReasonLabel("some_future_reason")).toBe("some future reason");
  });
});

describe("partitionSuppression", () => {
  it("puts everyone in eligible when suppression is empty", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com" }, { email: "b@x.com" }];
    const result = partitionSuppression(recipients, getEmail, []);
    expect(result.eligible).toEqual(recipients);
    expect(result.dropped).toEqual([]);
    expect(result.overridden).toEqual([]);
  });

  it("returns all-empty partitions for an empty recipient list", () => {
    const result = partitionSuppression<TestRecipient>([], getEmail, [
      { email: "a@x.com", reason: "customer_account" },
    ]);
    expect(result).toEqual({ eligible: [], dropped: [], overridden: [] });
  });

  it("drops a recipient matched in suppression, with no override", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com" }, { email: "b@x.com" }];
    const suppression: SuppressionEntry[] = [{ email: "a@x.com", reason: "customer_account" }];
    const result = partitionSuppression(recipients, getEmail, suppression);
    expect(result.eligible).toEqual([{ email: "b@x.com" }]);
    expect(result.dropped).toEqual([{ email: "a@x.com" }]);
    expect(result.overridden).toEqual([]);
  });

  it("matches on normalized email — differing case/whitespace between recipient and suppression row still matches", () => {
    const recipients: TestRecipient[] = [{ email: "  Foo@Bar.COM " }];
    const suppression: SuppressionEntry[] = [{ email: "foo@bar.com", reason: "lead_avoid" }];
    const result = partitionSuppression(recipients, getEmail, suppression);
    expect(result.dropped).toEqual(recipients);
    expect(result.eligible).toEqual([]);
  });

  it("matches on normalized email the other direction — messy suppression row email, clean recipient email", () => {
    const recipients: TestRecipient[] = [{ email: "foo@bar.com" }];
    const suppression: SuppressionEntry[] = [{ email: " FOO@BAR.com  ", reason: "lead_avoid" }];
    const result = partitionSuppression(recipients, getEmail, suppression);
    expect(result.dropped).toEqual(recipients);
  });

  it("override precedence: an overridden suppressed email moves to `overridden`, not `dropped`", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com" }, { email: "b@x.com" }];
    const suppression: SuppressionEntry[] = [
      { email: "a@x.com", reason: "customer_account" },
      { email: "b@x.com", reason: "contact_do_not_contact" },
    ];
    const result = partitionSuppression(recipients, getEmail, suppression, ["a@x.com"]);
    expect(result.eligible).toEqual([]);
    expect(result.dropped).toEqual([{ email: "b@x.com" }]);
    expect(result.overridden).toEqual([{ email: "a@x.com" }]);
  });

  it("override matching is also normalized (case/whitespace-insensitive)", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com" }];
    const suppression: SuppressionEntry[] = [{ email: "a@x.com", reason: "customer_account" }];
    const result = partitionSuppression(recipients, getEmail, suppression, ["  A@X.COM  "]);
    expect(result.overridden).toEqual([{ email: "a@x.com" }]);
    expect(result.dropped).toEqual([]);
  });

  it("an override for someone NOT in the recipient list has no effect (no crash, no phantom entries)", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com" }];
    const suppression: SuppressionEntry[] = [{ email: "a@x.com", reason: "customer_account" }];
    const result = partitionSuppression(recipients, getEmail, suppression, ["nobody@x.com"]);
    expect(result.dropped).toEqual([{ email: "a@x.com" }]);
    expect(result.overridden).toEqual([]);
  });

  it("all-suppressed with no overrides: eligible is empty, everyone is dropped", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com" }, { email: "b@x.com" }, { email: "c@x.com" }];
    const suppression: SuppressionEntry[] = recipients.map((r) => ({ email: r.email, reason: "lead_avoid" }));
    const result = partitionSuppression(recipients, getEmail, suppression);
    expect(result.eligible).toEqual([]);
    expect(result.overridden).toEqual([]);
    expect(result.dropped).toHaveLength(3);
  });

  it("all-suppressed but all overridden: dropped is empty, everyone lands in overridden (still sendable = eligible + overridden)", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com" }, { email: "b@x.com" }];
    const suppression: SuppressionEntry[] = recipients.map((r) => ({ email: r.email, reason: "lead_avoid" }));
    const overrides = recipients.map((r) => r.email);
    const result = partitionSuppression(recipients, getEmail, suppression, overrides);
    expect(result.dropped).toEqual([]);
    expect(result.eligible).toEqual([]);
    expect(result.overridden).toHaveLength(2);
    const sendable = [...result.eligible, ...result.overridden];
    expect(sendable).toHaveLength(2);
  });

  it("preserves non-email fields on partitioned recipients (generic over T)", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com", label: "VIP" }];
    const result = partitionSuppression(recipients, getEmail, []);
    expect(result.eligible[0]).toEqual({ email: "a@x.com", label: "VIP" });
  });

  it("a person can be suppressed for multiple reasons but still only appears once in `dropped`", () => {
    const recipients: TestRecipient[] = [{ email: "a@x.com" }];
    const suppression: SuppressionEntry[] = [
      { email: "a@x.com", reason: "customer_account" },
      { email: "a@x.com", reason: "contact_do_not_contact" },
    ];
    const result = partitionSuppression(recipients, getEmail, suppression);
    expect(result.dropped).toHaveLength(1);
  });
});
