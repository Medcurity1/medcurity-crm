/**
 * The list-page "Export CSV" engine
 * (src/features/list-export/csv-export.ts).
 *
 * Two things here are easy to get subtly wrong and impossible to notice
 * from the UI:
 *
 *  - the row ceiling. PostgREST caps a response at 1,000 rows, so an
 *    export pages; the boundary cases (exactly at the ceiling, one past
 *    it, a short final page that crosses it) decide whether the user
 *    gets a silently-clipped file or an honest warning.
 *  - column selection. The file has to carry the user's VISIBLE columns
 *    in their order — including dropping the row-checkbox column, which
 *    is `locked: true` and therefore always "visible".
 */
import { describe, it, expect } from "vitest";
import {
  fetchAllPages,
  buildExportTable,
  exportableColumns,
  exportFilename,
  chunkIds,
  hydrateInChunks,
  csvDate,
  csvNumber,
  csvText,
  type ExportValueMap,
} from "../src/features/list-export/csv-export";
import type { ColumnDescriptor } from "../src/features/list-columns/columns";

/** A fake paged source of `total` rows that records the ranges asked for. */
function pagedSource(total: number) {
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to]);
    const out: number[] = [];
    for (let i = from; i <= to && i < total; i++) out.push(i);
    return out;
  };
  return { fetchPage, calls };
}

describe("fetchAllPages", () => {
  it("stops as soon as a short page proves the set is exhausted", async () => {
    const { fetchPage, calls } = pagedSource(3);
    const { rows, truncated } = await fetchAllPages(fetchPage, {
      pageSize: 2,
      ceiling: 10,
    });
    expect(rows).toEqual([0, 1, 2]);
    expect(truncated).toBe(false);
    expect(calls).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("walks multiple full pages and concatenates them in order", async () => {
    const { fetchPage } = pagedSource(7);
    const { rows, truncated } = await fetchAllPages(fetchPage, {
      pageSize: 3,
      ceiling: 100,
    });
    expect(rows).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(truncated).toBe(false);
  });

  it("clips at the ceiling and reports the truncation", async () => {
    const { fetchPage } = pagedSource(50);
    const { rows, truncated } = await fetchAllPages(fetchPage, {
      pageSize: 2,
      ceiling: 4,
    });
    expect(rows).toEqual([0, 1, 2, 3]);
    expect(truncated).toBe(true);
  });

  it("does NOT report truncation when the set lands exactly on the ceiling", async () => {
    // The regression this guards: an off-by-one here tells a user their
    // complete 10,000-row export was clipped.
    const { fetchPage } = pagedSource(4);
    const { rows, truncated } = await fetchAllPages(fetchPage, {
      pageSize: 2,
      ceiling: 4,
    });
    expect(rows).toHaveLength(4);
    expect(truncated).toBe(false);
  });

  it("clips when a SHORT final page crosses the ceiling", async () => {
    // 5 rows, ceiling 4: the last page is partial (so the "exhausted"
    // exit fires) but the total is already over. Checking the ceiling
    // second would hand back 5 rows and claim nothing was clipped.
    const { fetchPage } = pagedSource(5);
    const { rows, truncated } = await fetchAllPages(fetchPage, {
      pageSize: 2,
      ceiling: 4,
    });
    expect(rows).toEqual([0, 1, 2, 3]);
    expect(truncated).toBe(true);
  });

  it("returns nothing, and no truncation, for an empty result", async () => {
    const { fetchPage } = pagedSource(0);
    expect(await fetchAllPages(fetchPage, { pageSize: 2, ceiling: 4 })).toEqual({
      rows: [],
      truncated: false,
    });
  });

  it("asks for inclusive ranges, matching PostgREST's .range() contract", async () => {
    const { fetchPage, calls } = pagedSource(5);
    await fetchAllPages(fetchPage, { pageSize: 2, ceiling: 100 });
    expect(calls).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });
});

describe("column selection", () => {
  const columns: ColumnDescriptor[] = [
    { key: "select", label: "Select", locked: true },
    { key: "name", label: "Name", locked: true },
    { key: "owner", label: "Owner" },
    { key: "notes", label: "Notes" },
  ];
  type Row = { name: string; owner: string | null; notes: string | null };
  const values: ExportValueMap<Row> = {
    name: (r) => r.name,
    owner: (r) => r.owner ?? "Unassigned",
    notes: (r) => csvText(r.notes),
  };

  it("drops the row-checkbox column even though it's always visible", () => {
    expect(exportableColumns(columns, values).map((c) => c.key)).toEqual([
      "name",
      "owner",
      "notes",
    ]);
  });

  it("drops columns the list has no CSV value for", () => {
    const withExtra = [...columns, { key: "actions", label: "Actions", locked: true }];
    expect(exportableColumns(withExtra, values).map((c) => c.key)).toEqual([
      "name",
      "owner",
      "notes",
    ]);
  });

  it("emits header labels and rows in the user's visible column order", () => {
    // A user who hid Notes and whose registry order puts Owner first.
    const visible: ColumnDescriptor[] = [
      { key: "select", label: "Select", locked: true },
      { key: "owner", label: "Owner" },
      { key: "name", label: "Name", locked: true },
    ];
    const table = buildExportTable(visible, values, [
      { name: "Acme", owner: null, notes: "hi" },
      { name: "Globex", owner: "Sam", notes: null },
    ]);
    expect(table).toEqual([
      ["Owner", "Name"],
      ["Unassigned", "Acme"],
      ["Sam", "Globex"],
    ]);
  });

  it("produces a header-only table when nothing matched the filters", () => {
    expect(buildExportTable(columns, values, [] as Row[])).toEqual([
      ["Name", "Owner", "Notes"],
    ]);
  });
});

describe("cell coercion", () => {
  it("keeps money numeric so Excel can sum it", () => {
    // Supabase serializes `numeric` as a string — the export must not.
    expect(csvNumber("28500.50")).toBe(28500.5);
    expect(csvNumber(0)).toBe(0);
    expect(csvNumber(null)).toBeNull();
    expect(csvNumber("")).toBeNull();
    expect(csvNumber("not a number")).toBeNull();
  });

  it("turns the table's em-dash placeholder into a genuinely empty cell", () => {
    const format = (v: string | null) => (v ? "Aug 17, 2026" : "—");
    expect(csvDate("2026-08-17", format)).toBe("Aug 17, 2026");
    expect(csvDate(null, format)).toBeNull();
    // A value the formatter itself rejects as invalid.
    expect(csvDate("garbage", () => "—")).toBeNull();
  });

  it("blanks whitespace-only text instead of exporting it", () => {
    expect(csvText("  Acme  ")).toBe("Acme");
    expect(csvText("   ")).toBeNull();
    expect(csvText(null)).toBeNull();
    expect(csvText(undefined)).toBeNull();
  });
});

describe("exportFilename", () => {
  it("stamps the LOCAL calendar date, not the UTC one", () => {
    // 2026-08-17 23:30 local. toISOString() would say the 18th anywhere
    // east of UTC-0:30, naming the file for tomorrow.
    const at = new Date(2026, 7, 17, 23, 30, 0);
    expect(exportFilename("accounts", at)).toBe("accounts-2026-08-17.csv");
  });

  it("zero-pads month and day", () => {
    expect(exportFilename("contacts", new Date(2026, 0, 5))).toBe(
      "contacts-2026-01-05.csv",
    );
  });
});

describe("hydrateInChunks", () => {
  it("splits ids into URL-safe batches", () => {
    expect(chunkIds(["a", "b", "c", "d", "e"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
    expect(chunkIds([], 2)).toEqual([]);
  });

  it("flattens every batch's rows, and never exceeds the batch size", async () => {
    const seen: string[][] = [];
    const out = await hydrateInChunks(
      ["a", "b", "c", "d", "e"],
      async (batch) => {
        seen.push(batch);
        return batch.map((id) => ({ id }));
      },
      { size: 2, concurrency: 2 },
    );
    expect(out.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(seen.every((b) => b.length <= 2)).toBe(true);
    expect(seen).toHaveLength(3);
  });

  it("does nothing when there are no ids", async () => {
    let called = false;
    const out = await hydrateInChunks([], async () => {
      called = true;
      return [];
    });
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });
});

// ── defaultHidden columns (Summer 8/19: the Expected Close column) ────

import { computeHiddenKeys } from "@/features/list-columns/useColumnPrefs";
import type { ColumnDescriptor } from "@/features/list-columns/columns";

describe("computeHiddenKeys (defaultHidden + shown allow-list)", () => {
  const cols: ColumnDescriptor[] = [
    { key: "select", label: "Select", locked: true },
    { key: "name", label: "Name", locked: true },
    { key: "amount", label: "Amount" },
    { key: "expected_close_forecast", label: "Expected Close", defaultHidden: true },
  ];

  it("hides defaultHidden columns until the user shows them", () => {
    expect([...computeHiddenKeys(cols, undefined)]).toEqual(["expected_close_forecast"]);
    expect([...computeHiddenKeys(cols, { hidden: [] })]).toEqual(["expected_close_forecast"]);
  });

  it("an explicit shown entry overrides defaultHidden; deny-list still works", () => {
    const hidden = computeHiddenKeys(cols, { hidden: ["amount"], shown: ["expected_close_forecast"] });
    expect(hidden.has("expected_close_forecast")).toBe(false);
    expect(hidden.has("amount")).toBe(true);
  });

  it("ignores stale keys and never hides locked columns", () => {
    const hidden = computeHiddenKeys(cols, { hidden: ["gone", "name"], shown: ["also-gone"] });
    expect(hidden.has("name")).toBe(false);
    expect(hidden.has("gone")).toBe(false);
    expect(hidden.has("expected_close_forecast")).toBe(true);
  });

  it("the Opportunities registry carries Expected Close as opt-in", () => {
    const src = require("fs").readFileSync(
      require("path").resolve(__dirname, "..", "src", "features", "opportunities", "OpportunitiesList.tsx"),
      "utf8",
    );
    expect(src).toMatch(/key: "expected_close_forecast", label: "Expected Close", sortKey: "expected_close_date", defaultHidden: true/);
    expect(src).toMatch(/expected_close_forecast: \(o\) => csvDate\(o\.expected_close_date/);
  });
});
