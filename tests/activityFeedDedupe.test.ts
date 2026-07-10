import { describe, it, expect } from "vitest";
import { dedupeEmailActivityRows } from "@/features/dashboard/activityFeedDedupe";

// ---------------------------------------------------------------------------
// dce9b1f logs one synced email to EVERY matched contact under an account,
// so a widely-CC'd email can appear as several rows in unfiltered "recent
// activity" widgets (TeamActivityFeed, HomePage Recent Activity). This
// collapses those fan-out copies to one feed entry, keyed on
// (owner_user_id, external_message_id), without touching non-email rows or
// manually-logged emails (no external_message_id).
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  activity_type: string;
  owner_user_id: string | null;
  external_message_id: string | null;
}

describe("dedupeEmailActivityRows", () => {
  it("collapses fan-out email rows sharing (owner_user_id, external_message_id)", () => {
    const rows: Row[] = [
      { id: "1", activity_type: "email", owner_user_id: "owner-1", external_message_id: "msg-1" },
      { id: "2", activity_type: "email", owner_user_id: "owner-1", external_message_id: "msg-1" },
      { id: "3", activity_type: "email", owner_user_id: "owner-1", external_message_id: "msg-1" },
    ];
    const out = dedupeEmailActivityRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("1"); // first occurrence wins
  });

  it("keeps the same external_message_id under different owners distinct", () => {
    const rows: Row[] = [
      { id: "1", activity_type: "email", owner_user_id: "owner-1", external_message_id: "msg-1" },
      { id: "2", activity_type: "email", owner_user_id: "owner-2", external_message_id: "msg-1" },
    ];
    const out = dedupeEmailActivityRows(rows);
    expect(out).toHaveLength(2);
  });

  it("leaves manually-logged emails (no external_message_id) untouched", () => {
    const rows: Row[] = [
      { id: "1", activity_type: "email", owner_user_id: "owner-1", external_message_id: null },
      { id: "2", activity_type: "email", owner_user_id: "owner-1", external_message_id: null },
    ];
    const out = dedupeEmailActivityRows(rows);
    expect(out).toHaveLength(2);
  });

  it("never collapses non-email activities, even with a matching external_message_id", () => {
    const rows: Row[] = [
      { id: "1", activity_type: "call", owner_user_id: "owner-1", external_message_id: null },
      { id: "2", activity_type: "task", owner_user_id: "owner-1", external_message_id: null },
      { id: "3", activity_type: "meeting", owner_user_id: "owner-1", external_message_id: null },
    ];
    const out = dedupeEmailActivityRows(rows);
    expect(out).toHaveLength(3);
  });

  it("preserves original order and doesn't mutate the input array", () => {
    const rows: Row[] = [
      { id: "1", activity_type: "call", owner_user_id: "owner-1", external_message_id: null },
      { id: "2", activity_type: "email", owner_user_id: "owner-1", external_message_id: "msg-1" },
      { id: "3", activity_type: "email", owner_user_id: "owner-1", external_message_id: "msg-1" },
      { id: "4", activity_type: "note", owner_user_id: "owner-1", external_message_id: null },
    ];
    const snapshot = JSON.parse(JSON.stringify(rows));
    const out = dedupeEmailActivityRows(rows);
    expect(out.map((r) => r.id)).toEqual(["1", "2", "4"]);
    expect(rows).toEqual(snapshot);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeEmailActivityRows([])).toEqual([]);
  });
});
