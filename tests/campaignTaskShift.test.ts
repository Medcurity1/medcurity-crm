import { describe, it, expect } from "vitest";
import {
  shiftAndSnapIso,
  addDaysToIso,
  daysBetweenDateOnly,
} from "../supabase/functions/_shared/campaign-task-shift.ts";

// ---------------------------------------------------------------------------
// Campaign task-shift correction (audit fix C) — shiftAndSnapIso is the pure
// per-timestamp helper shiftEnrollmentTasks uses to re-date a still-pending
// campaign task when the actual send date differed from what was originally
// scheduled around. It must never land a task on a weekend: a raw
// addDaysToIso delta can walk a Thursday due date onto a Saturday/Sunday,
// which is exactly the bug taskDueAt's own snapToWeekday call
// (campaign-scheduling.ts) already prevents for the INITIAL schedule — this
// re-applies the same guarantee after a shift.
//
// This file lives outside src/ and imports supabase/functions/_shared/
// campaign-task-shift.ts directly (no "@/" alias — Deno-side shared module),
// same pattern as tests/campaignScheduling.test.ts.
// ---------------------------------------------------------------------------

describe("shiftAndSnapIso", () => {
  it("snaps a shift that would land on a Saturday forward to Monday", () => {
    // 2026-07-16 is a Thursday. +2 days = 2026-07-18, a Saturday.
    const due = "2026-07-16T16:00:00.000Z";
    const result = shiftAndSnapIso(due, 2);
    expect(result.slice(0, 10)).toBe("2026-07-20"); // Monday
  });

  it("snaps a shift that would land on a Sunday forward to Monday", () => {
    // 2026-07-16 is a Thursday. +3 days = 2026-07-19, a Sunday.
    const due = "2026-07-16T16:00:00.000Z";
    const result = shiftAndSnapIso(due, 3);
    expect(result.slice(0, 10)).toBe("2026-07-20"); // Monday
  });

  it("leaves a shift that lands on a weekday unchanged", () => {
    // 2026-07-16 is a Thursday. +1 day = 2026-07-17, a Friday — no snap needed.
    const due = "2026-07-16T16:00:00.000Z";
    const result = shiftAndSnapIso(due, 1);
    expect(result.slice(0, 10)).toBe("2026-07-17");
  });

  it("preserves the original time-of-day exactly, snapped or not", () => {
    const due = "2026-07-16T23:45:12.345Z";
    // +2 days lands on Saturday 2026-07-18 -> snaps to Monday 2026-07-20,
    // but the HH:MM:SS.sss must be untouched.
    const snapped = shiftAndSnapIso(due, 2);
    expect(snapped).toBe("2026-07-20T23:45:12.345Z");

    // +1 day lands on a weekday (Friday) — still must preserve time exactly.
    const unsnapped = shiftAndSnapIso(due, 1);
    expect(unsnapped).toBe("2026-07-17T23:45:12.345Z");
  });

  it("matches plain addDaysToIso for a shift that needs no snap", () => {
    const due = "2026-07-16T16:00:00.000Z";
    expect(shiftAndSnapIso(due, 1)).toBe(addDaysToIso(due, 1));
  });
});

describe("daysBetweenDateOnly (unchanged by this fix — sanity check)", () => {
  it("computes a whole-day delta from date-only prefixes", () => {
    expect(daysBetweenDateOnly("2026-07-16T00:00:00Z", "2026-07-19T12:00:00Z")).toBe(3);
  });
});
