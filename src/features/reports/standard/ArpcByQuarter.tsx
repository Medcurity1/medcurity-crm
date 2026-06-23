import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { formatCurrency } from "@/lib/formatters";
import {
  downloadCsv,
  todayStamp,
  csvCurrency,
  quarterOf,
  lastNQuarters,
  type QuarterBucket,
} from "./report-helpers";
import { fetchAccountsById, fetchAllRows } from "./report-fetchers";

/**
 * Average Revenue Per Customer — by quarter.
 *
 * Formula: for a given quarter Q, ARPC = sum(closed-won amount in Q)
 * ÷ count(distinct accounts with at least one closed-won in Q).
 *
 * The page has two views, controlled by the "View" selector:
 *
 *   - "Current quarter" (default): one-row-per-account table for the
 *     selected quarter. Each row = an account that closed business in
 *     that quarter, its revenue contribution, and its share of the
 *     quarter's ARPC.
 *
 *   - "Historical (by quarter)": a line chart + a table with one row
 *     per quarter for the last 8 quarters. This is the shape the team
 *     dashboard widget consumes.
 *
 * Quarter selector lets the user jump to any past quarter; default is
 * the current quarter.
 */

interface AccountRow {
  account_id: string;
  account_name: string;
  revenue: number;
  opp_count: number;
}

interface QuarterRow {
  quarter: QuarterBucket;
  total_revenue: number;
  /** Distinct accounts with at least one closed-won in this quarter (ARPC divisor). */
  customer_count: number;
  /**
   * Distinct accounts considered "active" as of the END of this quarter.
   * Active = at least one closed-won opp whose contract still covers Q.end,
   * where the contract end is taken as `contract_end_date` if set, else
   * `close_date + 365 days` (the assumed 1-year contract length).
   */
  active_customer_count: number;
  arpc: number;
}

const HISTORY_QUARTERS = 4;

/** Add N days to a yyyy-mm-dd string (UTC math). */
function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ArpcByQuarter() {
  const allQuarters = useMemo(() => lastNQuarters(HISTORY_QUARTERS), []);
  const [view, setView] = useState<"current" | "historical">("current");
  // Default to the most recent (current) quarter.
  const [selectedQuarterKey, setSelectedQuarterKey] = useState<string>(
    allQuarters[allQuarters.length - 1].sortKey,
  );
  const selectedQuarter =
    allQuarters.find((q) => q.sortKey === selectedQuarterKey) ??
    allQuarters[allQuarters.length - 1];

  const { data, isLoading, error } = useQuery({
    queryKey: ["report", "arpc-by-quarter", allQuarters[0].start],
    queryFn: async (): Promise<{
      perAccountByQuarter: Map<string, AccountRow[]>;
      byQuarter: QuarterRow[];
    }> => {
      type OppRaw = {
        id: string;
        amount: number | null;
        close_date: string | null;
        contract_end_date: string | null;
        account_id: string | null;
      };
      // For ARPC we only need closed-wons whose close_date falls inside the
      // 4-quarter window. But to compute Active Customers AS OF the end of
      // each quarter we also need closed-wons that pre-date the window but
      // are still in-contract (contract_end_date in-window, or close_date+365
      // when it is null). So pull back 365 extra days on the lower
      // bound — that covers every opp that could still be "active" at the
      // start of the oldest quarter.
      const windowStart = allQuarters[0].start;
      const windowEnd = allQuarters[allQuarters.length - 1].end;
      const activeLookbackStart = addDaysIso(windowStart, -365);
      const opps = await fetchAllRows<OppRaw>(() =>
        supabase
          .from("opportunities")
          .select("id, amount, close_date, contract_end_date, account_id")
          .eq("stage", "closed_won")
          .is("archived_at", null)
          .gte("close_date", activeLookbackStart)
          .lte("close_date", windowEnd)
          .order("close_date", { ascending: true }),
      );

      // Resolve account names for display + CSV. Use the batch fetcher
      // to dodge PostgREST embed flakiness (see report-fetchers.ts).
      const accountIds = new Set<string>(
        opps.map((o) => o.account_id as string).filter(Boolean),
      );
      const accounts = await fetchAccountsById(accountIds);

      // Bucket opps by quarter, then by account within each quarter.
      const perAccountByQuarter = new Map<string, Map<string, AccountRow>>();
      for (const q of allQuarters) perAccountByQuarter.set(q.sortKey, new Map());

      // Bucket revenue per quarter the opp closed in (ARPC numerator).
      for (const o of opps) {
        if (!o.close_date || !o.account_id) continue;
        const bucket = quarterOf(o.close_date);
        const slot = perAccountByQuarter.get(bucket.sortKey);
        if (!slot) continue; // outside the rolling window (pre-window lookback)
        const existing = slot.get(o.account_id);
        const amount = Number(o.amount ?? 0);
        if (existing) {
          existing.revenue += amount;
          existing.opp_count += 1;
        } else {
          slot.set(o.account_id, {
            account_id: o.account_id,
            account_name: accounts.get(o.account_id)?.name ?? "Unknown",
            revenue: amount,
            opp_count: 1,
          });
        }
      }

      // Active customers as-of end of each quarter: account counted if it
      // has any closed-won opp whose contract still covers Q.end.
      const activeByQuarter = new Map<string, Set<string>>();
      for (const q of allQuarters) activeByQuarter.set(q.sortKey, new Set());
      for (const o of opps) {
        if (!o.close_date || !o.account_id) continue;
        const effEnd = o.contract_end_date ?? addDaysIso(o.close_date, 365);
        for (const q of allQuarters) {
          // Active at Q.end if it had closed by then AND contract still covers Q.end.
          if (o.close_date <= q.end && effEnd >= q.end) {
            activeByQuarter.get(q.sortKey)!.add(o.account_id);
          }
        }
      }

      // Build the per-quarter aggregate row used by the historical view +
      // dashboard widget.
      const byQuarter: QuarterRow[] = allQuarters.map((q) => {
        const slot = perAccountByQuarter.get(q.sortKey)!;
        const rows = Array.from(slot.values());
        const total_revenue = rows.reduce((s, r) => s + r.revenue, 0);
        const customer_count = rows.length;
        const active_customer_count = activeByQuarter.get(q.sortKey)!.size;
        const arpc = customer_count > 0 ? total_revenue / customer_count : 0;
        return {
          quarter: q,
          total_revenue,
          customer_count,
          active_customer_count,
          arpc,
        };
      });

      // Flatten the inner Map into an array so React Query memoizes it cheaply.
      const flat = new Map<string, AccountRow[]>();
      for (const [k, v] of perAccountByQuarter) {
        flat.set(k, Array.from(v.values()).sort((a, b) => b.revenue - a.revenue));
      }
      return { perAccountByQuarter: flat, byQuarter };
    },
  });

  const accountsThisQuarter =
    data?.perAccountByQuarter.get(selectedQuarter.sortKey) ?? [];
  const summary = useMemo(() => {
    const total = accountsThisQuarter.reduce((s, r) => s + r.revenue, 0);
    const count = accountsThisQuarter.length;
    const arpc = count > 0 ? total / count : 0;
    return { total, count, arpc };
  }, [accountsThisQuarter]);

  function exportCsv() {
    if (view === "historical") {
      const header = [
        "Quarter",
        "New Customers",
        "Active Customers",
        "Total Revenue",
        "ARPC",
      ];
      const rows = (data?.byQuarter ?? []).map((q) => [
        q.quarter.label,
        q.customer_count,
        q.active_customer_count,
        csvCurrency(q.total_revenue),
        csvCurrency(q.arpc),
      ]);
      downloadCsv(`arpc-by-quarter-${todayStamp()}.csv`, [header, ...rows]);
      return;
    }
    const header = ["Account Name", "Revenue", "Opportunity Count", "Quarter"];
    const rows = accountsThisQuarter.map((r) => [
      r.account_name,
      csvCurrency(r.revenue),
      r.opp_count,
      selectedQuarter.label,
    ]);
    downloadCsv(
      `arpc-${selectedQuarter.label}-${todayStamp()}.csv`,
      [header, ...rows],
    );
  }

  const chartData = (data?.byQuarter ?? []).map((q) => ({
    label: q.quarter.label,
    arpc: Math.round(q.arpc),
    new_customers: q.customer_count,
    active_customers: q.active_customer_count,
    revenue: Math.round(q.total_revenue),
  }));

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
        title="Average Revenue Per Customer"
        description="Sum of closed-won amount divided by distinct customers in the same quarter. Switch to Historical to plot quarter-over-quarter for the team dashboard."
        actions={
          <div className="flex items-center gap-2">
            <Select value={view} onValueChange={(v) => setView(v as "current" | "historical")}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Selected quarter</SelectItem>
                <SelectItem value="historical">
                  Historical ({HISTORY_QUARTERS} quarters)
                </SelectItem>
              </SelectContent>
            </Select>
            {view === "current" && (
              <Select
                value={selectedQuarterKey}
                onValueChange={setSelectedQuarterKey}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...allQuarters].reverse().map((q) => (
                    <SelectItem key={q.sortKey} value={q.sortKey}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={isLoading}
            >
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Error: {(error as Error).message}
        </div>
      )}

      {view === "current" ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Quarter" value={selectedQuarter.label} />
            <Kpi label="Customers" value={summary.count.toLocaleString()} />
            <Kpi label="Revenue" value={formatCurrency(summary.total)} />
            <Kpi label="ARPC" value={formatCurrency(summary.arpc)} />
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Revenue</TableHead>
                      <TableHead className="text-right">Opps</TableHead>
                      <TableHead className="text-right">% of Quarter</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="p-4">
                          <Skeleton className="h-48 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : accountsThisQuarter.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          className="p-6 text-sm text-muted-foreground text-center"
                        >
                          No closed-won opportunities in {selectedQuarter.label}.
                        </TableCell>
                      </TableRow>
                    ) : (
                      accountsThisQuarter.map((r) => (
                        <TableRow key={r.account_id}>
                          <TableCell className="font-medium">
                            <Link target="_blank" rel="noopener noreferrer"
                              to={`/accounts/${r.account_id}`}
                              className="text-primary hover:underline"
                            >
                              {r.account_name}
                            </Link>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(r.revenue)}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.opp_count}
                          </TableCell>
                          <TableCell className="text-right">
                            {summary.total > 0
                              ? `${((r.revenue / summary.total) * 100).toFixed(1)}%`
                              : "—"}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground font-medium mb-2">
                ARPC (left) + Active Customers (right) — last{" "}
                {HISTORY_QUARTERS} quarters (rolling 365 days)
              </p>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis
                      yAxisId="left"
                      tickFormatter={(v) =>
                        `$${(Number(v) / 1000).toFixed(0)}k`
                      }
                    />
                    <Tooltip
                      formatter={(value, name) => {
                        const n = Number(value) || 0;
                        if (name === "ARPC" || name === "Revenue")
                          return formatCurrency(n);
                        return n.toLocaleString();
                      }}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      allowDecimals={false}
                    />
                    <Line
                      yAxisId="left"
                      type="monotone"
                      dataKey="arpc"
                      name="ARPC"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="active_customers"
                      name="Active Customers"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Quarter</TableHead>
                      <TableHead className="text-right">
                        New Customers
                      </TableHead>
                      <TableHead className="text-right">
                        Active Customers
                      </TableHead>
                      <TableHead className="text-right">
                        Total Revenue
                      </TableHead>
                      <TableHead className="text-right">ARPC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="p-4">
                          <Skeleton className="h-48 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      (data?.byQuarter ?? []).map((q) => (
                        <TableRow key={q.quarter.sortKey}>
                          <TableCell className="font-medium">
                            {q.quarter.label}
                          </TableCell>
                          <TableCell className="text-right">
                            {q.customer_count.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {q.active_customer_count.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(q.total_revenue)}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(q.arpc)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

