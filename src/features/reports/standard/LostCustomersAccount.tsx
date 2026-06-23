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
import { formatCurrency, formatDate } from "@/lib/formatters";
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
 * Lost Customers (Account-based) — accounts that USED to be customers
 * but no longer have any open / in-contract opportunity.
 *
 * "Currently active" rule (per Brayden 2026-05-29):
 *   account.status is NOT the source of truth — we derive activity
 *   from opportunity history instead. An account is currently active
 *   iff it has at least one Closed-Won opp where the opp is "still
 *   open" — meaning contract_end_date >= today if it's set,
 *   otherwise close_date >= today - 365 days (i.e. assume a 1-year
 *   contract if no contract_end_date was captured).
 *
 * "Lost" then = the account was active at some point in the past but
 * is no longer active per the rule above. The "lost quarter" is the
 * quarter the account's coverage lapsed — i.e. the quarter that
 * contains (latest closed-won's effective end date). That's the
 * date the account flipped from active → inactive in our view.
 *
 * Two views:
 *   - "Currently lost" (default): the live list of accounts who are
 *     not currently active but had at least one closed-won deal in
 *     the past. Filter by their lost-quarter via the quarter dropdown.
 *   - "Historical (by quarter)": count + total revenue of accounts
 *     whose coverage lapsed in each of the last 8 quarters. Charts
 *     left-to-right for dropping into the team dashboard.
 */

interface LostAccountRow {
  account_id: string;
  account_name: string;
  account_status: string | null;
  latest_close_date: string;
  /** contract_end_date if set, otherwise latest_close_date + 365. */
  effective_end_date: string;
  lost_quarter: string; // sortKey like "2026-Q2"
  lost_quarter_label: string;
  last_amount: number;
  total_lifetime_revenue: number;
  opp_count: number;
}

interface QuarterAggRow {
  quarter: QuarterBucket;
  lost_count: number;
  lost_amount: number;
}

const HISTORY_QUARTERS = 4;

/** Add `days` to an ISO date string (yyyy-mm-dd), UTC-based. */
function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function LostCustomersAccount() {
  const allQuarters = useMemo(() => lastNQuarters(HISTORY_QUARTERS), []);
  const [view, setView] = useState<"current" | "historical">("current");
  // Default to "All quarters" so the rep sees the full lost list out of the box.
  const [quarterFilter, setQuarterFilter] = useState<string>("all");
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["report", "lost-customers-account", todayIso],
    queryFn: async (): Promise<{
      lost: LostAccountRow[];
      byQuarter: QuarterAggRow[];
    }> => {
      type OppRaw = {
        id: string;
        amount: number | null;
        close_date: string | null;
        contract_end_date: string | null;
        account_id: string | null;
      };
      // Pull every closed-won opp ever (subject to a sane safety cap
      // inside fetchAllRows). For each account we'll find its latest
      // closed-won and compute the effective end date.
      const opps = await fetchAllRows<OppRaw>(() =>
        supabase
          .from("opportunities")
          .select("id, amount, close_date, contract_end_date, account_id")
          .eq("stage", "closed_won")
          .is("archived_at", null)
          .not("account_id", "is", null)
          .order("close_date", { ascending: false }),
      );

      // Group by account, capture: latest close_date row, lifetime revenue, count.
      type PerAccount = {
        latest: OppRaw;
        lifetime_revenue: number;
        opp_count: number;
      };
      const perAccount = new Map<string, PerAccount>();
      for (const o of opps) {
        if (!o.account_id || !o.close_date) continue;
        const cur = perAccount.get(o.account_id);
        const amount = Number(o.amount ?? 0);
        if (!cur) {
          perAccount.set(o.account_id, {
            latest: o,
            lifetime_revenue: amount,
            opp_count: 1,
          });
        } else {
          cur.lifetime_revenue += amount;
          cur.opp_count += 1;
          if ((o.close_date ?? "") > (cur.latest.close_date ?? "")) {
            cur.latest = o;
          }
        }
      }

      // Resolve account display names + status (status is shown for
      // context but does NOT drive the active/lost classification —
      // the opportunity history does).
      const accountIds = new Set<string>(perAccount.keys());
      const accounts = await fetchAccountsById(accountIds);

      const lost: LostAccountRow[] = [];
      for (const [accountId, info] of perAccount) {
        const latest = info.latest;
        const closeDate = latest.close_date as string;
        // Effective end = contract_end_date if present, otherwise
        // close_date + 365 (assumed 1-year contract).
        const effectiveEnd = latest.contract_end_date
          ? (latest.contract_end_date as string)
          : addDaysIso(closeDate, 365);
        // Active if effective end is in the future. Skip — they're not lost.
        if (effectiveEnd >= todayIso) continue;
        const lostBucket = quarterOf(effectiveEnd);
        const acc = accounts.get(accountId);
        lost.push({
          account_id: accountId,
          account_name: acc?.name ?? "Unknown",
          account_status: acc?.status ?? null,
          latest_close_date: closeDate,
          effective_end_date: effectiveEnd,
          lost_quarter: lostBucket.sortKey,
          lost_quarter_label: lostBucket.label,
          last_amount: Number(latest.amount ?? 0),
          total_lifetime_revenue: info.lifetime_revenue,
          opp_count: info.opp_count,
        });
      }
      // Most recently lost first.
      lost.sort((a, b) =>
        a.effective_end_date < b.effective_end_date ? 1 : -1,
      );

      // By-quarter aggregate over the rolling history window.
      const byQuarter: QuarterAggRow[] = allQuarters.map((q) => {
        const rows = lost.filter((r) => r.lost_quarter === q.sortKey);
        return {
          quarter: q,
          lost_count: rows.length,
          lost_amount: rows.reduce((s, r) => s + r.last_amount, 0),
        };
      });

      return { lost, byQuarter };
    },
  });

  const filteredLost = useMemo(() => {
    const all = data?.lost ?? [];
    if (quarterFilter === "all") return all;
    return all.filter((r) => r.lost_quarter === quarterFilter);
  }, [data?.lost, quarterFilter]);

  const summary = useMemo(() => {
    return {
      count: filteredLost.length,
      total_amount: filteredLost.reduce((s, r) => s + r.last_amount, 0),
      total_lifetime: filteredLost.reduce(
        (s, r) => s + r.total_lifetime_revenue,
        0,
      ),
    };
  }, [filteredLost]);

  function exportCsv() {
    if (view === "historical") {
      const header = ["Quarter", "Lost Accounts", "Lost Amount"];
      const rows = (data?.byQuarter ?? []).map((q) => [
        q.quarter.label,
        q.lost_count,
        csvCurrency(q.lost_amount),
      ]);
      downloadCsv(
        `lost-customers-account-by-quarter-${todayStamp()}.csv`,
        [header, ...rows],
      );
      return;
    }
    const header = [
      "Account Name",
      "Status",
      "Lost Quarter",
      "Effective End",
      "Latest Close Date",
      "Last Amount",
      "Lifetime Revenue",
      "Opps",
    ];
    const rows = filteredLost.map((r) => [
      r.account_name,
      r.account_status ?? "",
      r.lost_quarter_label,
      r.effective_end_date,
      r.latest_close_date,
      csvCurrency(r.last_amount),
      csvCurrency(r.total_lifetime_revenue),
      r.opp_count,
    ]);
    downloadCsv(
      `lost-customers-account-${todayStamp()}.csv`,
      [header, ...rows],
    );
  }

  const chartData = (data?.byQuarter ?? []).map((q) => ({
    label: q.quarter.label,
    lost: q.lost_count,
    amount: Math.round(q.lost_amount),
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
        title="Lost Customers (Account-based)"
        description="Accounts whose most recent Closed-Won deal has lapsed (contract_end_date in the past, or close_date older than 365 days when no contract_end_date is set). Complements the opportunity-based Lost Customers report."
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={view}
              onValueChange={(v) => setView(v as "current" | "historical")}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Currently lost</SelectItem>
                <SelectItem value="historical">
                  Historical ({HISTORY_QUARTERS} quarters)
                </SelectItem>
              </SelectContent>
            </Select>
            {view === "current" && (
              <Select value={quarterFilter} onValueChange={setQuarterFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All quarters</SelectItem>
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Kpi label="Lost Accounts" value={summary.count.toLocaleString()} />
            <Kpi
              label="Last Amount Total"
              value={formatCurrency(summary.total_amount)}
            />
            <Kpi
              label="Lifetime Revenue Lost"
              value={formatCurrency(summary.total_lifetime)}
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Lost Quarter</TableHead>
                      <TableHead>Effective End</TableHead>
                      <TableHead>Latest Close</TableHead>
                      <TableHead className="text-right">Last Amount</TableHead>
                      <TableHead className="text-right">
                        Lifetime Rev
                      </TableHead>
                      <TableHead className="text-right">Opps</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="p-4">
                          <Skeleton className="h-48 w-full" />
                        </TableCell>
                      </TableRow>
                    ) : filteredLost.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="p-6 text-sm text-muted-foreground text-center"
                        >
                          No lost accounts match the current filter.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredLost.map((r) => (
                        <TableRow key={r.account_id}>
                          <TableCell className="font-medium">
                            <Link target="_blank" rel="noopener noreferrer"
                              to={`/accounts/${r.account_id}`}
                              className="text-primary hover:underline"
                            >
                              {r.account_name}
                            </Link>
                          </TableCell>
                          <TableCell>{r.account_status ?? "—"}</TableCell>
                          <TableCell>{r.lost_quarter_label}</TableCell>
                          <TableCell>
                            {formatDate(r.effective_end_date)}
                          </TableCell>
                          <TableCell>
                            {formatDate(r.latest_close_date)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(r.last_amount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(r.total_lifetime_revenue)}
                          </TableCell>
                          <TableCell className="text-right">
                            {r.opp_count}
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
                Accounts lost per quarter — last {HISTORY_QUARTERS} quarters (rolling 365 days)
              </p>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis allowDecimals={false} />
                    <Tooltip
                      formatter={(value, name) => {
                        const n = Number(value) || 0;
                        if (name === "Amount lost")
                          return formatCurrency(n);
                        return n.toLocaleString();
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="lost"
                      name="Lost accounts"
                      stroke="#ef4444"
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
                        Lost Accounts
                      </TableHead>
                      <TableHead className="text-right">Lost Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={3} className="p-4">
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
                            {q.lost_count.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(q.lost_amount)}
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
