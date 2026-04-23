import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/formatters";

/**
 * ARR Rolling 365 — top-priority report per user feedback.
 *
 * Two views on the same dataset:
 *   1. Big number: total closed-won $ in the trailing 365 days
 *   2. Monthly breakdown for the trailing 12 months:
 *      - Left axis (bars): closed-won $ that month (recognized revenue)
 *      - Right axis (line): cumulative trailing-12-month ARR
 *        (sum of each month's contribution + prior 11 months)
 *
 * Plus a flat data table + CSV export matching the SF financial
 * spreadsheet format (Year, Month, ClosedWon$, TrailingARR,
 * DealsClosed).
 *
 * This is the single-axis baseline — dual-axis chart primitive is
 * built in ../DualAxisChart.tsx and used here.
 */
export function ArrRolling365() {
  const [rangeMonths, setRangeMonths] = useState<12 | 24 | 36>(12);

  // Pull closed-won opps from the last (rangeMonths + 12) months so
  // we can compute a trailing-12 series for every displayed month.
  // Extra 12 months of lookback is needed to compute the trailing
  // window for the earliest displayed month.
  const { data: opps, isLoading } = useQuery({
    queryKey: ["report", "arr-rolling-365", rangeMonths],
    queryFn: async () => {
      const from = new Date();
      from.setMonth(from.getMonth() - rangeMonths - 12);
      from.setDate(1);
      const { data, error } = await supabase
        .from("opportunities")
        .select("id, amount, close_date, account_id, account:accounts!account_id(name)")
        .eq("stage", "closed_won")
        .gte("close_date", from.toISOString().slice(0, 10));
      if (error) throw error;
      return data ?? [];
    },
  });

  const monthly = useMemo(() => {
    if (!opps) return [];
    // Aggregate closed-won by YYYY-MM
    const byMonth = new Map<string, { total: number; count: number }>();
    for (const o of opps) {
      if (!o.close_date) continue;
      const d = new Date(o.close_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cur = byMonth.get(key) ?? { total: 0, count: 0 };
      cur.total += Number(o.amount ?? 0);
      cur.count += 1;
      byMonth.set(key, cur);
    }

    // Build the displayed series — last `rangeMonths` months newest-last.
    const now = new Date();
    const rows: {
      monthKey: string;
      label: string;
      year: number;
      month: number;
      closed_won: number;
      deals: number;
      trailing_arr: number;
    }[] = [];
    for (let i = rangeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const m = byMonth.get(key) ?? { total: 0, count: 0 };
      // Trailing 12 = sum of [key-11 months, key]
      let trailing = 0;
      for (let j = 0; j < 12; j++) {
        const dj = new Date(d.getFullYear(), d.getMonth() - j, 1);
        const jk = `${dj.getFullYear()}-${String(dj.getMonth() + 1).padStart(2, "0")}`;
        trailing += byMonth.get(jk)?.total ?? 0;
      }
      rows.push({
        monthKey: key,
        label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        closed_won: m.total,
        deals: m.count,
        trailing_arr: trailing,
      });
    }
    return rows;
  }, [opps, rangeMonths]);

  const latestTrailing = monthly[monthly.length - 1]?.trailing_arr ?? 0;

  function exportCsv() {
    const header = ["Year", "Month", "ClosedWon$", "TrailingARR", "DealsClosed"];
    const rows = monthly.map((r) => [
      r.year,
      r.month,
      r.closed_won.toFixed(2),
      r.trailing_arr.toFixed(2),
      r.deals,
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => String(c).replace(/"/g, '""')).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `arr-rolling-365-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/reports?tab=standard">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Standard Reports
          </Link>
        </Button>
      </div>

      <PageHeader
        title="ARR (Rolling 365 Days)"
        description="Annual recurring revenue from closed-won opportunities in the trailing 365 days."
        actions={
          <div className="flex items-center gap-2">
            {/* Range toggle — 12, 24, or 36 months of displayed history */}
            <div className="inline-flex rounded-md border">
              {([12, 24, 36] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRangeMonths(m)}
                  className={`px-3 py-1.5 text-sm ${rangeMonths === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {m}M
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading || monthly.length === 0}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        }
      />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Current ARR (Trailing 365)" value={formatCurrency(latestTrailing)} />
        <Kpi
          label="Last Month Closed-Won"
          value={formatCurrency(monthly[monthly.length - 1]?.closed_won ?? 0)}
          sub={`${monthly[monthly.length - 1]?.deals ?? 0} deals`}
        />
        <Kpi
          label={`${rangeMonths}-Month Total`}
          value={formatCurrency(monthly.reduce((s, r) => s + r.closed_won, 0))}
        />
        <Kpi
          label="Average Monthly"
          value={formatCurrency(
            monthly.length > 0
              ? monthly.reduce((s, r) => s + r.closed_won, 0) / monthly.length
              : 0
          )}
        />
      </div>

      {/* Dual-axis chart */}
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground">No closed-won data in range.</p>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    tickFormatter={(v) => (v === 0 ? "$0" : `$${(v / 1000).toFixed(0)}k`)}
                    tick={{ fontSize: 12 }}
                    label={{
                      value: "Closed-Won $",
                      angle: -90,
                      position: "insideLeft",
                      style: { fontSize: 12 },
                    }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(v) => (v === 0 ? "$0" : `$${(v / 1000).toFixed(0)}k`)}
                    tick={{ fontSize: 12 }}
                    label={{
                      value: "Trailing 12M ARR",
                      angle: 90,
                      position: "insideRight",
                      style: { fontSize: 12 },
                    }}
                  />
                  <Tooltip
                    // Recharts' Formatter type allows string|number|undefined,
                    // so guard before calling formatCurrency.
                    formatter={(v) => (typeof v === "number" ? formatCurrency(v) : String(v ?? ""))}
                    labelStyle={{ fontSize: 12 }}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    yAxisId="left"
                    dataKey="closed_won"
                    name="Closed-Won (month)"
                    fill="#3b82f6"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="trailing_arr"
                    name="Trailing 12M ARR"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Data table — matches CSV export columns so what you see is
          what you download */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Closed-Won $</TableHead>
                <TableHead className="text-right">Deals</TableHead>
                <TableHead className="text-right">Trailing 12M ARR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && monthly.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No data
                  </TableCell>
                </TableRow>
              )}
              {monthly.map((r) => (
                <TableRow key={r.monthKey}>
                  <TableCell>
                    {new Date(r.year, r.month - 1).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(r.closed_won)}</TableCell>
                  <TableCell className="text-right">{r.deals}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(r.trailing_arr)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}
