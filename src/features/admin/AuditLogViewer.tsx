import { useState, Fragment, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Search, Download, X } from "lucide-react";
import { formatRelativeDate } from "@/lib/formatters";
import { format, parseISO, subDays, subHours } from "date-fns";
import { toast } from "sonner";
import * as XLSX from "xlsx";

const PAGE_SIZE = 25;

const ENTITY_OPTIONS = [
  { value: "all", label: "All Entities" },
  { value: "accounts", label: "Accounts" },
  { value: "contacts", label: "Contacts" },
  { value: "opportunities", label: "Opportunities" },
  { value: "leads", label: "Leads" },
  { value: "activities", label: "Activities" },
  { value: "products", label: "Products" },
  { value: "opportunity_products", label: "Opp. Products" },
  { value: "price_books", label: "Price Books" },
  { value: "price_book_entries", label: "Price Book Entries" },
  { value: "automation_rules", label: "Automation Rules" },
  { value: "email_templates", label: "Email Templates" },
  { value: "user_profiles", label: "Users" },
] as const;

const ACTION_OPTIONS = [
  { value: "all", label: "All Actions" },
  { value: "INSERT", label: "Insert" },
  { value: "UPDATE", label: "Update" },
  { value: "DELETE", label: "Delete" },
] as const;

const DATE_RANGE_OPTIONS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
] as const;

const ENTITY_LABELS: Record<string, string> = {
  accounts: "Account",
  contacts: "Contact",
  opportunities: "Opportunity",
  leads: "Lead",
  activities: "Activity",
  products: "Product",
  opportunity_products: "Opp. Product",
  price_books: "Price Book",
  price_book_entries: "Price Book Entry",
  user_profiles: "User",
  automation_rules: "Automation Rule",
  email_templates: "Email Template",
};

const ENTITY_ROUTES: Record<string, string> = {
  accounts: "/accounts",
  contacts: "/contacts",
  opportunities: "/opportunities",
  leads: "/leads",
};

/** Fields to skip when showing changes */
const SKIP_FIELDS = new Set(["updated_at", "created_at"]);

interface AuditLogRow {
  id: number;
  table_name: string;
  record_id: string;
  action: string;
  changed_by: string | null;
  changed_at: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changer_full_name: string | null;
  total_count: number;
}

function getDateCutoff(range: string): string | null {
  const now = new Date();
  switch (range) {
    case "24h":
      return subHours(now, 24).toISOString();
    case "7d":
      return subDays(now, 7).toISOString();
    case "30d":
      return subDays(now, 30).toISOString();
    default:
      return null;
  }
}

function useAuditLogs(filters: {
  entity: string;
  action: string;
  dateRange: string;
  search: string;
  recordId: string;
  page: number;
}) {
  return useQuery({
    queryKey: ["audit_logs_search", filters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_audit_logs", {
        search_term: filters.search || null,
        entity_filter: filters.entity === "all" ? null : filters.entity,
        action_filter: filters.action === "all" ? null : filters.action,
        record_id_filter: filters.recordId || null,
        date_cutoff: getDateCutoff(filters.dateRange),
        page_offset: filters.page * PAGE_SIZE,
        page_limit: PAGE_SIZE,
      });
      if (error) throw error;
      const rows = (data ?? []) as AuditLogRow[];
      return {
        logs: rows,
        totalCount: rows[0]?.total_count ?? 0,
      };
    },
  });
}

/** Fetch ALL matching rows for export (caps at 5000 to avoid runaway downloads) */
async function fetchAllForExport(filters: {
  entity: string;
  action: string;
  dateRange: string;
  search: string;
  recordId: string;
}): Promise<AuditLogRow[]> {
  const all: AuditLogRow[] = [];
  const EXPORT_PAGE = 500;
  const MAX = 5000;
  for (let offset = 0; offset < MAX; offset += EXPORT_PAGE) {
    const { data, error } = await supabase.rpc("search_audit_logs", {
      search_term: filters.search || null,
      entity_filter: filters.entity === "all" ? null : filters.entity,
      action_filter: filters.action === "all" ? null : filters.action,
      record_id_filter: filters.recordId || null,
      date_cutoff: getDateCutoff(filters.dateRange),
      page_offset: offset,
      page_limit: EXPORT_PAGE,
    });
    if (error) throw error;
    const rows = (data ?? []) as AuditLogRow[];
    all.push(...rows);
    if (rows.length < EXPORT_PAGE) break;
  }
  return all;
}

function formatTimestamp(dateString: string): string {
  return format(parseISO(dateString), "MMM d, yyyy h:mm a");
}

function truncateUUID(id: string): string {
  return id.slice(0, 8) + "...";
}

interface ChangedField {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

function computeChanges(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null
): ChangedField[] {
  if (!oldData || !newData) return [];
  const changes: ChangedField[] = [];
  const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  for (const key of allKeys) {
    if (SKIP_FIELDS.has(key)) continue;
    const oldVal = oldData[key];
    const newVal = newData[key];
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({ field: key, oldValue: oldVal, newValue: newVal });
    }
  }
  return changes;
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return "(empty)";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function changesSummaryText(log: AuditLogRow): string {
  if (log.action === "INSERT") return "Created";
  if (log.action === "DELETE") return "Deleted";
  const changes = computeChanges(log.old_data, log.new_data);
  if (!changes.length) return "No field changes";
  return changes
    .map(
      (c) =>
        `${c.field}: "${formatValue(c.oldValue)}" → "${formatValue(c.newValue)}"`
    )
    .join("; ");
}

function ActionBadge({ action }: { action: string }) {
  const classes =
    action === "INSERT"
      ? "bg-emerald-100 text-emerald-700 border-emerald-200"
      : action === "DELETE"
        ? "bg-red-100 text-red-700 border-red-200"
        : "bg-blue-100 text-blue-700 border-blue-200";

  return (
    <Badge variant="outline" className={classes}>
      {action}
    </Badge>
  );
}

function ChangesSummary({ log }: { log: AuditLogRow }) {
  const [showAll, setShowAll] = useState(false);

  if (log.action === "INSERT") {
    return <span className="text-sm text-emerald-600">Created</span>;
  }
  if (log.action === "DELETE") {
    return <span className="text-sm text-red-600">Deleted</span>;
  }

  const changes = computeChanges(log.old_data, log.new_data);
  if (!changes.length) {
    return <span className="text-sm text-muted-foreground">No field changes</span>;
  }

  const visible = showAll ? changes : changes.slice(0, 3);
  const hasMore = changes.length > 3;

  return (
    <div className="space-y-0.5">
      {visible.map((c) => (
        <div key={c.field} className="text-xs">
          <span className="font-medium">{c.field}</span>:{" "}
          <span className="text-muted-foreground">
            &quot;{formatValue(c.oldValue)}&quot;
          </span>{" "}
          <span className="text-muted-foreground">&rarr;</span>{" "}
          <span>&quot;{formatValue(c.newValue)}&quot;</span>
        </div>
      ))}
      {hasMore && !showAll && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowAll(true);
          }}
          className="text-xs text-primary hover:underline"
        >
          +{changes.length - 3} more
        </button>
      )}
    </div>
  );
}

function ExpandedRow({ log }: { log: AuditLogRow }) {
  return (
    <TableRow>
      <TableCell colSpan={7} className="bg-muted/30 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold mb-1">Old Data</p>
            <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
              {log.old_data
                ? JSON.stringify(log.old_data, null, 2)
                : "(none)"}
            </pre>
          </div>
          <div>
            <p className="text-xs font-semibold mb-1">New Data</p>
            <pre className="text-xs bg-muted rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
              {log.new_data
                ? JSON.stringify(log.new_data, null, 2)
                : "(none)"}
            </pre>
          </div>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AuditLogViewer() {
  const [searchParams, setSearchParams] = useSearchParams();

  const entity = searchParams.get("entity") ?? "all";
  const action = searchParams.get("action") ?? "all";
  const dateRange = searchParams.get("range") ?? "7d";
  const search = searchParams.get("q") ?? "";
  const recordId = searchParams.get("record_id") ?? "";
  const page = Number(searchParams.get("page") ?? "0");

  const [searchInput, setSearchInput] = useState(search);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  function updateParam(key: string, value: string | null) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === "" || value === "all") {
          next.delete(key);
        } else {
          next.set(key, value);
        }
        if (key !== "page") next.delete("page");
        return next;
      },
      { replace: true }
    );
  }

  const { data, isLoading } = useAuditLogs({
    entity,
    action,
    dateRange,
    search,
    recordId,
    page,
  });

  const logs = data?.logs ?? [];
  const totalCount = data?.totalCount ?? 0;

  const filters = useMemo(
    () => ({ entity, action, dateRange, search, recordId }),
    [entity, action, dateRange, search, recordId]
  );

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParam("q", searchInput.trim() || null);
  }

  function handleClearRecordFilter() {
    updateParam("record_id", null);
  }

  async function handleExport(fmt: "csv" | "xlsx") {
    setExporting(true);
    try {
      const rows = await fetchAllForExport(filters);
      if (rows.length === 0) {
        toast.info("No audit entries to export for the current filters");
        return;
      }
      const flat = rows.map((r) => ({
        Timestamp: formatTimestamp(r.changed_at),
        Entity: ENTITY_LABELS[r.table_name] ?? r.table_name,
        Action: r.action,
        "Changed By": r.changer_full_name ?? "System",
        "Record ID": r.record_id,
        Changes: changesSummaryText(r),
        "Old Data": r.old_data ? JSON.stringify(r.old_data) : "",
        "New Data": r.new_data ? JSON.stringify(r.new_data) : "",
      }));

      const stamp = format(new Date(), "yyyyMMdd_HHmm");
      if (fmt === "csv") {
        const header = Object.keys(flat[0]);
        const csvRows = [
          header.join(","),
          ...flat.map((row) =>
            header
              .map((h) => {
                const v = String(row[h as keyof typeof row] ?? "");
                const escaped = v.replace(/"/g, '""');
                return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
              })
              .join(",")
          ),
        ];
        const blob = new Blob([csvRows.join("\n")], {
          type: "text/csv;charset=utf-8;",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit_log_${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const ws = XLSX.utils.json_to_sheet(flat);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Audit Log");
        XLSX.writeFile(wb, `audit_log_${stamp}.xlsx`);
      }
      toast.success(`Exported ${rows.length} audit entries`);
    } catch (err) {
      console.error(err);
      toast.error("Export failed: " + (err as Error).message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search record ID, user, or any field value..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {search && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput("");
                updateParam("q", null);
              }}
            >
              Clear
            </Button>
          )}
        </form>

        {recordId && (
          <div className="flex items-center gap-2 text-sm">
            <Badge variant="outline" className="gap-1">
              Record: <span className="font-mono">{truncateUUID(recordId)}</span>
              <button
                type="button"
                onClick={handleClearRecordFilter}
                className="ml-1 hover:text-destructive"
                aria-label="Clear record filter"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
            <span className="text-xs text-muted-foreground">
              Showing history for one record
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Select value={entity} onValueChange={(v) => updateParam("entity", v)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={action} onValueChange={(v) => updateParam("action", v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              {ACTION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={dateRange}
            onValueChange={(v) => updateParam("range", v)}
          >
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Date Range" />
            </SelectTrigger>
            <SelectContent>
              {DATE_RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleExport("csv")}
              disabled={exporting}
            >
              <Download className="h-4 w-4 mr-1.5" />
              CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleExport("xlsx")}
              disabled={exporting}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Excel
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No audit log entries found for the selected filters.
        </p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Timestamp</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Changed By</TableHead>
                <TableHead>Record ID</TableHead>
                <TableHead>Changes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => {
                const isExpanded = expandedId === log.id;
                const route = ENTITY_ROUTES[log.table_name];

                return (
                  <Fragment key={log.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        setExpandedId(isExpanded ? null : log.id)
                      }
                    >
                      <TableCell className="w-8 px-2">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        <div>{formatTimestamp(log.changed_at)}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatRelativeDate(log.changed_at)}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        {ENTITY_LABELS[log.table_name] ?? log.table_name}
                      </TableCell>
                      <TableCell>
                        <ActionBadge action={log.action} />
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.changer_full_name ?? "System"}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {route ? (
                          <Link
                            to={`${route}/${log.record_id}`}
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {truncateUUID(log.record_id)}
                          </Link>
                        ) : (
                          truncateUUID(log.record_id)
                        )}
                      </TableCell>
                      <TableCell>
                        <ChangesSummary log={log} />
                      </TableCell>
                    </TableRow>
                    {isExpanded && <ExpandedRow log={log} />}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalCount}
        onPageChange={(p) => updateParam("page", String(p))}
      />
    </div>
  );
}
