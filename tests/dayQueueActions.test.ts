import { describe, it, expect } from "vitest";
import { primaryAction, taskIdOf, requestIdOf } from "@/features/nexus/Briefing";
import type { DayQueueRow } from "@/features/nexus/day-queue-api";

// Minimal row factory — only the fields the action logic reads.
function row(over: Partial<DayQueueRow>): DayQueueRow {
  return {
    item_key: "x",
    kind: "task",
    title: null,
    reason: null,
    urgency: null,
    amount: null,
    due_at: null,
    account_id: null,
    contact_id: null,
    opportunity_id: null,
    enrollment_id: null,
    task_id: null,
    campaign_id: null,
    event_id: null,
    ...over,
  } as DayQueueRow;
}

describe("Open task deep link (Molly's 8/12 ticket)", () => {
  it("a task card opens THE task, not the activities log", () => {
    const r = row({ kind: "task", item_key: "task:abc-123", task_id: "abc-123" });
    expect(primaryAction(r)).toEqual({ label: "Open task", to: "/activities/abc-123" });
  });

  it("campaign tasks deep-link the same way", () => {
    const r = row({ kind: "campaign_task", item_key: "task:def-456", task_id: "def-456" });
    expect(primaryAction(r).to).toBe("/activities/def-456");
  });

  it("falls back to parsing item_key when task_id is missing", () => {
    const r = row({ kind: "task", item_key: "task:ghi-789", task_id: null });
    expect(taskIdOf(r)).toBe("ghi-789");
    expect(primaryAction(r).to).toBe("/activities/ghi-789");
  });

  it("an unreadable row still lands somewhere sane (the activities page)", () => {
    const r = row({ kind: "task", item_key: "garbage", task_id: null });
    expect(primaryAction(r).to).toBe("/activities");
  });

  it("taskIdOf ignores non-task kinds", () => {
    expect(taskIdOf(row({ kind: "renewal", item_key: "task:zzz" }))).toBeNull();
  });

  it("request rows keep their id parsing (regression guard for Jordan M's 8/4 fix)", () => {
    expect(requestIdOf(row({ kind: "request", item_key: "request:r-1" }))).toBe("r-1");
  });
});
