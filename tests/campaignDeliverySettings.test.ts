import { describe, expect, it } from "vitest";
import {
  DEFAULT_DELIVERY_SETTINGS,
  deliveryDaysLabel,
  deliverySummary,
  normalizeDeliverySettings,
} from "../src/features/playbook/delivery-settings";

describe("campaign delivery settings", () => {
  it("gives a normal user a complete weekday business-hours preset", () => {
    expect(deliverySummary(DEFAULT_DELIVERY_SETTINGS)).toBe("Weekdays, 9am–5pm Pacific time");
    expect(DEFAULT_DELIVERY_SETTINGS).toMatchObject({
      campaignDailyVolume: 25,
      messageSpacingMinutes: 15,
      timezone: "America/Los_Angeles",
    });
  });

  it("keeps cadence concepts separate and clamps unsafe numeric input", () => {
    expect(normalizeDeliverySettings({ campaignDailyVolume: 999, messageSpacingMinutes: 0 })).toMatchObject({
      campaignDailyVolume: 500,
      messageSpacingMinutes: 15,
    });
  });

  it("describes custom sending days plainly", () => {
    expect(deliveryDaysLabel([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(deliveryDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
  });
});
