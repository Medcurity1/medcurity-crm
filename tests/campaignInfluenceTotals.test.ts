import { describe, it, expect } from "vitest";
import { postEnrollmentDeal, influenceTotals } from "../src/features/playbook/campaign-metrics";

// ---------------------------------------------------------------------------
// Docket I38 — the "Did this campaign make money?" math (useCampaignInfluence,
// outside-review I30). postEnrollmentDeal decides which opportunities count
// as influence (opened AFTER the account's first enrollment); influenceTotals
// buckets them into won vs open pipeline. The renewal exclusion
// (created_by_automation = false) is a DB-side query filter and is NOT
// covered here — noted in campaign-metrics.ts's doc comment.
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-07-01T00:00:00Z");

function opp(overrides: Partial<{ id: string; name: string; amount: unknown; stage: string; created_at: string }> = {}) {
  return {
    id: "opp-1",
    name: "Deal",
    amount: 1000,
    stage: "qualified",
    created_at: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

describe("postEnrollmentDeal — what counts as influence", () => {
  it("keeps a deal created after enrollment", () => {
    const d = postEnrollmentDeal(opp(), T0);
    expect(d).not.toBeNull();
    expect(d!.amount).toBe(1000);
  });

  it("drops a deal created before or exactly at enrollment", () => {
    expect(postEnrollmentDeal(opp({ created_at: "2026-06-30T00:00:00Z" }), T0)).toBeNull();
    expect(postEnrollmentDeal(opp({ created_at: "2026-07-01T00:00:00Z" }), T0)).toBeNull();
  });

  it("drops a deal whose account has no enrollment (null/undefined enrolledAt)", () => {
    expect(postEnrollmentDeal(opp(), null)).toBeNull();
    expect(postEnrollmentDeal(opp(), undefined)).toBeNull();
  });

  it("drops a deal with an unparseable created_at", () => {
    expect(postEnrollmentDeal(opp({ created_at: "not-a-date" }), T0)).toBeNull();
  });

  it("coerces PostgREST string amounts once (repo-wide Number(amount) convention)", () => {
    expect(postEnrollmentDeal(opp({ amount: "2500.50" }), T0)!.amount).toBe(2500.5);
  });

  it("turns junk amounts into null, never NaN — and a missing amount into 0", () => {
    expect(postEnrollmentDeal(opp({ amount: "lots" }), T0)!.amount).toBeNull();
    // null coalesces to 0 before coercion — the deal shows with a $0, not a hole
    expect(postEnrollmentDeal(opp({ amount: null }), T0)!.amount).toBe(0);
  });
});

describe("influenceTotals — won vs open bucketing", () => {
  it("closed_won sums into wonTotal, non-terminal stages into openTotal", () => {
    const t = influenceTotals([
      { stage: "closed_won", amount: 1000 },
      { stage: "closed_won", amount: 250 },
      { stage: "qualified", amount: 400 },
      { stage: "proposal", amount: 100 },
    ]);
    expect(t.wonTotal).toBe(1250);
    expect(t.openTotal).toBe(500);
  });

  it("closed_lost counts toward neither total", () => {
    const t = influenceTotals([
      { stage: "closed_lost", amount: 9999 },
      { stage: "closed_won", amount: 100 },
    ]);
    expect(t.wonTotal).toBe(100);
    expect(t.openTotal).toBe(0);
  });

  it("null amounts contribute 0 without hiding the deal's stage bucket", () => {
    const t = influenceTotals([
      { stage: "closed_won", amount: null },
      { stage: "qualified", amount: null },
      { stage: "qualified", amount: 50 },
    ]);
    expect(t.wonTotal).toBe(0);
    expect(t.openTotal).toBe(50);
  });

  it("empty list totals to zero/zero", () => {
    expect(influenceTotals([])).toEqual({ wonTotal: 0, openTotal: 0 });
  });
});
