import { describe, it, expect } from "vitest";
import { emailActivityIdentity, bucketActivityRowsByDay } from "@/features/nexus/metrics";

// ---------------------------------------------------------------------------
// dce9b1f made sync-emails log one synced email to EVERY matched contact
// under an account (was: one arbitrary contact). That's correct for contact
// timelines, but it means the "Emails Sent" Nexus metric — which counts
// activity ROWS — would inflate by however many contacts a message happened
// to match. These pure helpers dedupe by external_message_id so the metric
// counts real emails, not fan-out rows. See src/features/nexus/metrics.ts.
// ---------------------------------------------------------------------------

describe("emailActivityIdentity", () => {
  it("uses external_message_id when present (fan-out rows share identity)", () => {
    const a = emailActivityIdentity({ id: "row-1", external_message_id: "msg-abc" });
    const b = emailActivityIdentity({ id: "row-2", external_message_id: "msg-abc" });
    expect(a).toBe(b);
  });

  it("falls back to the row id when external_message_id is null (manual logs)", () => {
    const a = emailActivityIdentity({ id: "row-1", external_message_id: null });
    const b = emailActivityIdentity({ id: "row-2", external_message_id: null });
    expect(a).not.toBe(b);
  });
});

describe("bucketActivityRowsByDay", () => {
  const range = { start: new Date(2026, 6, 1), end: new Date(2026, 6, 4) }; // Jul 1-3 local

  it("counts each row once when there's no fan-out", () => {
    const rows = [
      { id: "1", effective_at: new Date(2026, 6, 1, 9).toISOString(), external_message_id: null },
      { id: "2", effective_at: new Date(2026, 6, 1, 10).toISOString(), external_message_id: null },
      { id: "3", effective_at: new Date(2026, 6, 2, 9).toISOString(), external_message_id: null },
    ];
    const buckets = bucketActivityRowsByDay(rows, range);
    const total = buckets.reduce((s, b) => s + b.value, 0);
    expect(total).toBe(3);
  });

  it("collapses same-day fan-out rows sharing external_message_id to one", () => {
    // One real email logged to 3 matched contacts under the same account —
    // 3 rows, same message, same timestamp.
    const stamp = new Date(2026, 6, 1, 9).toISOString();
    const rows = [
      { id: "1", effective_at: stamp, external_message_id: "msg-1" },
      { id: "2", effective_at: stamp, external_message_id: "msg-1" },
      { id: "3", effective_at: stamp, external_message_id: "msg-1" },
    ];
    const buckets = bucketActivityRowsByDay(rows, range);
    const total = buckets.reduce((s, b) => s + b.value, 0);
    expect(total).toBe(1);
  });

  it("counts manually-logged emails (no external_message_id) individually even on the same day", () => {
    const stamp = new Date(2026, 6, 1, 9).toISOString();
    const rows = [
      { id: "1", effective_at: stamp, external_message_id: null },
      { id: "2", effective_at: stamp, external_message_id: null },
    ];
    const buckets = bucketActivityRowsByDay(rows, range);
    const total = buckets.reduce((s, b) => s + b.value, 0);
    expect(total).toBe(2);
  });

  it("does not dedupe across different messages or different days", () => {
    const rows = [
      // Message A fanned out to 2 contacts on Jul 1
      { id: "1", effective_at: new Date(2026, 6, 1, 9).toISOString(), external_message_id: "msg-A" },
      { id: "2", effective_at: new Date(2026, 6, 1, 9).toISOString(), external_message_id: "msg-A" },
      // Message B fanned out to 2 contacts on Jul 2
      { id: "3", effective_at: new Date(2026, 6, 2, 9).toISOString(), external_message_id: "msg-B" },
      { id: "4", effective_at: new Date(2026, 6, 2, 9).toISOString(), external_message_id: "msg-B" },
    ];
    const buckets = bucketActivityRowsByDay(rows, range);
    const byLabel = new Map(buckets.map((b) => [b.label, b.value]));
    expect(byLabel.get("Jul 1")).toBe(1);
    expect(byLabel.get("Jul 2")).toBe(1);
    const total = buckets.reduce((s, b) => s + b.value, 0);
    expect(total).toBe(2);
  });

  it("ignores rows outside the bucketed range", () => {
    const rows = [
      { id: "1", effective_at: new Date(2026, 5, 15).toISOString(), external_message_id: null },
    ];
    const buckets = bucketActivityRowsByDay(rows, range);
    const total = buckets.reduce((s, b) => s + b.value, 0);
    expect(total).toBe(0);
  });
});
