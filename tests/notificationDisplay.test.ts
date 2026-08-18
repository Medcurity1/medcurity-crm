import { describe, expect, it } from "vitest";
import { notificationForDisplay } from "../src/features/notifications/notification-display";

describe("notification presentation", () => {
  it("turns a legacy raw campaign reply reminder into readable copy", () => {
    const display = notificationForDisplay({
      type: "task_due",
      title: "Reminder: Reply from nathang@medcurity.com — PROD QA — 4-Day Smartlead Rendering — 2026-08-18",
      message: "<html><body><div>QA stop test</div><div id=\"divRplyFwdMsg\">From: Summer</div></body></html>",
    });
    expect(display).toEqual({
      title: "Reply follow-up due",
      message: "nathang@medcurity.com: QA stop test",
    });
  });

  it("shortens the legacy campaign reply assignment notification", () => {
    expect(notificationForDisplay({
      type: "task_assigned",
      title: "Task assigned to you: Reply from nathang@medcurity.com — PROD QA — 4-Day",
      message: "This task was assigned to you.",
    })).toEqual({
      title: "Reply follow-up assigned",
      message: "Follow up with nathang@medcurity.com.",
    });
  });

  it("keeps the dedicated reply alert brief", () => {
    expect(notificationForDisplay({
      type: "engagement",
      title: "Reply received",
      message: "nathang@medcurity.com replied in PROD QA — their sequence stopped",
    })).toEqual({
      title: "Reply received",
      message: "nathang@medcurity.com replied. Sequence stopped.",
    });
  });

  it("does not rewrite unrelated notifications", () => {
    expect(notificationForDisplay({
      type: "system",
      title: "Sync complete",
      message: "Everything is current.",
    })).toEqual({ title: "Sync complete", message: "Everything is current." });
  });
});
