import { describe, it, expect } from "vitest";
import {
  taskDueBucket,
  taskDueChipLabel,
  compareTasksByDue,
  compareTasksByDueThenPriority,
  groupTasksByBucket,
  DUE_BUCKET_ORDER,
} from "@/features/activities/taskOrder";

// Fixed "now": Wed Aug 12 2026, 10:00 local. Buckets compare CALENDAR days,
// so times of day inside the same date must not change the answer.
const NOW = new Date(2026, 7, 12, 10, 0, 0);

/** ISO timestamp `delta` calendar days from NOW, at an arbitrary time. */
function iso(delta: number, hour = 15): string {
  return new Date(2026, 7, 12 + delta, hour, 30, 0).toISOString();
}

describe("taskDueBucket", () => {
  it("maps missing due dates to 'none'", () => {
    expect(taskDueBucket(null, NOW)).toBe("none");
    expect(taskDueBucket(undefined, NOW)).toBe("none");
  });

  it("buckets by calendar day: overdue / today / week / later", () => {
    expect(taskDueBucket(iso(-1), NOW)).toBe("overdue");
    expect(taskDueBucket(iso(-30), NOW)).toBe("overdue");
    expect(taskDueBucket(iso(0), NOW)).toBe("today");
    expect(taskDueBucket(iso(1), NOW)).toBe("week");
    expect(taskDueBucket(iso(7), NOW)).toBe("week"); // 7th day inclusive
    expect(taskDueBucket(iso(8), NOW)).toBe("later");
  });

  it("ignores time of day — a due EARLIER today is still 'today', not overdue", () => {
    expect(taskDueBucket(iso(0, 1), NOW)).toBe("today");
    expect(taskDueBucket(iso(0, 23), NOW)).toBe("today");
  });
});

describe("taskDueChipLabel", () => {
  it("phrases overdue as day counts", () => {
    expect(taskDueChipLabel(iso(-1), NOW)).toBe("1d overdue");
    expect(taskDueChipLabel(iso(-12), NOW)).toBe("12d overdue");
  });

  it("uses today / tomorrow words", () => {
    expect(taskDueChipLabel(iso(0), NOW)).toBe("Due today");
    expect(taskDueChipLabel(iso(1), NOW)).toBe("Due tomorrow");
  });

  it("uses the weekday inside the coming week, month+day beyond it", () => {
    const d3 = new Date(2026, 7, 15, 15, 30);
    expect(taskDueChipLabel(iso(3), NOW)).toBe(
      `Due ${d3.toLocaleDateString(undefined, { weekday: "short" })}`,
    );
    const d10 = new Date(2026, 7, 22, 15, 30);
    expect(taskDueChipLabel(iso(10), NOW)).toBe(
      `Due ${d10.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    );
  });

  it("adds the year when the due date is in a different year", () => {
    const nextYear = new Date(2027, 0, 5, 12, 0).toISOString();
    expect(taskDueChipLabel(nextYear, NOW)).toContain("2027");
  });
});

describe("compareTasksByDue (direction-aware)", () => {
  const early = { due_at: iso(1), priority: "low" as const };
  const late = { due_at: iso(5), priority: "high" as const };
  const undatedHigh = { due_at: null, priority: "high" as const };
  const undatedLow = { due_at: null, priority: "low" as const };

  it("sorts ascending by due date by default", () => {
    expect(compareTasksByDue(early, late)).toBeLessThan(0);
    expect(compareTasksByDue(late, early)).toBeGreaterThan(0);
  });

  it("reverses dated comparisons when descending", () => {
    expect(compareTasksByDue(early, late, true)).toBeGreaterThan(0);
    expect(compareTasksByDue(late, early, true)).toBeLessThan(0);
  });

  it("keeps undated tasks LAST in both directions", () => {
    expect(compareTasksByDue(early, undatedHigh, false)).toBeLessThan(0);
    expect(compareTasksByDue(early, undatedHigh, true)).toBeLessThan(0);
    expect(compareTasksByDue(undatedHigh, late, false)).toBeGreaterThan(0);
    expect(compareTasksByDue(undatedHigh, late, true)).toBeGreaterThan(0);
  });

  it("breaks ties High-first regardless of direction", () => {
    const sameDayLow = { due_at: iso(2), priority: "low" as const };
    const sameDayHigh = { due_at: iso(2), priority: "high" as const };
    expect(compareTasksByDue(sameDayHigh, sameDayLow, false)).toBeLessThan(0);
    expect(compareTasksByDue(sameDayHigh, sameDayLow, true)).toBeLessThan(0);
    expect(compareTasksByDue(undatedHigh, undatedLow, true)).toBeLessThan(0);
  });

  it("compareTasksByDueThenPriority stays the ascending alias", () => {
    expect(compareTasksByDueThenPriority(early, late)).toBeLessThan(0);
    expect(compareTasksByDueThenPriority(undatedHigh, undatedLow)).toBeLessThan(0);
  });
});

describe("groupTasksByBucket", () => {
  it("returns only non-empty buckets, in canonical order, preserving row order", () => {
    const tasks = [
      { id: "a", due_at: iso(-2) },
      { id: "b", due_at: iso(-1) },
      { id: "c", due_at: iso(0) },
      { id: "d", due_at: iso(3) },
      { id: "e", due_at: iso(20) },
      { id: "f", due_at: null },
    ];
    const groups = groupTasksByBucket(tasks, NOW);
    expect(groups.map((g) => g.bucket)).toEqual([
      "overdue",
      "today",
      "week",
      "later",
      "none",
    ]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(groups.flatMap((g) => g.tasks.map((t) => t.id))).toEqual([
      "a", "b", "c", "d", "e", "f",
    ]);
  });

  it("omits empty buckets entirely", () => {
    const groups = groupTasksByBucket([{ due_at: iso(0) }], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].bucket).toBe("today");
  });

  it("bucket order constant covers every bucket exactly once", () => {
    expect([...new Set(DUE_BUCKET_ORDER)]).toHaveLength(5);
  });
});
