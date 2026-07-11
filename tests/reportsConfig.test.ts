import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveRange } from "@/features/reports/standard/report-helpers";
import { ENTITY_DEFS } from "@/features/reports/report-config";
import { ALL_STAGES } from "@/lib/formatters";

// ---------------------------------------------------------------------------
// resolveRange() must classify "today" into the current quarter/year using
// LOCAL time, not UTC. The bug: on the last day of a quarter (or Dec 31), from
// late-afternoon US-local until midnight, UTC has already rolled into the next
// period, so a UTC-based preset resolved to the WRONG (next) period.
//
// We force America/Los_Angeles (west of UTC) so the UTC-vs-local distinction is
// observable regardless of the CI machine's own timezone. Node re-reads
// process.env.TZ on each Date operation, so setting it here is sufficient.
// ---------------------------------------------------------------------------

const ORIGINAL_TZ = process.env.TZ;

describe("resolveRange local-time boundaries", () => {
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ;
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("current_quarter: evening of Jun 30 (local) stays in Q2, not Q3", () => {
    // 2026-07-01T01:00Z === 2026-06-30 18:00 PDT. UTC would say July → Q3.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T01:00:00Z"));
    expect(resolveRange("current_quarter")).toEqual({
      start: "2026-04-01",
      end: "2026-06-30",
    });
  });

  it("current_year: evening of Dec 31 (local) stays in the current year, not next", () => {
    // 2027-01-01T02:00Z === 2026-12-31 18:00 PST. UTC would say 2027.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T02:00:00Z"));
    expect(resolveRange("current_year")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
  });

  it("last_year: evening of Dec 31 (local) resolves to the prior year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-01T02:00:00Z")); // 2026-12-31 local
    expect(resolveRange("last_year")).toEqual({
      start: "2025-01-01",
      end: "2025-12-31",
    });
  });

  it("last_quarter: from an early-Q3-in-UTC / late-Q2-in-local instant resolves to Q1", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T01:00:00Z")); // local = Q2 2026
    expect(resolveRange("last_quarter")).toEqual({
      start: "2026-01-01",
      end: "2026-03-31",
    });
  });

  it("mid-quarter is unaffected (sanity): Aug → Q3", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-15T12:00:00Z")); // 2026-08-15 05:00 PDT
    expect(resolveRange("current_quarter")).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    });
  });

  it("all_time stays open-ended", () => {
    expect(resolveRange("all_time")).toEqual({ start: null, end: null });
  });
});

// ---------------------------------------------------------------------------
// The Report Builder's opportunity Stage filter/column must offer exactly the
// live SF-matching stage set (formatters.ALL_STAGES). Migration
// 20260422000001 rewrote every opportunity/history row onto these values; the
// legacy stages (lead/qualified/proposal/verbal_commit) match zero live rows.
// ---------------------------------------------------------------------------

describe("Report Builder opportunity stage enum", () => {
  const LEGACY = ["lead", "qualified", "proposal", "verbal_commit"];

  it("filter enumValues equals the canonical live stage set", () => {
    const stageFilter = ENTITY_DEFS.opportunities.filterColumns.find(
      (c) => c.filterKey === "stage",
    );
    expect(stageFilter?.enumValues).toEqual([...ALL_STAGES]);
  });

  it("column enumValues equals the canonical live stage set", () => {
    const stageCol = ENTITY_DEFS.opportunities.columns.find(
      (c) => c.key === "stage",
    );
    expect(stageCol?.enumValues).toEqual([...ALL_STAGES]);
  });

  it("offers no dead legacy stage values", () => {
    const stageFilter = ENTITY_DEFS.opportunities.filterColumns.find(
      (c) => c.filterKey === "stage",
    );
    for (const dead of LEGACY) {
      expect(stageFilter?.enumValues).not.toContain(dead);
    }
  });
});
