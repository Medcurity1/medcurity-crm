import { describe, it, expect } from "vitest";
import {
  computeFirstSendDates,
  relativeStepOffsets,
  emailStepsToSmartleadSequence,
  taskDueAt,
  type SchedulingStep,
} from "../supabase/functions/_shared/campaign-scheduling.ts";

// ---------------------------------------------------------------------------
// Campaigns overhaul S3 — the pure scheduling math that turns "N recipients,
// L/day, launched on date X" plus a mixed-channel step list into (a) a
// Smartlead email sequence, (b) a per-enrollment first_send_at, and (c) a
// due_at for every spawned CALL/LINKEDIN/EMAIL_HYBRID task.
//
// This file lives outside src/ and imports supabase/functions/_shared/
// campaign-scheduling.ts DIRECTLY (no "@/" alias — that module is Deno-side
// and deliberately has zero framework/runtime dependencies so it can be
// imported unmodified from both the edge function and here).
// ---------------------------------------------------------------------------

// Mirrors the real 8-Touch Sales Sequence preset (20260625000001_
// campaigns_foundation.sql): EMAIL_AUTO on days 1 & 5, CALL on 8 & 19,
// LINKEDIN on 12 & 23, EMAIL_HYBRID on 15 & 26.
const EIGHT_TOUCH: SchedulingStep[] = [
  { order: 1, day_offset: 1, channel: "EMAIL_AUTO", subject_template: "Subj 1", body_template: "Body 1" },
  { order: 2, day_offset: 5, channel: "EMAIL_AUTO", subject_template: "Subj 2", body_template: "Body 2" },
  { order: 3, day_offset: 8, channel: "CALL" },
  { order: 4, day_offset: 12, channel: "LINKEDIN" },
  { order: 5, day_offset: 15, channel: "EMAIL_HYBRID" },
  { order: 6, day_offset: 19, channel: "CALL" },
  { order: 7, day_offset: 23, channel: "LINKEDIN" },
  { order: 8, day_offset: 26, channel: "EMAIL_HYBRID" },
];

describe("computeFirstSendDates", () => {
  it("n=0 returns an empty array", () => {
    expect(computeFirstSendDates(0, "2026-07-22", 20)).toEqual([]);
  });

  it("single-recipient campaign: anchor already a send day", () => {
    // 2026-07-22 is a Wednesday.
    expect(computeFirstSendDates(1, "2026-07-22", 20, [1, 2, 3, 4, 5])).toEqual(["2026-07-22"]);
  });

  it("single-recipient campaign: anchor on a weekend snaps forward to Monday", () => {
    // 2026-07-18 is a Saturday -> next Mon-Fri day is Monday 2026-07-20.
    expect(computeFirstSendDates(1, "2026-07-18", 5, [1, 2, 3, 4, 5])).toEqual(["2026-07-20"]);
  });

  it("throttle math: n=50 at 20/day buckets into exactly 3 send days, all weekdays", () => {
    // Anchor Monday 2026-07-20 so no weekend-snap interference — isolates
    // the throttle bucketing (floor((pos-1)/20)) from the snap behavior.
    const dates = computeFirstSendDates(50, "2026-07-20", 20, [1, 2, 3, 4, 5]);
    expect(dates).toHaveLength(50);
    expect(new Set(dates).size).toBe(3); // ceil(50/20)
    // Position 1 and 20 share the first bucket; 21 starts the second; etc.
    expect(dates[0]).toBe("2026-07-20"); // position 1
    expect(dates[19]).toBe("2026-07-20"); // position 20 (last of bucket 1)
    expect(dates[20]).toBe("2026-07-21"); // position 21 (first of bucket 2)
    expect(dates[39]).toBe("2026-07-21"); // position 40 (last of bucket 2)
    expect(dates[40]).toBe("2026-07-22"); // position 41 (first of bucket 3)
    expect(dates[49]).toBe("2026-07-22"); // position 50 (last of bucket 3)
  });

  it("weekend handling: cohorts land on successive SEND days — a weekend consumes no send capacity", () => {
    // Anchor Monday 2026-07-20, 1/day, Mon-Fri: each cohort takes the NEXT
    // send day (Smartlead pulls max_new_leads_per_day new leads per send
    // day). The weekend is simply skipped — it does NOT collapse multiple
    // cohorts onto the following Monday (which would overstate Monday's
    // real send volume and mis-date those people's call tasks).
    const dates = computeFirstSendDates(8, "2026-07-20", 1, [1, 2, 3, 4, 5]);
    expect(dates).toEqual([
      "2026-07-20", // Mon
      "2026-07-21", // Tue
      "2026-07-22", // Wed
      "2026-07-23", // Thu
      "2026-07-24", // Fri
      "2026-07-27", // Mon (weekend skipped)
      "2026-07-28", // Tue
      "2026-07-29", // Wed
    ]);
  });

  it("defaults sendDays to Mon-Fri when omitted", () => {
    const withDefault = computeFirstSendDates(8, "2026-07-20", 1);
    const withExplicit = computeFirstSendDates(8, "2026-07-20", 1, [1, 2, 3, 4, 5]);
    expect(withDefault).toEqual(withExplicit);
  });

  it("accepts a non-Mon-Fri sendDays set (e.g. Tue/Thu only)", () => {
    // Anchor Monday 2026-07-20, sendDays = [Tue, Thu] only, 1/day: the
    // three cohorts take the first three Tue/Thu send days on/after the
    // anchor — Tue 21, Thu 23, then NEXT week's Tue 28 (1/day means one
    // person per send day, never two sharing one).
    const dates = computeFirstSendDates(3, "2026-07-20", 1, [2, 4]);
    expect(dates).toEqual(["2026-07-21", "2026-07-23", "2026-07-28"]);
  });
});

describe("relativeStepOffsets", () => {
  it("baselines off the smallest EMAIL_AUTO day_offset (8-Touch fixture)", () => {
    const offsets = relativeStepOffsets(EIGHT_TOUCH);
    // baseline = min(1, 5) = 1
    expect(offsets.get(1)).toBe(0); // email day 1
    expect(offsets.get(2)).toBe(4); // email day 5
    expect(offsets.get(3)).toBe(7); // call day 8
    expect(offsets.get(4)).toBe(11); // linkedin day 12
    expect(offsets.get(5)).toBe(14); // hybrid email day 15
    expect(offsets.get(6)).toBe(18); // call day 19
    expect(offsets.get(7)).toBe(22); // linkedin day 23
    expect(offsets.get(8)).toBe(25); // hybrid email day 26
  });

  it("falls back to the smallest day_offset overall when there are no EMAIL_AUTO steps", () => {
    const callOnly: SchedulingStep[] = [
      { order: 1, day_offset: 3, channel: "CALL" },
      { order: 2, day_offset: 7, channel: "LINKEDIN" },
      { order: 3, day_offset: 10, channel: "CALL" },
    ];
    const offsets = relativeStepOffsets(callOnly);
    expect(offsets.get(1)).toBe(0);
    expect(offsets.get(2)).toBe(4);
    expect(offsets.get(3)).toBe(7);
  });

  it("returns an empty map for an empty step list", () => {
    expect(relativeStepOffsets([]).size).toBe(0);
  });

  it("a single-step template baselines to itself (offset 0)", () => {
    const single: SchedulingStep[] = [{ order: 1, day_offset: 9, channel: "CALL" }];
    expect(relativeStepOffsets(single).get(1)).toBe(0);
  });
});

describe("emailStepsToSmartleadSequence", () => {
  it("extracts only EMAIL_AUTO steps, sorted by day_offset, with gap-from-previous delay_days", () => {
    // Deliberately out of order in the input array to prove it sorts by
    // day_offset rather than trusting input order.
    const steps: SchedulingStep[] = [
      { order: 4, day_offset: 26, channel: "EMAIL_AUTO", subject_template: "S26", body_template: "B26" },
      { order: 1, day_offset: 1, channel: "EMAIL_AUTO", subject_template: "S1", body_template: "B1" },
      { order: 3, day_offset: 15, channel: "EMAIL_AUTO", subject_template: "S15", body_template: "B15" },
      { order: 2, day_offset: 5, channel: "EMAIL_AUTO", subject_template: "S5", body_template: "B5" },
    ];
    // day_offsets 1, 5, 15, 26 -> delay_days 0, 4, 10, 11
    const seq = emailStepsToSmartleadSequence(steps);
    expect(seq).toEqual([
      { seq_number: 1, delay_days: 0, subject: "S1", body_html: "B1" },
      { seq_number: 2, delay_days: 4, subject: "S5", body_html: "B5" },
      { seq_number: 3, delay_days: 10, subject: "S15", body_html: "B15" },
      { seq_number: 4, delay_days: 11, subject: "S26", body_html: "B26" },
    ]);
  });

  it("excludes CALL/LINKEDIN/EMAIL_HYBRID steps even when interspersed (8-Touch fixture)", () => {
    const seq = emailStepsToSmartleadSequence(EIGHT_TOUCH);
    expect(seq).toEqual([
      { seq_number: 1, delay_days: 0, subject: "Subj 1", body_html: "Body 1" },
      { seq_number: 2, delay_days: 4, subject: "Subj 2", body_html: "Body 2" },
    ]);
  });

  it("returns an empty array for a call-only template (no EMAIL_AUTO steps)", () => {
    const callOnly: SchedulingStep[] = [{ order: 1, day_offset: 3, channel: "CALL" }];
    expect(emailStepsToSmartleadSequence(callOnly)).toEqual([]);
  });

  it("treats missing subject/body templates as empty strings, not undefined", () => {
    const steps: SchedulingStep[] = [{ order: 1, day_offset: 1, channel: "EMAIL_AUTO" }];
    expect(emailStepsToSmartleadSequence(steps)).toEqual([
      { seq_number: 1, delay_days: 0, subject: "", body_html: "" },
    ]);
  });
});

describe("taskDueAt", () => {
  it("defaults to 09:00 America/Los_Angeles when sendWindowStart is omitted", () => {
    // Feb -> PST (UTC-8): 09:00 PT = 17:00 UTC.
    expect(taskDueAt("2026-02-15", 0)).toBe("2026-02-15T17:00:00.000Z");
  });

  it("accepts a full ISO timestamp for firstSendISO and uses only its date part", () => {
    // Matches what reading campaign_enrollments.first_send_at back from
    // Postgres looks like, vs. computeFirstSendDates' bare date string.
    expect(taskDueAt("2026-07-22T00:00:00+00:00", 0, "09:00")).toBe("2026-07-22T16:00:00.000Z");
  });

  it("honors a custom send_window_start clock time", () => {
    expect(taskDueAt("2026-07-01", 0, "14:30")).toBe("2026-07-01T21:30:00.000Z");
  });

  it("adds relativeOffsetDays across a month boundary", () => {
    // 2026-02-27 + 3 days = 2026-03-02 (Feb 2026 has 28 days).
    expect(taskDueAt("2026-02-27", 3, "09:00")).toBe("2026-03-02T16:00:00.000Z");
  });

  describe("DST boundary months (documented month-based PT approximation)", () => {
    it("February -> PST, UTC-8", () => {
      expect(taskDueAt("2026-02-15", 0, "09:00")).toBe("2026-02-15T17:00:00.000Z");
    });
    it("March -> PDT, UTC-7", () => {
      expect(taskDueAt("2026-03-01", 0, "09:00")).toBe("2026-03-01T16:00:00.000Z");
    });
    it("November -> still PDT under the approximation, UTC-7", () => {
      expect(taskDueAt("2026-11-01", 0, "09:00")).toBe("2026-11-01T16:00:00.000Z");
    });
    it("December -> PST, UTC-8", () => {
      expect(taskDueAt("2026-12-01", 0, "09:00")).toBe("2026-12-01T17:00:00.000Z");
    });
  });
});
