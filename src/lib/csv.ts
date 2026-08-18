/**
 * Shared CSV export engine.
 *
 * Before this file existed, CSV export was hand-rolled at 7 different
 * call sites (report-helpers.ts plus 6 features), each with its own
 * escaping logic and only one of the seven prepending the UTF-8 BOM
 * Excel needs to render accents and smart quotes correctly instead of
 * mangling them. This is the one place that builds and downloads a
 * CSV file — everything else should compute its rows and call
 * `downloadCsv`.
 */

/**
 * Escape one cell for CSV per RFC 4180 (minimal/conditional quoting):
 * the field is wrapped in double quotes — with embedded double quotes
 * doubled — only when it contains a comma, double quote, or line
 * break. `null`/`undefined` become an empty field.
 *
 * Finite numbers are written bare (unquoted) on purpose, so
 * Excel/Sheets treats them as numeric values instead of text — some
 * reports (e.g. ARR Base Dataset's Amount / Account Number columns)
 * rely on this for SUM/pivot-table compatibility.
 */
function escapeCell(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number" && Number.isFinite(cell)) {
    return String(cell);
  }
  const s = String(cell);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build RFC 4180 CSV text (no BOM) from a 2-D table (header row +
 * data rows). Exposed separately from `downloadCsv` for callers that
 * want the raw text (tests, previews, or combining with other text)
 * without triggering a browser download.
 */
export function buildCsv(rows: unknown[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\n");
}

/**
 * Build a CSV file from a 2-D table (header row + data rows) and
 * trigger a browser download.
 *
 * Always prepends a UTF-8 BOM (U+FEFF). Without it, Excel guesses the
 * file's encoding and frequently gets it wrong, mangling accents and
 * smart quotes. This one function is now the only place that decision
 * gets made, so every export in the app benefits.
 */
export function downloadCsv(filename: string, rows: unknown[][]): void {
  const csv = buildCsv(rows);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Deferred revoke — Safari has been finicky about revoking the
  // object URL synchronously, especially when several downloads fire
  // in quick succession (e.g. DataExport's per-table export loop).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
