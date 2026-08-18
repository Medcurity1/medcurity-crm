/**
 * The generic single-field Undo helpers added to
 * src/features/archive/bulk-undo.ts for the opportunities list's bulk
 * Stage and bulk Close Date changes.
 *
 * The property that matters: a selection almost never shares one prior
 * value. Undo has to put each row back to ITS OWN pre-change value, not
 * blanket-write whatever the majority had — so the capture keeps rows
 * distinct and the revert groups them into one UPDATE per distinct
 * value (including the unassigned/null group).
 */
import { describe, it, expect } from "vitest";
import {
  capturePriorValues,
  groupByPriorValue,
} from "../src/features/archive/bulk-undo";

describe("capturePriorValues", () => {
  it("captures each row's own pre-change value of the field", () => {
    const rows = [
      { id: "a", stage: "demo" },
      { id: "b", stage: "verbal_commit" },
    ];
    expect(capturePriorValues(rows, "stage")).toEqual([
      { id: "a", value: "demo" },
      { id: "b", value: "verbal_commit" },
    ]);
  });

  it("normalizes an unset field to null so it can be written back as null", () => {
    // An open deal with no forecast date yet: Undo must clear the date
    // again, not leave the bulk-applied one in place.
    const rows = [
      { id: "a", expected_close_date: null },
      { id: "b", expected_close_date: undefined },
      { id: "c" },
    ];
    expect(capturePriorValues(rows, "expected_close_date")).toEqual([
      { id: "a", value: null },
      { id: "b", value: null },
      { id: "c", value: null },
    ]);
  });

  it("stringifies so a date column compares cleanly against the picker value", () => {
    // The picker hands over "YYYY-MM-DD"; the row may carry a Date-ish
    // value. Both sides end up as strings, so the "already on that value,
    // skip the write" check can't be fooled by a type mismatch.
    const rows = [{ id: "a", expected_close_date: "2026-08-17" }];
    expect(capturePriorValues(rows, "expected_close_date")).toEqual([
      { id: "a", value: "2026-08-17" },
    ]);
  });

  it("returns nothing for an empty selection", () => {
    expect(capturePriorValues([], "stage")).toEqual([]);
  });
});

describe("groupByPriorValue", () => {
  it("collapses rows into one write per distinct prior value", () => {
    const grouped = groupByPriorValue([
      { id: "a", value: "demo" },
      { id: "b", value: "verbal_commit" },
      { id: "c", value: "demo" },
    ]);
    expect(grouped.size).toBe(2);
    expect(grouped.get("demo")).toEqual(["a", "c"]);
    expect(grouped.get("verbal_commit")).toEqual(["b"]);
  });

  it("keeps rows that had no value together under a single null key", () => {
    const grouped = groupByPriorValue([
      { id: "a", value: null },
      { id: "b", value: null },
      { id: "c", value: "2026-08-17" },
    ]);
    expect(grouped.size).toBe(2);
    expect(grouped.get(null)).toEqual(["a", "b"]);
    expect(grouped.get("2026-08-17")).toEqual(["c"]);
  });

  it("preserves selection order within each group", () => {
    const grouped = groupByPriorValue([
      { id: "c", value: "demo" },
      { id: "a", value: "demo" },
      { id: "b", value: "demo" },
    ]);
    expect(grouped.get("demo")).toEqual(["c", "a", "b"]);
  });
});
