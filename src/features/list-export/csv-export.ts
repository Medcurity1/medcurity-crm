/**
 * "Export CSV" engine shared by the Accounts / Contacts / Opportunities
 * list toolbars.
 *
 * The promise the button makes is "you get exactly what you're looking
 * at": the SAME filter set the list is running, the SAME columns the
 * user has visible, in the SAME order — just without pagination. This
 * module owns the two parts of that which aren't list-specific:
 *
 *  1. paging past PostgREST's 1,000-row response cap (`fetchAllPages`)
 *  2. turning visible ColumnDescriptors + a per-column value function
 *     into the 2-D table `downloadCsv` wants (`buildExportTable`)
 *
 * Everything here is deliberately pure/injectable so it can be unit
 * tested without a browser or a Supabase client — the per-list query
 * building lives next to each list's own query, in its feature api.ts.
 */

import type { ColumnDescriptor } from "@/features/list-columns/columns";

/**
 * Rows per request. PostgREST refuses to return more than 1,000 rows in
 * one response regardless of the `.range()` we ask for, so this is a
 * ceiling imposed on us, not a tuning knob.
 */
export const EXPORT_PAGE_SIZE = 1000;

/**
 * Hard stop on an export. A rep who filters to nothing and hits Export
 * would otherwise pull ~50k accounts down the wire a thousand at a time
 * — ten sequential round trips is already the most we should spend on a
 * button press, and Excel stops being the right tool well before then.
 */
export const EXPORT_ROW_CEILING = 10_000;

/** Toast copy when the ceiling clipped the result. */
export const EXPORT_TRUNCATED_MESSAGE = `Exported first ${EXPORT_ROW_CEILING.toLocaleString()} — narrow your filters`;

export interface FetchAllPagesResult<T> {
  rows: T[];
  /** True when more rows matched than the ceiling allows. */
  truncated: boolean;
}

/**
 * Walk a filtered query to completion, `EXPORT_PAGE_SIZE` rows at a
 * time, stopping at `EXPORT_ROW_CEILING`.
 *
 * `fetchPage` takes an INCLUSIVE `[from, to]` range (PostgREST's
 * `.range()` contract) and returns that slice.
 *
 * Truncation is detected by asking for one page beyond the ceiling
 * rather than by trusting a count: `count: "estimated"` (what the list
 * queries use) is exactly that — an estimate — and would report the
 * wrong answer near the boundary. The extra request only happens when
 * the result actually reaches the ceiling.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  opts?: { pageSize?: number; ceiling?: number },
): Promise<FetchAllPagesResult<T>> {
  const pageSize = opts?.pageSize ?? EXPORT_PAGE_SIZE;
  const ceiling = opts?.ceiling ?? EXPORT_ROW_CEILING;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    rows.push(...page);
    // Ceiling is checked BEFORE the short-page exit: a final partial page
    // can still push the total past the ceiling (e.g. ceiling 10,000 with
    // 10,001 matching rows), and exiting on "short page" first would
    // return 10,001 rows and report truncated: false.
    if (rows.length > ceiling) {
      return { rows: rows.slice(0, ceiling), truncated: true };
    }
    // Short page => the filtered set is exhausted; nothing was clipped.
    if (page.length < pageSize) return { rows, truncated: false };
  }
}

/**
 * Ids per `.in(...)` lookup when hydrating derived columns (last touch,
 * primary contact, tags) for an exported set.
 *
 * The list hydrates these one PAGE at a time — 25-100 ids. An export can
 * be 10,000, and PostgREST takes the id list in the request URL (~37
 * chars per UUID), so it has to be split or the request is rejected for
 * URL length. 200 ids ≈ 7.4KB of URL, comfortably inside the usual 8KB
 * server limit.
 */
export const HYDRATE_CHUNK_SIZE = 200;

/** Split ids into `.in(...)`-sized batches. */
export function chunkIds(ids: string[], size: number = HYDRATE_CHUNK_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Run `fn` over id batches with bounded concurrency and flatten the
 * results. Bounded rather than `Promise.all` over every batch at once:
 * a 10,000-row export is 50 batches, and firing 50 simultaneous requests
 * at Supabase is how an export turns into a self-inflicted rate limit.
 */
export async function hydrateInChunks<T>(
  ids: string[],
  fn: (batch: string[]) => Promise<T[]>,
  opts?: { size?: number; concurrency?: number },
): Promise<T[]> {
  const batches = chunkIds(ids, opts?.size ?? HYDRATE_CHUNK_SIZE);
  const concurrency = opts?.concurrency ?? 4;
  const out: T[] = [];
  for (let i = 0; i < batches.length; i += concurrency) {
    const wave = await Promise.all(batches.slice(i, i + concurrency).map(fn));
    for (const part of wave) out.push(...part);
  }
  return out;
}

/**
 * A column's CSV value for one row.
 *
 * Return a `number` for anything Excel should treat as numeric (money,
 * counts) — `@/lib/csv` writes finite numbers unquoted so SUM and pivot
 * tables work on them. Return a string for everything else, and `null`
 * for "blank" (the list renders an em dash there; a CSV should be an
 * empty cell, not a literal "—").
 */
export type ExportValue = string | number | null;

/** Per-column value extractors, keyed by `ColumnDescriptor.key`. */
export type ExportValueMap<T> = Record<string, (row: T) => ExportValue>;

/**
 * Columns that exist for interaction, not information — they carry no
 * value worth a CSV column. `select` is the row checkbox, present and
 * `locked: true` on all three lists.
 */
const NON_DATA_COLUMN_KEYS = new Set(["select"]);

/** The columns an export actually emits, in the user's visible order. */
export function exportableColumns<T>(
  visibleColumns: ColumnDescriptor[],
  values: ExportValueMap<T>,
): ColumnDescriptor[] {
  return visibleColumns.filter(
    (c) => !NON_DATA_COLUMN_KEYS.has(c.key) && typeof values[c.key] === "function",
  );
}

/**
 * Header row + one row per record, ready for `downloadCsv`.
 *
 * Column ORDER and column CHOICE both come from `visibleColumns` (the
 * user's saved prefs, in registry order), so the file matches the table
 * they were just looking at rather than some canonical field list.
 */
export function buildExportTable<T>(
  visibleColumns: ColumnDescriptor[],
  values: ExportValueMap<T>,
  rows: T[],
): unknown[][] {
  const cols = exportableColumns(visibleColumns, values);
  const header = cols.map((c) => c.label);
  const body = rows.map((row) => cols.map((c) => values[c.key](row)));
  return [header, ...body];
}

/** `accounts-2026-08-17.csv` — local calendar date, not UTC. */
export function exportFilename(prefix: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${prefix}-${y}-${m}-${d}.csv`;
}

/**
 * A date value for CSV. The lists render dates through
 * `formatDate` ("Aug 17, 2026"); pass that same formatter in so the file
 * reads like the screen, but map its em-dash "no value" sentinel back to
 * a genuinely empty cell.
 */
export function csvDate(
  value: string | null | undefined,
  format: (v: string | null) => string,
): ExportValue {
  if (!value) return null;
  const out = format(value);
  return out === "—" ? null : out;
}

/**
 * A money value for CSV: a plain finite number so Excel sums it.
 * Supabase serializes `numeric` columns as strings, hence the coercion.
 */
export function csvNumber(value: number | string | null | undefined): ExportValue {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A text value for CSV: trimmed, with blank/whitespace-only => empty cell. */
export function csvText(value: string | null | undefined): ExportValue {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}
