import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

/**
 * Per-entity CSV export. One click pulls every row of every table
 * the user might want a snapshot of (accounts, contacts, leads,
 * opportunities, opportunity_products, products, price_books,
 * price_book_entries, partners, account_partners, activities,
 * tasks, events, lead_lists, lead_list_members, sequences,
 * email_templates, audit_log) and triggers one download per
 * entity. Mirrors the SF Data Export experience: full-fidelity
 * snapshot you can keep as a safety net before any destructive
 * operation, or feed back into the importer in
 * "Update specific fields" mode.
 *
 * No JSZip dep — browsers happily queue multiple file downloads
 * from a single user gesture, and one-CSV-per-entity is what the
 * importer expects to consume anyway.
 *
 * Selection semantics:
 *   - "all rows" = no filter, includes archived rows so it's a
 *     true snapshot. Archived rows are tagged in the archived_at
 *     column so anyone re-importing can decide what to do.
 *   - Each CSV column header is the raw DB column name, so
 *     round-tripping (export → edit in Excel → re-import) requires
 *     the importer's existing field-map fuzzy logic OR a manual
 *     map. The importer's "Update specific fields" mode (PR 2) is
 *     the intended consumer.
 */

type ExportTarget = {
  /** DB table name */
  table: string;
  /** human-friendly label */
  label: string;
  /** filename stem — `<stem>.csv` */
  filename: string;
};

const EXPORT_TARGETS: ExportTarget[] = [
  { table: "accounts", label: "Accounts", filename: "accounts" },
  { table: "contacts", label: "Contacts", filename: "contacts" },
  { table: "leads", label: "Leads", filename: "leads" },
  { table: "opportunities", label: "Opportunities", filename: "opportunities" },
  { table: "opportunity_products", label: "Opportunity Products", filename: "opportunity_products" },
  { table: "products", label: "Products", filename: "products" },
  { table: "price_books", label: "Price Books", filename: "price_books" },
  { table: "price_book_entries", label: "Price Book Entries", filename: "price_book_entries" },
  { table: "partners", label: "Partners", filename: "partners" },
  { table: "account_partners", label: "Account-Partner Links", filename: "account_partners" },
  { table: "activities", label: "Activities", filename: "activities" },
  { table: "tasks", label: "Tasks", filename: "tasks" },
  { table: "events", label: "Events", filename: "events" },
  { table: "lead_lists", label: "Lead Lists", filename: "lead_lists" },
  { table: "lead_list_members", label: "Lead List Members", filename: "lead_list_members" },
  { table: "audit_log", label: "Audit Log", filename: "audit_log" },
];

const PAGE_SIZE = 1000;

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "object") {
    // JSONB / arrays → JSON-encode so the column round-trips
    try {
      s = JSON.stringify(value);
    } catch {
      s = String(value);
    }
  } else {
    s = String(value);
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  // Union of every key seen across rows so the CSV doesn't drop
  // sparsely-populated columns (e.g. custom_fields, optional FK
  // ids that are null on most rows but present on some).
  const headerSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) headerSet.add(k);
  }
  const headers = Array.from(headerSet).sort();
  const lines: string[] = [];
  lines.push(headers.map(escapeCsvField).join(","));
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsvField(r[h])).join(","));
  }
  return lines.join("\n");
}

function todayStamp(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}${mi}`;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke a tick so the download actually starts before the
  // blob URL goes away (Safari has been finicky about immediate
  // revoke).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function fetchAllRows(table: string): Promise<Record<string, unknown>[]> {
  // Paginate so we don't blow the PostgREST max-rows limit on big
  // tables (audit_log, leads at ~42K, activities, etc.).
  const all: Record<string, unknown>[] = [];
  let from = 0;
  // No order column we can rely on across every table — fall back
  // to the implicit row order. Each request just asks for the
  // next slice; we stop when a slice returns less than PAGE_SIZE.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export function DataExport() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);
  const [results, setResults] = useState<{
    table: string;
    label: string;
    rowCount: number | null;
    error: string | null;
  }[]>([]);

  async function exportOne(target: ExportTarget) {
    const rows = await fetchAllRows(target.table);
    const stamp = todayStamp();
    const filename = `${target.filename}_${stamp}.csv`;
    if (rows.length === 0) {
      // Still write an empty file with a single column so the user
      // sees the table was exported (just empty), rather than
      // getting silent no-download surprise.
      const csv = "id\n";
      downloadCsv(filename, csv);
    } else {
      downloadCsv(filename, rowsToCsv(rows));
    }
    return rows.length;
  }

  async function handleExportAll() {
    if (busy) return;
    setBusy(true);
    setResults([]);
    const accumulated: typeof results = [];
    try {
      for (let i = 0; i < EXPORT_TARGETS.length; i++) {
        const target = EXPORT_TARGETS[i];
        setProgress({
          current: i + 1,
          total: EXPORT_TARGETS.length,
          label: target.label,
        });
        try {
          const count = await exportOne(target);
          accumulated.push({
            table: target.table,
            label: target.label,
            rowCount: count,
            error: null,
          });
          setResults([...accumulated]);
        } catch (err) {
          const message = (err as Error).message ?? String(err);
          accumulated.push({
            table: target.table,
            label: target.label,
            rowCount: null,
            error: message,
          });
          setResults([...accumulated]);
          // Keep going — one bad table (e.g., RLS denial on
          // audit_log for a non-super-admin) shouldn't stop the
          // rest. Per-table error is recorded for the user.
        }
      }
      const ok = accumulated.filter((r) => r.error === null).length;
      const failed = accumulated.filter((r) => r.error !== null).length;
      if (failed === 0) {
        toast.success(`Exported ${ok} tables.`);
      } else {
        toast.warning(
          `Exported ${ok} tables; ${failed} failed (see details below).`
        );
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function handleExportOne(target: ExportTarget) {
    if (busy) return;
    setBusy(true);
    setResults([]);
    setProgress({ current: 1, total: 1, label: target.label });
    try {
      const count = await exportOne(target);
      setResults([
        { table: target.table, label: target.label, rowCount: count, error: null },
      ]);
      toast.success(`Exported ${target.label}: ${count.toLocaleString()} rows.`);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      setResults([
        { table: target.table, label: target.label, rowCount: null, error: message },
      ]);
      toast.error(`Export of ${target.label} failed: ${message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          Export Data
        </CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          Download a CSV snapshot of every record, by entity. One file
          per table — same shape the importer accepts. Useful as a
          safety net before any bulk operation, or as a SF-Data-Export-style
          full backup on demand.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleExportAll} disabled={busy}>
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export everything ({EXPORT_TARGETS.length} CSVs)
              </>
            )}
          </Button>
          {progress && (
            <span className="text-sm text-muted-foreground">
              {progress.current}/{progress.total} — {progress.label}
            </span>
          )}
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Or export a single entity:</p>
          <div className="flex flex-wrap gap-2">
            {EXPORT_TARGETS.map((t) => (
              <Button
                key={t.table}
                variant="outline"
                size="sm"
                onClick={() => handleExportOne(t)}
                disabled={busy}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        {results.length > 0 && (
          <div className="border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Entity</th>
                  <th className="px-3 py-2 font-medium">Rows</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.table} className="border-t">
                    <td className="px-3 py-2">{r.label}</td>
                    <td className="px-3 py-2">
                      {r.rowCount === null ? "—" : r.rowCount.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-destructive">{r.error}</span>
                      ) : (
                        <span className="text-emerald-600">Downloaded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Files download as <code>{"<entity>_YYYY-MM-DD_HHMM.csv"}</code>.
          JSONB columns (e.g. <code>custom_fields</code>) are written as
          JSON strings so they round-trip cleanly. Browsers may prompt
          you to allow multiple downloads on the first run.
        </p>
      </CardContent>
    </Card>
  );
}
