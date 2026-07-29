import { describe, it, expect } from "vitest";
import {
  computeFirstSendDates,
  relativeStepOffsets,
  emailStepsToSmartleadSequence,
  taskDueAt,
  snapToWeekday,
  ptUtcOffsetHours,
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

describe("snapToWeekday", () => {
  it("leaves an already-allowed weekday unchanged", () => {
    // 2026-07-22 is a Wednesday — already Mon-Fri.
    expect(snapToWeekday("2026-07-22")).toBe("2026-07-22");
  });

  it("snaps a Saturday forward to the following Monday (default Mon-Fri)", () => {
    // 2026-07-18 is a Saturday.
    expect(snapToWeekday("2026-07-18")).toBe("2026-07-20");
  });

  it("snaps a Sunday forward to the following Monday (default Mon-Fri)", () => {
    // 2026-07-19 is a Sunday.
    expect(snapToWeekday("2026-07-19")).toBe("2026-07-20");
  });

  it("honors a custom sendDays set (e.g. Tue/Thu only)", () => {
    // 2026-07-20 is a Monday -> first Tue/Thu on/after it is Tue 2026-07-21.
    expect(snapToWeekday("2026-07-20", [2, 4])).toBe("2026-07-21");
  });

  it("defaults to Mon-Fri when sendDays is omitted", () => {
    expect(snapToWeekday("2026-07-18")).toBe(snapToWeekday("2026-07-18", [1, 2, 3, 4, 5]));
  });
});

describe("taskDueAt", () => {
  it("defaults to 09:00 America/Los_Angeles when sendWindowStart is omitted", () => {
    // 2026-02-15 is a Sunday -> snaps forward to Monday 2026-02-16.
    // Feb -> PST (UTC-8): 09:00 PT = 17:00 UTC.
    expect(taskDueAt("2026-02-15", 0)).toBe("2026-02-16T17:00:00.000Z");
  });

  it("accepts a full ISO timestamp for firstSendISO and uses only its date part", () => {
    // Matches what reading campaign_enrollments.first_send_at back from
    // Postgres looks like, vs. computeFirstSendDates' bare date string.
    // 2026-07-22 is a Wednesday — no weekend snap.
    expect(taskDueAt("2026-07-22T00:00:00+00:00", 0, "09:00")).toBe("2026-07-22T16:00:00.000Z");
  });

  it("honors a custom send_window_start clock time", () => {
    // 2026-07-01 is a Wednesday — no weekend snap.
    expect(taskDueAt("2026-07-01", 0, "14:30")).toBe("2026-07-01T21:30:00.000Z");
  });

  it("adds relativeOffsetDays across a month boundary", () => {
    // 2026-02-27 (Friday) + 3 days = 2026-03-02 (Monday, Feb 2026 has 28
    // days) — already a weekday, so the snap is a no-op here. 2026-03-02 is
    // still PST (UTC-8): the spring-forward transition doesn't land until
    // the second Sunday of March (2026-03-08) — see the "DST-exact PT
    // offset" describe block below for the transition-day tests. (A
    // month-bucket approximation would have wrongly called this PDT.)
    expect(taskDueAt("2026-02-27", 3, "09:00")).toBe("2026-03-02T17:00:00.000Z");
  });

  describe("weekend snap (a non-email step must never land outside sendDays)", () => {
    it("a Day-12 LinkedIn task from a Tuesday launch used to land on Sunday — now rolls to Monday", () => {
      // Launch Tue 2026-07-21 (day zero); +12 days = Sun 2026-08-02, which
      // is not in the default Mon-Fri sendDays -> snaps to Mon 2026-08-03.
      // August -> PDT (UTC-7): 09:00 PT = 16:00 UTC.
      expect(taskDueAt("2026-07-21", 12, "09:00")).toBe("2026-08-03T16:00:00.000Z");
    });

    it("a Saturday-landing offset snaps forward to Monday too", () => {
      // 2026-07-20 (Mon) + 5 days = Sat 2026-07-25 -> snaps to Mon 2026-07-27.
      expect(taskDueAt("2026-07-20", 5, "09:00")).toBe("2026-07-27T16:00:00.000Z");
    });

    it("honors a custom sendDays set instead of the Mon-Fri default", () => {
      // 2026-07-20 (Mon) + 1 day = Tue 2026-07-21, which IS allowed under
      // Tue/Thu-only sendDays -> no snap needed.
      expect(taskDueAt("2026-07-20", 1, "09:00", [2, 4])).toBe("2026-07-21T16:00:00.000Z");
      // 2026-07-20 (Mon) + 0 days = Mon 2026-07-20, NOT allowed under
      // Tue/Thu-only sendDays -> snaps forward to Tue 2026-07-21.
      expect(taskDueAt("2026-07-20", 0, "09:00", [2, 4])).toBe("2026-07-21T16:00:00.000Z");
    });
  });

  describe("DST-exact PT offset via taskDueAt (docket E5 — no more month-bucket approximation)", () => {
    it("February -> PST, UTC-8 (2026-02-15 is a Sunday, snaps to Mon 2026-02-16)", () => {
      expect(taskDueAt("2026-02-15", 0, "09:00")).toBe("2026-02-16T17:00:00.000Z");
    });
    it("early March, BEFORE the transition -> still PST, UTC-8 (2026-03-01 is a Sunday, snaps to Mon 2026-03-02; the 2026 transition is 2026-03-08, not the 1st of the month)", () => {
      // A month-bucket rule would have called this PDT (16:00Z) — this is
      // exactly the ~1-week window the old approximation got wrong.
      expect(taskDueAt("2026-03-01", 0, "09:00")).toBe("2026-03-02T17:00:00.000Z");
    });
    it("mid/late March, AFTER the transition -> PDT, UTC-7 (2026-03-09, the Monday right after the 2026-03-08 transition)", () => {
      expect(taskDueAt("2026-03-09", 0, "09:00")).toBe("2026-03-09T16:00:00.000Z");
    });
    it("early November, BEFORE the transition would still be PDT, but 2026-11-01 IS the transition Sunday, and 09:00 local is well after the 2am changeover -> PST, UTC-8, snaps to Mon 2026-11-02", () => {
      // A month-bucket rule would have called this PDT (16:00Z) through
      // the end of November — this is the other half of the bug.
      expect(taskDueAt("2026-11-01", 0, "09:00")).toBe("2026-11-02T17:00:00.000Z");
    });
    it("December -> PST, UTC-8 (2026-12-01 is already a Tuesday, no snap)", () => {
      expect(taskDueAt("2026-12-01", 0, "09:00")).toBe("2026-12-01T17:00:00.000Z");
    });
  });
});

describe("ptUtcOffsetHours (docket E5 — exact per-instant PT offset, replaces the old month-bucket table)", () => {
  // US DST 2026: spring forward 2026-03-08 at 2:00am PST -> 3:00am PDT
  // (the PST->PDT jump instant is 2026-03-08T10:00:00Z: 2:00 + 8h);
  // fall back 2026-11-01 at 2:00am PDT -> 1:00am PST (the PDT->PST jump
  // instant is 2026-11-01T09:00:00Z: 2:00 + 7h). Expectations are written
  // as UTC instants (via Date.UTC) specifically so this test is immune to
  // the host machine/CI runner's own local timezone.

  it("March 2026 transition: just before 2am local (still PST) is -8, just after (now PDT) is -7", () => {
    // 2026-03-08T09:59:00Z = 01:59 PST (one minute before the changeover).
    expect(ptUtcOffsetHours(new Date(Date.UTC(2026, 2, 8, 9, 59, 0)))).toBe(-8);
    // 2026-03-08T10:01:00Z = 03:01 PDT (one minute after — clocks jumped
    // straight from 2:00 to 3:00, so 03:01 is the first minute past it).
    expect(ptUtcOffsetHours(new Date(Date.UTC(2026, 2, 8, 10, 1, 0)))).toBe(-7);
  });

  it("November 2026 transition: just before 2am local (still PDT) is -7, just after (now PST) is -8", () => {
    // 2026-11-01T08:59:00Z = 01:59 PDT (one minute before the changeover).
    expect(ptUtcOffsetHours(new Date(Date.UTC(2026, 10, 1, 8, 59, 0)))).toBe(-7);
    // 2026-11-01T09:01:00Z = 01:01 PST (one minute after — clocks fell
    // back from 2:00 to 1:00, so 01:01 is the first minute past it).
    expect(ptUtcOffsetHours(new Date(Date.UTC(2026, 10, 1, 9, 1, 0)))).toBe(-8);
  });

  it("mid-summer date is PDT, -7 (2026-07-15, well inside the DST window)", () => {
    expect(ptUtcOffsetHours(new Date(Date.UTC(2026, 6, 15, 12, 0, 0)))).toBe(-7);
  });

  it("mid-winter date is PST, -8 (2026-01-15, well outside the DST window)", () => {
    expect(ptUtcOffsetHours(new Date(Date.UTC(2026, 0, 15, 12, 0, 0)))).toBe(-8);
  });
});
