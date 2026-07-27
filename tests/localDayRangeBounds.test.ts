import { describe, it, expect } from "vitest";
import { parseLocalDate, localDayRangeBounds } from "@/lib/formatters";

// Regression tests for Summer's Activities date-filter bug (2026-07-27):
// "If you set the filter date for the 20th to the 24th, it does not count the
// 24th; if I set it for the 25th, I get the data for the 24th."
//
// Root cause: new Date("YYYY-MM-DD") parses as UTC midnight; in any
// negative-offset zone that's the previous local evening, so the old
// setHours(23,59,59) "end of day" landed on the previous local day.
// These tests are timezone-independent: they assert against local-time
// Date components, so they pass in CI regardless of the runner's TZ.

describe("parseLocalDate", () => {
  it("parses YYYY-MM-DD as LOCAL midnight, not UTC", () => {
    const d = parseLocalDate("2026-07-24");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // July
    expect(d.getDate()).toBe(24); // the 24th in LOCAL time — the bug's crux
    expect(d.getHours()).toBe(0);
  });

  it("tolerates a full ISO string by using only the date part", () => {
    const d = parseLocalDate("2026-07-24T15:30:00Z");
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(0);
  });
});

describe("localDayRangeBounds", () => {
  it("an activity at any local time on the end day is inside the range", () => {
    const { gte, lt } = localDayRangeBounds("2026-07-20", "2026-07-24");
    // 11:59pm LOCAL on the 24th — the exact class of row Summer lost.
    const lateOnEndDay = new Date(2026, 6, 24, 23, 59, 59);
    expect(lateOnEndDay.toISOString() >= gte!).toBe(true);
    expect(lateOnEndDay.toISOString() < lt!).toBe(true);
    // 12:00am LOCAL on the 25th is outside.
    const nextDay = new Date(2026, 6, 25, 0, 0, 0);
    expect(nextDay.toISOString() < lt!).toBe(false);
  });

  it("an activity early on the start day is inside; the prior evening is not", () => {
    const { gte } = localDayRangeBounds("2026-07-20", "2026-07-24");
    const earlyOnStartDay = new Date(2026, 6, 20, 0, 0, 1);
    expect(earlyOnStartDay.toISOString() >= gte!).toBe(true);
    // The old code passed the bare string (UTC midnight): in US zones that
    // let the previous local evening leak in. Local midnight must not.
    const priorEvening = new Date(2026, 6, 19, 23, 0, 0);
    expect(priorEvening.toISOString() >= gte!).toBe(false);
  });

  it("single-day range (start = end) covers exactly that local day", () => {
    const { gte, lt } = localDayRangeBounds("2026-07-24", "2026-07-24");
    expect(new Date(2026, 6, 24, 12, 0, 0).toISOString() >= gte!).toBe(true);
    expect(new Date(2026, 6, 24, 12, 0, 0).toISOString() < lt!).toBe(true);
    expect(new Date(2026, 6, 23, 12, 0, 0).toISOString() >= gte!).toBe(false);
    expect(new Date(2026, 6, 25, 12, 0, 0).toISOString() < lt!).toBe(false);
  });

  it("open-ended ranges omit the missing bound", () => {
    expect(localDayRangeBounds("2026-07-20", null)).not.toHaveProperty("lt");
    expect(localDayRangeBounds(null, "2026-07-24")).not.toHaveProperty("gte");
    expect(localDayRangeBounds(null, null)).toEqual({});
  });

  it("month boundary: end on the 31st rolls the exclusive bound into the next month", () => {
    const { lt } = localDayRangeBounds(null, "2026-07-31");
    expect(new Date(2026, 6, 31, 23, 59, 59).toISOString() < lt!).toBe(true);
    expect(new Date(2026, 7, 1, 0, 0, 0).toISOString() < lt!).toBe(false);
  });
});
