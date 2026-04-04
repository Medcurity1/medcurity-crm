import { useState, Fragment } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
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
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatRelativeDate } from "@/lib/formatters";
import { format, parseISO, subDays, subHours } from "date-fns";
import type { AuditLog } from "@/types/crm";

const PAGE_SIZE = 25;

const ENTITY_OPTIONS = [
  { value: "all", label: "All Entities" },
  { value: "accounts", label: "Accounts" },
  { value: "contacts", label: "Contacts" },
  { value: "opportunities", label: "Opportunities" },
  { value: "leads", label: "Leads" },
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
  user_profiles: "User",
};

const ENTITY_ROUTES: Record<string, string> = {
  accounts: "/accounts",
  contacts: "/contacts",
  opportunities: "/opportunities",
  leads: "/leads",
};

/** Fields to skip when showing changes */
const SKIP_FIELDS = new Set(["updated_at", "created_at"]);

interface AuditLogWithChanger extends AuditLog {
  changer: { full_name: string | null } | null;
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
  page: number;
}) {
  return useQuery({
    queryKey: ["audit_logs", filters],
    queryFn: async () => {
      let query = supabase
        .from("audit_logs")
        .select("*, changer:user_profiles!changed_by(full_name)", {
          count: "exact",
        })
        .order("changed_at", { ascending: false })
        .range(
          filters.page * PAGE_SIZE,
          (filters.page + 1) * PAGE_SIZE - 1
        );

      if (filters.entity !== "all") {
        query = query.eq("table_name", filters.entity);
      }
      if (filters.action !== "all") {
        query = query.eq("action", filters.action);
      }
      const cutoff = getDateCutoff(filters.dateRange);
      if (cutoff) {
        query = query.gte("changed_at", cutoff);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return {
        logs: data as AuditLogWithChanger[],
        totalCount: count ?? 0,
      };
    },
  });
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

function ChangesSummary({ log }: { log: AuditLogWithChanger }) {
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

function ExpandedRow({ log }: { log: AuditLogWithChanger }) {
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
  const [entity, setEntity] = useState("all");
  const [action, setAction] = useState("all");
  const [dateRange, setDateRange] = useState("7d");
  const [page, setPage] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleEntityChange = (v: string) => {
    setEntity(v);
    setPage(0);
  };
  const handleActionChange = (v: string) => {
    setAction(v);
    setPage(0);
  };
  const handleDateRangeChange = (v: string) => {
    setDateRange(v);
    setPage(0);
  };

  const { data, isLoading } = useAuditLogs({ entity, action, dateRange, page });

  const logs = data?.logs ?? [];
  const totalCount = data?.totalCount ?? 0;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={entity} onValueChange={handleEntityChange}>
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

        <Select value={action} onValueChange={handleActionChange}>
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

        <Select value={dateRange} onValueChange={handleDateRangeChange}>
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
                        {log.changer?.full_name ?? "System"}
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
        onPageChange={setPage}
      />
    </div>
  );
}
