import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Database,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  FileBarChart,
  Upload,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  UserPlus,
  ChevronLeft,
  ChevronsRight,
} from "lucide-react";
import { formatDate } from "@/lib/formatters";
import { Link } from "react-router-dom";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { toast } from "sonner";
import { useBulkUpdateOwner as useBulkUpdateAccountOwner } from "@/features/accounts/api";
import { useBulkUpdateOwner as useBulkUpdateContactOwner } from "@/features/contacts/api";
import { useBulkUpdateOwner as useBulkUpdateOpportunityOwner } from "@/features/opportunities/api";
import { useBulkUpdateOwner as useBulkUpdateLeadOwner } from "@/features/leads/api";

/* ---------- Types ---------- */

interface DatabaseStats {
  total_rows: number;
  database_size: string;
  database_size_bytes: number;
  largest_tables: { table: string; rows: number; size: string }[] | null;
  audit_log_count: number;
  oldest_audit_log: string | null;
}

interface DataHealthRow {
  entity: string;
  total_records: number;
  archived_records: number;
  created_last_24h: number;
  modified_last_24h: number;
  missing_name: number;
  unassigned_records: number;
}

interface DrilldownRecord {
  id: string;
  name: string;
  issue: string;
}

/* ---------- Hooks ---------- */

function useDatabaseStats() {
  return useQuery({
    queryKey: ["database_stats"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_database_stats");
      if (error) throw error;
      return data as DatabaseStats;
    },
  });
}

function useDataHealthCheck() {
  return useQuery({
    queryKey: ["data_health_check"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("data_health_check")
        .select("*");
      if (error) throw error;
      return data as DataHealthRow[];
    },
  });
}

/* ---------- Drilldown fetcher (paginated) ---------- */

const PAGE_SIZE = 25;

interface DrilldownResult {
  records: DrilldownRecord[];
  totalCount: number;
}

async function fetchDrilldown(
  entity: string,
  issue: "unassigned" | "missing_name",
  page: number
): Promise<DrilldownResult> {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const tableName = entity;

  const isNameEntity = entity === "contacts" || entity === "leads";
  const selectCols = isNameEntity ? "id, first_name, last_name" : "id, name";

  let query = supabase
    .from(tableName)
    .select(selectCols, { count: "exact" })
    .is("archived_at", null);

  if (issue === "unassigned") {
    query = query.is("owner_user_id", null);
  } else {
    // missing_name
    if (isNameEntity) {
      query = query.or("first_name.is.null,last_name.is.null");
    } else {
      query = query.or("name.is.null,name.eq.");
    }
  }

  query = isNameEntity
    ? query.order("last_name", { nullsFirst: false })
    : query.order("name", { nullsFirst: false });

  const { data, count, error } = await query.range(from, to);
  if (error) throw error;

  const issueLabel = issue === "unassigned" ? "No owner assigned" : "Missing name";

  // The dynamic select string defeats Supabase's type inference, so we cast
  // the rows to a plain record shape for the mapping below.
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const records: DrilldownRecord[] = rows.map((r) => {
    if (isNameEntity) {
      const first = (r.first_name as string | null) ?? "";
      const last = (r.last_name as string | null) ?? "";
      const full = `${first} ${last}`.trim();
      return {
        id: r.id as string,
        name: full || `ID: ${(r.id as string).slice(0, 8)}`,
        issue: issueLabel,
      };
    }
    const name = (r.name as string | null) ?? "";
    return {
      id: r.id as string,
      name: name || `ID: ${(r.id as string).slice(0, 8)}`,
      issue: issueLabel,
    };
  });

  return { records, totalCount: count ?? 0 };
}

function entityPath(entity: string): string {
  switch (entity) {
    case "accounts": return "/accounts";
    case "contacts": return "/contacts";
    case "opportunities": return "/opportunities";
    case "leads": return "/leads";
    default: return "/";
  }
}

/* ---------- Constants ---------- */

const SUPABASE_FREE_TIER_BYTES = 500 * 1024 * 1024; // 500 MB

const PROTECTION_CHECKLIST = [
  { enabled: true, label: "Soft deletes enabled (all records archived, not deleted)" },
  { enabled: true, label: "Audit logging active (every change tracked with old/new values)" },
  { enabled: true, label: "Row Level Security enforced (all tables)" },
  { enabled: true, label: "SF IDs preserved (Salesforce migration IDs tracked)" },
  { enabled: true, label: "Duplicate detection active (on account/contact/lead creation)" },
  { enabled: false, label: "Automated backups (Supabase handles daily backups on Pro plan)" },
  { enabled: false, label: "Point-in-time recovery (available on Pro plan)" },
];

/* ---------- Drilldown Panel ---------- */

function useEntityBulkOwnerMutation(entity: string) {
  const accountsMut = useBulkUpdateAccountOwner();
  const contactsMut = useBulkUpdateContactOwner();
  const opportunitiesMut = useBulkUpdateOpportunityOwner();
  const leadsMut = useBulkUpdateLeadOwner();

  switch (entity) {
    case "accounts":
      return accountsMut;
    case "contacts":
      return contactsMut;
    case "opportunities":
      return opportunitiesMut;
    case "leads":
      return leadsMut;
    default:
      return null;
  }
}

function DrilldownPanel({ entity, issue, onClose }: {
  entity: string;
  issue: "unassigned" | "missing_name";
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [ownerDialogOpen, setOwnerDialogOpen] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["data_health_drilldown", entity, issue, page],
    queryFn: () => fetchDrilldown(entity, issue, page),
  });

  const records = data?.records ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const bulkOwnerMutation = useEntityBulkOwnerMutation(entity);

  const issueLabel = issue === "unassigned" ? "Unassigned" : "Missing Data";

  const allOnPageSelected =
    records.length > 0 && records.every((r) => selectedIds.has(r.id));

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function togglePage() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        records.forEach((r) => next.delete(r.id));
      } else {
        records.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }

  async function handleBulkAssign(newOwnerId: string) {
    if (!bulkOwnerMutation) {
      toast.error("Bulk assign is not supported for this entity.");
      return;
    }
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await bulkOwnerMutation.mutateAsync({ ids, owner_user_id: newOwnerId });
      toast.success(`Assigned owner to ${ids.length} ${entity}.`);
      setSelectedIds(new Set());
      // Invalidate handled by the mutation onSuccess; refetching this drilldown
      // will happen via queryKey change on page flip or manual re-open.
    } catch (err) {
      console.error("Bulk assign failed:", err);
      toast.error("Bulk assign failed: " + (err as Error).message);
    }
  }

  const supportsBulkAssign =
    issue === "unassigned" && bulkOwnerMutation !== null;

  const firstIdx = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastIdx = Math.min(totalCount, (page + 1) * PAGE_SIZE);

  return (
    <TableRow>
      <TableCell colSpan={7} className="p-0">
        <div className="bg-muted/30 border-t px-4 py-3">
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <h4 className="text-sm font-medium capitalize">
              {issueLabel} {entity}
              {totalCount > 0 && (
                <span className="ml-2 text-muted-foreground font-normal">
                  ({totalCount} total)
                </span>
              )}
            </h4>
            <div className="flex items-center gap-2">
              {supportsBulkAssign && selectedIds.size > 0 && (
                <Button
                  size="sm"
                  onClick={() => setOwnerDialogOpen(true)}
                  className="h-7 text-xs"
                >
                  <UserPlus className="h-3 w-3 mr-1" />
                  Assign owner to {selectedIds.size}
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={onClose} className="h-6 text-xs">
                Close
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading...
            </div>
          ) : records.length > 0 ? (
            <>
              <div className="rounded-md border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {supportsBulkAssign && (
                        <TableHead className="w-10">
                          <Checkbox
                            checked={allOnPageSelected}
                            onCheckedChange={togglePage}
                            aria-label="Select page"
                          />
                        </TableHead>
                      )}
                      <TableHead>Name</TableHead>
                      <TableHead>Issue</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((r) => (
                      <TableRow key={r.id}>
                        {supportsBulkAssign && (
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(r.id)}
                              onCheckedChange={() => toggleOne(r.id)}
                              aria-label={`Select ${r.name}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="text-sm font-medium">{r.name}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.issue}</TableCell>
                        <TableCell>
                          <Link
                            to={`${entityPath(entity)}/${r.id}`}
                            className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination footer */}
              <div className="flex items-center justify-between pt-2 text-xs text-muted-foreground">
                <span>
                  Showing {firstIdx}–{lastIdx} of {totalCount}
                  {selectedIds.size > 0 && (
                    <span className="ml-2">
                      • {selectedIds.size} selected
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={page === 0 || isFetching}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </Button>
                  <span className="px-2">
                    Page {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    disabled={page + 1 >= totalPages || isFetching}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronsRight className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground py-1">No records found.</p>
          )}
        </div>

        <ChangeOwnerDialog
          open={ownerDialogOpen}
          onOpenChange={setOwnerDialogOpen}
          currentOwnerId={null}
          onConfirm={handleBulkAssign}
          title={`Assign owner to ${selectedIds.size} ${entity}`}
        />
      </TableCell>
    </TableRow>
  );
}

/* ---------- Component ---------- */

export function DataHealthDashboard() {
  const { data: stats, isLoading: statsLoading } = useDatabaseStats();
  const { data: healthRows, isLoading: healthLoading } = useDataHealthCheck();
  const [expanded, setExpanded] = useState<{ entity: string; issue: "unassigned" | "missing_name" } | null>(null);

  if (statsLoading || healthLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const sizePercent = stats
    ? Math.round((stats.database_size_bytes / SUPABASE_FREE_TIER_BYTES) * 100)
    : 0;
  const sizeWarning = sizePercent > 80;

  function toggleDrilldown(entity: string, issue: "unassigned" | "missing_name") {
    if (expanded?.entity === entity && expanded?.issue === issue) {
      setExpanded(null);
    } else {
      setExpanded({ entity, issue });
    }
  }

  return (
    <div className="space-y-6">
      {/* ---- Database Stats ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Database Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {stats && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Database Size</span>
                <span className="font-medium flex items-center gap-2">
                  {stats.database_size} / 500 MB ({sizePercent}% used)
                  {sizeWarning && (
                    <Badge variant="destructive" className="text-xs">Warning</Badge>
                  )}
                </span>
              </div>
              <div className="w-full bg-muted rounded-full h-2.5">
                <div
                  className={`h-2.5 rounded-full transition-all ${
                    sizeWarning ? "bg-destructive" : "bg-primary"
                  }`}
                  style={{ width: `${Math.min(sizePercent, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Rows</span>
                <span className="font-medium">
                  {stats.total_rows?.toLocaleString() ?? "0"}
                </span>
              </div>

              {stats.largest_tables && stats.largest_tables.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">
                    Largest Tables
                  </p>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Table</TableHead>
                          <TableHead className="text-right">Rows</TableHead>
                          <TableHead className="text-right">Size</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {stats.largest_tables.map((t) => (
                          <TableRow key={t.table}>
                            <TableCell className="font-mono text-xs">
                              {t.table}
                            </TableCell>
                            <TableCell className="text-right">
                              {t.rows.toLocaleString()}
                            </TableCell>
                            <TableCell className="text-right">{t.size}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Data Health Table ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileBarChart className="h-4 w-4" />
            Data Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthRows && healthRows.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Archived</TableHead>
                    <TableHead className="text-right">Created (24h)</TableHead>
                    <TableHead className="text-right">Modified (24h)</TableHead>
                    <TableHead className="text-right">Missing Data</TableHead>
                    <TableHead className="text-right">Unassigned</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {healthRows.map((row) => (
                    <Fragment key={row.entity}>
                      <TableRow>
                        <TableCell className="font-medium capitalize">
                          {row.entity}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.total_records}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.archived_records}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.created_last_24h}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.modified_last_24h}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.missing_name > 0 ? (
                            <button
                              onClick={() => toggleDrilldown(row.entity, "missing_name")}
                              className="inline-flex items-center gap-1 text-yellow-600 hover:text-yellow-700 hover:underline cursor-pointer font-medium"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {row.missing_name}
                              {expanded?.entity === row.entity && expanded?.issue === "missing_name"
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />
                              }
                            </button>
                          ) : (
                            <span>{row.missing_name}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.unassigned_records > 0 ? (
                            <button
                              onClick={() => toggleDrilldown(row.entity, "unassigned")}
                              className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 hover:underline cursor-pointer font-medium"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {row.unassigned_records}
                              {expanded?.entity === row.entity && expanded?.issue === "unassigned"
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />
                              }
                            </button>
                          ) : (
                            <span>{row.unassigned_records}</span>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded?.entity === row.entity && (
                        <DrilldownPanel
                          key={`${row.entity}-${expanded.issue}`}
                          entity={row.entity}
                          issue={expanded.issue}
                          onClose={() => setExpanded(null)}
                        />
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No data health information available.</p>
          )}
        </CardContent>
      </Card>

      {/* ---- Audit Log Stats ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Audit Log Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {stats && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total Audit Entries</span>
                <span className="font-medium">
                  {stats.audit_log_count?.toLocaleString() ?? "0"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Oldest Audit Entry</span>
                <span className="font-medium">
                  {formatDate(stats.oldest_audit_log)}
                </span>
              </div>
              {stats.oldest_audit_log && (
                <p className="text-xs text-muted-foreground mt-1">
                  Your audit trail goes back to {formatDate(stats.oldest_audit_log)}.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---- Data Protection Checklist ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Data Protection Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {PROTECTION_CHECKLIST.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {item.enabled ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                )}
                <span className={item.enabled ? "" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* ---- Import Safety ---- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Import Safety
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-muted/50 border p-3 text-sm space-y-2">
            <p className="font-medium">Before importing data:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>
                Export your current data as a backup using the Report Builder and Export CSV.
              </li>
              <li>
                Use the SF ID field to prevent duplicate imports from Salesforce.
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
