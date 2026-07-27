import { describe, it, expect } from "vitest";
import { isAutoRenewal } from "@/features/opportunities/AutoRenewalBadge";

// The "Auto-renewal" tag exists because the renewal generator copies the parent
// contract's NAME verbatim, so a generated renewal reads as the rep's own closed
// deal coming back (Margaret, 2026-07-21 and 2026-07-27). These cases pin down
// exactly which deals get tagged — over-tagging is as bad as under-tagging,
// since a tag on a rep's own deal would teach the team to ignore it.

describe("isAutoRenewal", () => {
  it("tags a deal the renewal automation generated (both flags set)", () => {
    expect(
      isAutoRenewal({
        created_by_automation: true,
        renewal_from_opportunity_id: "20f9f983-45e5-4329-828b-05d0dd396d09",
      }),
    ).toBe(true);
  });

  it("does NOT tag a deal a rep created by hand", () => {
    expect(
      isAutoRenewal({
        created_by_automation: false,
        renewal_from_opportunity_id: null,
      }),
    ).toBe(false);
  });

  it("does NOT tag Salesforce-imported renewals (automation flag, no parent link)", () => {
    // Live example: Blue Mountain Hospital's "SRA | Remote Services | SAFER",
    // imported 2026-04-22 with created_by_automation = true but no parent.
    // It is a real deal Margaret worked and closed — tagging it would be wrong.
    expect(
      isAutoRenewal({
        created_by_automation: true,
        renewal_from_opportunity_id: null,
      }),
    ).toBe(false);
  });

  it("does NOT tag a hand-made renewal that was merely linked to its parent", () => {
    expect(
      isAutoRenewal({
        created_by_automation: false,
        renewal_from_opportunity_id: "20f9f983-45e5-4329-828b-05d0dd396d09",
      }),
    ).toBe(false);
  });

  it("treats missing/undefined flags as not-a-renewal", () => {
    expect(isAutoRenewal({})).toBe(false);
    expect(
      isAutoRenewal({ created_by_automation: null, renewal_from_opportunity_id: null }),
    ).toBe(false);
  });
});
