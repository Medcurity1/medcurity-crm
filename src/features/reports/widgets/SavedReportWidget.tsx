import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSavedReport, useRunReport } from "../report-api";
import { getEntityDef, getColumnDef } from "../report-config";
import type { DashboardWidgetDisplay } from "@/types/crm";

const PIE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
  "#84cc16",
];

/**
 * Renders a saved report inside a dashboard widget. Supports table view
 * (first 10 rows) and bar / pie aggregations grouped by a chosen column.
 */
export function SavedReportWidget({
  reportId,
  display = "table",
  groupBy,
  valueColumn,
}: {
  reportId: string;
  display?: DashboardWidgetDisplay;
  groupBy?: string;
  valueColumn?: string;
}) {
  const { data: report, isLoading: reportLoading } = useSavedReport(reportId);
  const { data: results, isLoading: runLoading } = useRunReport(
    report?.config ?? null,
    !!report
  );

  const entity = report ? getEntityDef(report.config.entity) : null;
  const columns = report?.config.columns ?? [];

  const aggregated = useMemo(() => {
    if (!results?.data || !groupBy) return [];
    const buckets = new Map<string, number>();
    for (const row of results.data) {
      const rawKey = (row as Record<string, unknown>)[groupBy];
      const key = rawKey == null || rawKey === "" ? "(empty)" : String(rawKey);
      let amount = 1;
      if (valueColumn) {
        const v = (row as Record<string, unknown>)[valueColumn];
        if (typeof v === "number") amount = v;
        else if (typeof v === "string" && !Number.isNaN(Number(v))) amount = Number(v);
        else amount = 0;
      }
      buckets.set(key, (buckets.get(key) ?? 0) + amount);
    }
    return Array.from(buckets, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [results?.data, groupBy, valueColumn]);

  if (reportLoading || runLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  if (!report) {
    return (
      <p className="text-xs text-muted-foreground py-4">
        Report no longer exists.
      </p>
    );
  }

  if (!results?.data?.length) {
    return (
      <p className="text-xs text-muted-foreground py-4">
        No rows.{" "}
        <Link
          to={`/reports?tab=reports&load=${reportId}`}
          className="text-primary hover:underline"
        >
          Open report
        </Link>
      </p>
    );
  }

  if (display === "number") {
    return (
      <div className="flex flex-col items-center justify-center py-6">
        <p className="text-3xl font-bold">{results.count}</p>
        <p className="text-xs text-muted-foreground mt-1">rows</p>
      </div>
    );
  }

  if (display === "bar" && aggregated.length > 0) {
    return (
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={aggregated} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11 }} />
            <RechartsTooltip />
            <Bar dataKey="value" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (display === "pie" && aggregated.length > 0) {
    return (
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={aggregated}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={70}
              label={(entry: { name?: string }) => entry.name ?? ""}
              labelLine={false}
            >
              {aggregated.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <RechartsTooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Default: small table preview (first 8 rows, first 4 columns).
  const cols = columns.slice(0, 4);
  const rows = results.data.slice(0, 8);
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {cols.map((c) => {
              const def = entity ? getColumnDef(entity.key, c) : null;
              return (
                <TableHead key={c} className="text-xs">
                  {def?.label ?? c}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {cols.map((c) => {
                const v = (row as Record<string, unknown>)[c];
                return (
                  <TableCell key={c} className="text-xs">
                    {v == null
                      ? "—"
                      : typeof v === "object"
                      ? JSON.stringify(v).slice(0, 30)
                      : String(v)}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {results.data.length > rows.length && (
        <p className="text-xs text-muted-foreground text-center py-2">
          {results.data.length - rows.length} more rows ·{" "}
          <Link
            to={`/reports?tab=reports&load=${reportId}`}
            className="text-primary hover:underline"
          >
            Open report
          </Link>
        </p>
      )}
    </div>
  );
}
