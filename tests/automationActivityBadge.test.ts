import { describe, it, expect } from "vitest";
import { isAutomationActivity } from "@/features/activities/AutomationBadge";

// Summer's 7/22 follow-up: machine-created tasks are stamped owner = the
// account owner, so feeds showed them as human-written. The badge fires on
// the explicit flag (renewal signature tasks, 20260727160000) OR campaign
// linkage (campaign-spawned rows may predate the flag).

describe("isAutomationActivity", () => {
  it("badges renewal signature tasks (flag set)", () => {
    expect(isAutomationActivity({ created_by_automation: true })).toBe(true);
  });

  it("badges campaign-spawned rows even without the flag", () => {
    expect(
      isAutomationActivity({
        created_by_automation: false,
        campaign_enrollment_id: "0f0a2c9e-0000-0000-0000-000000000000",
      }),
    ).toBe(true);
  });

  it("does NOT badge human-written activities", () => {
    expect(
      isAutomationActivity({ created_by_automation: false, campaign_enrollment_id: null }),
    ).toBe(false);
    // Rows from before the migration ran (fields absent) stay unbadged.
    expect(isAutomationActivity({})).toBe(false);
  });
});
