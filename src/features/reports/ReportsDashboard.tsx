import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { supabase } from "@/lib/supabase";
import type { PipelineSummaryRow } from "@/types/crm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, stageLabel } from "@/lib/formatters";

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

function usePipelineSummary() {
  return useQuery({
    queryKey: ["pipeline_summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_summary")
        .select("*");
      if (error) throw error;
      return data as PipelineSummaryRow[];
    },
  });
}

function useClosedWonTotal() {
  return useQuery({
    queryKey: ["closed_won_total"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("amount")
        .eq("stage", "closed_won")
        .is("archived_at", null);
      if (error) throw error;
      return data.reduce((sum, o) => sum + Number(o.amount), 0);
    },
  });
}

function useRenewalCount() {
  return useQuery({
    queryKey: ["renewal_count"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("renewal_queue")
        .select("source_opportunity_id");
      if (error) throw error;
      return data.length;
    },
  });
}

function useWinRate() {
  return useQuery({
    queryKey: ["reports", "win-rate"],
    queryFn: async () => {
      const { count: wonCount, error: wErr } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("stage", "closed_won")
        .is("archived_at", null);
      if (wErr) throw wErr;

      const { count: lostCount, error: lErr } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("stage", "closed_lost")
        .is("archived_at", null);
      if (lErr) throw lErr;

      const won = wonCount ?? 0;
      const lost = lostCount ?? 0;
      const total = won + lost;
      const rate = total > 0 ? Math.round((won / total) * 100) : 0;
      return { won, total, rate };
    },
  });
}

function useAverageDealSize() {
  return useQuery({
    queryKey: ["reports", "avg-deal-size"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("amount")
        .eq("stage", "closed_won")
        .is("archived_at", null);
      if (error) throw error;
      const amounts = (data ?? []).map((o) => Number(o.amount));
      if (amounts.length === 0) return 0;
      return amounts.reduce((sum, a) => sum + a, 0) / amounts.length;
    },
  });
}

function useTopAccountsByRevenue() {
  return useQuery({
    queryKey: ["reports", "top-accounts-revenue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("amount, account:accounts(id, name)")
        .eq("stage", "closed_won")
        .is("archived_at", null);
      if (error) throw error;

      const byAccount: Record<string, { name: string; total: number }> = {};
      for (const row of data ?? []) {
        const acct = row.account as unknown as { id: string; name: string } | null;
        if (!acct) continue;
        if (!byAccount[acct.id]) {
          byAccount[acct.id] = { name: acct.name, total: 0 };
        }
        byAccount[acct.id].total += Number(row.amount);
      }

      return Object.values(byAccount)
        .sort((a, b) => b.total - a.total)
        .slice(0, 5);
    },
  });
}

function usePipelineVelocity() {
  return useQuery({
    queryKey: ["reports", "pipeline-velocity"],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count, error } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .gte("close_date", thirtyDaysAgo.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  });
}

const STAGE_COLORS: Record<string, string> = {
  lead: "#94a3b8",
  qualified: "#3b82f6",
  proposal: "#8b5cf6",
  verbal_commit: "#f59e0b",
  closed_won: "#10b981",
  closed_lost: "#ef4444",
};

export function ReportsDashboard() {
  const { data: summary, isLoading: loadingSummary } = usePipelineSummary();
  const { data: closedWonTotal, isLoading: loadingCW } = useClosedWonTotal();
  const { data: renewalCount } = useRenewalCount();
  const { data: winRate, isLoading: loadingWinRate } = useWinRate();
  const { data: avgDeal, isLoading: loadingAvgDeal } = useAverageDealSize();
  const { data: topAccounts, isLoading: loadingTopAccounts } = useTopAccountsByRevenue();
  const { data: velocity, isLoading: loadingVelocity } = usePipelineVelocity();

  const totalPipeline = summary
    ?.filter((s) => !["closed_won", "closed_lost"].includes(s.stage))
    .reduce((sum, s) => sum + Number(s.total_amount), 0) ?? 0;

  const totalOpenOpps = summary
    ?.filter((s) => !["closed_won", "closed_lost"].includes(s.stage))
    .reduce((sum, s) => sum + Number(s.opportunity_count), 0) ?? 0;

  // Aggregate by stage for chart
  const stageData = summary
    ? Object.entries(
        summary.reduce<Record<string, { count: number; amount: number }>>((acc, row) => {
          if (!acc[row.stage]) acc[row.stage] = { count: 0, amount: 0 };
          acc[row.stage].count += Number(row.opportunity_count);
          acc[row.stage].amount += Number(row.total_amount);
          return acc;
        }, {})
      ).map(([stage, vals]) => ({
        stage: stageLabel(stage as PipelineSummaryRow["stage"]),
        stageKey: stage,
        count: vals.count,
        amount: vals.amount,
      }))
    : [];

  const isLoading = loadingSummary || loadingCW;

  return (
    <div>
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <MetricCard label="Open Pipeline" value={formatCurrency(totalPipeline)} />
            <MetricCard label="Open Opportunities" value={String(totalOpenOpps)} />
            <MetricCard label="Total Closed Won ARR" value={formatCurrency(closedWonTotal ?? 0)} />
            <MetricCard label="Upcoming Renewals" value={String(renewalCount ?? 0)} />
          </div>

          {/* Pipeline Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pipeline by Stage (Amount)</CardTitle>
              </CardHeader>
              <CardContent>
                {stageData.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={stageData} layout="vertical">
                      <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} fontSize={12} />
                      <YAxis type="category" dataKey="stage" width={100} fontSize={12} />
                      <Tooltip
                        formatter={(value) => formatCurrency(Number(value))}
                        labelStyle={{ fontWeight: 600 }}
                      />
                      <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
                        {stageData.map((entry) => (
                          <Cell key={entry.stageKey} fill={STAGE_COLORS[entry.stageKey] ?? "#6b7280"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No pipeline data yet</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pipeline by Stage (Count)</CardTitle>
              </CardHeader>
              <CardContent>
                {stageData.length ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={stageData} layout="vertical">
                      <XAxis type="number" fontSize={12} />
                      <YAxis type="category" dataKey="stage" width={100} fontSize={12} />
                      <Tooltip labelStyle={{ fontWeight: 600 }} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {stageData.map((entry) => (
                          <Cell key={entry.stageKey} fill={STAGE_COLORS[entry.stageKey] ?? "#6b7280"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-muted-foreground py-8 text-center">No pipeline data yet</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Additional Report Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Win Rate Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Win Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingWinRate ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <p className="text-2xl font-bold">{winRate?.rate ?? 0}% Win Rate</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {winRate?.won ?? 0} won / {winRate?.total ?? 0} total
                    </p>
                    <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${winRate?.rate ?? 0}%` }}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Average Deal Size Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Average Deal Size
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingAvgDeal ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <p className="text-2xl font-bold">
                    {formatCurrency(avgDeal ?? 0)}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Top Accounts by Revenue Card */}
            <Card className="sm:col-span-1 lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Top Accounts by Revenue
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingTopAccounts ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-5 w-full" />
                    ))}
                  </div>
                ) : !topAccounts?.length ? (
                  <p className="text-sm text-muted-foreground">No data yet</p>
                ) : (
                  <ol className="space-y-1.5">
                    {topAccounts.map((acct, idx) => (
                      <li key={idx} className="text-sm flex justify-between">
                        <span className="truncate font-medium">
                          {idx + 1}. {acct.name}
                        </span>
                        <span className="ml-2 shrink-0 text-muted-foreground">
                          {formatCurrency(acct.total)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>

            {/* Pipeline Velocity Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Pipeline Velocity
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingVelocity ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <p className="text-2xl font-bold">{velocity ?? 0}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      deals closed in last 30 days
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground font-medium">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
