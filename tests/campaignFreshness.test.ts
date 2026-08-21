import { describe, expect, it } from "vitest";
import { dailySweepLocalTimeLabel, lastSyncedLabel } from "../src/features/playbook/campaign-freshness";

describe("campaign freshness labels", () => {
  it("formats recent syncs in minutes and hours", () => {
    const now = Date.parse("2026-08-19T18:00:00Z");
    expect(lastSyncedLabel("2026-08-19T17:57:00Z", now)).toBe("Synced 3 min ago");
    expect(lastSyncedLabel("2026-08-19T16:00:00Z", now)).toBe("Synced 2 hours ago");
    expect(lastSyncedLabel(null, now)).toBeNull();
  });

  it("shows the daily sweep in Pacific time, adjusting for DST", () => {
    const pdt = dailySweepLocalTimeLabel(new Date("2026-08-19T20:00:00Z"));
    const pst = dailySweepLocalTimeLabel(new Date("2026-01-15T20:00:00Z"));
    expect(pdt).toMatch(/6:10/);
    expect(pst).toMatch(/5:10/);
  });
});
