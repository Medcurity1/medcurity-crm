import { useMemo, useState } from "react";
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
import type { Opportunity, OpportunityStage } from "@/types/crm";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

type AnalyticsOpportunity = Opportunity & {
  owner: { id: string; full_name: string | null } | null;
};

interface StageHistoryRow {
  opportunity_id: string;
  to_stage: OpportunityStage;
  changed_at: string;
}

type DateRange = "30" | "90" | "365";

function useClosedOpportunities(days: number) {
  return useQuery({
    queryKey: ["analytics", "closed-opps", days],
    queryFn: async () => {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const { data, error } = await supabase
        .from("opportunities")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)")
        .is("archived_at", null)
        .in("stage", ["closed_won", "closed_lost"])
        .gte("updated_at", since.toISOString());
      if (error) throw error;
      return (data ?? []) as AnalyticsOpportunity[];
    },
  });
}

function useStageHistory(opportunityIds: string[]) {
  return useQuery({
    queryKey: ["analytics", "stage-history", opportunityIds.sort().join(",")],
    enabled: opportunityIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunity_stage_history")
        .select("opportunity_id, to_stage, changed_at")
        .in("opportunity_id", opportunityIds);
      if (error) throw error;
      return (data ?? []) as StageHistoryRow[];
    },
  });
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(diff) || diff < 0) return null;
  return diff / (1000 * 60 * 60 * 24);
}

export function WinLossAnalysis() {
  const [range, setRange] = useState<DateRange>("90");
  const days = Number(range);

  const { data: closedOpps, isLoading } = useClosedOpportunities(days);
  const opps = closedOpps ?? [];

  const oppIds = useMemo(() => opps.map((o) => o.id), [opps]);
  const { data: historyRows } = useStageHistory(oppIds);

  const summary = useMemo(() => {
    const won = opps.filter((o) => o.stage === "closed_won");
    const lost = opps.filter((o) => o.stage === "closed_lost");
    const totalWon = won.reduce((s, o) => s + Number(o.amount || 0), 0);
    const totalLost = lost.reduce((s, o) => s + Number(o.amount || 0), 0);
    const wonCount = won.length;
    const lostCount = lost.length;
    const winRate =
      wonCount + lostCount === 0
        ? 0
        : (wonCount / (wonCount + lostCount)) * 100;
    const avgDealSize = wonCount === 0 ? 0 : totalWon / wonCount;
    return { winRate, totalWon, totalLost, avgDealSize, wonCount, lostCount };
  }, [opps]);

  const lossReasons = useMemo(() => {
    const lost = opps.filter((o) => o.stage === "closed_lost");
    const grouped: Record<string, { reason: string; count: number; amount: number }> = {};
    for (const o of lost) {
      const reason = (o.loss_reason || "Unspecified").trim() || "Unspecified";
      if (!grouped[reason]) {
        grouped[reason] = { reason, count: 0, amount: 0 };
      }
      grouped[reason].count += 1;
      grouped[reason].amount += Number(o.amount || 0);
    }
    return Object.values(grouped)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [opps]);

  const ownerRows = useMemo(() => {
    const byOwner: Record<
      string,
      { name: string; won: number; lost: number; wonAmount: number }
    > = {};
    for (const o of opps) {
      const key = o.owner_user_id ?? "unassigned";
      const name = o.owner?.full_name ?? "Unassigned";
      if (!byOwner[key]) {
        byOwner[key] = { name, won: 0, lost: 0, wonAmount: 0 };
      }
      if (o.stage === "closed_won") {
        byOwner[key].won += 1;
        byOwner[key].wonAmount += Number(o.amount || 0);
      } else if (o.stage === "closed_lost") {
        byOwner[key].lost += 1;
      }
    }
    return Object.values(byOwner)
      .map((r) => ({
        ...r,
        winRate:
          r.won + r.lost === 0 ? 0 : (r.won / (r.won + r.lost)) * 100,
      }))
      .sort((a, b) => b.winRate - a.winRate);
  }, [opps]);

  const velocity = useMemo(() => {
    const rows = historyRows ?? [];
    // group by opportunity
    const byOpp: Record<string, Record<string, string>> = {};
    for (const h of rows) {
      if (!byOpp[h.opportunity_id]) byOpp[h.opportunity_id] = {};
      // keep earliest
      const existing = byOpp[h.opportunity_id][h.to_stage];
      if (!existing || new Date(h.changed_at) < new Date(existing)) {
        byOpp[h.opportunity_id][h.to_stage] = h.changed_at;
      }
    }
    const oppById: Record<string, AnalyticsOpportunity> = {};
    for (const o of opps) oppById[o.id] = o;

    const leadToQualified: number[] = [];
    const qualifiedToProposal: number[] = [];
    const proposalToVerbal: number[] = [];
    const verbalToWon: number[] = [];
    const createdToClose: number[] = [];

    for (const [oppId, stages] of Object.entries(byOpp)) {
      const opp = oppById[oppId];
      if (!opp) continue;
      const leadAt = stages.lead ?? opp.created_at;
      const qualifiedAt = stages.qualified ?? null;
      const proposalAt = stages.proposal ?? null;
      const verbalAt = stages.verbal_commit ?? null;
      const wonAt = stages.closed_won ?? null;
      const lostAt = stages.closed_lost ?? null;

      const d1 = daysBetween(leadAt, qualifiedAt);
      if (d1 !== null) leadToQualified.push(d1);
      const d2 = daysBetween(qualifiedAt, proposalAt);
      if (d2 !== null) qualifiedToProposal.push(d2);
      const d3 = daysBetween(proposalAt, verbalAt);
      if (d3 !== null) proposalToVerbal.push(d3);
      const d4 = daysBetween(verbalAt, wonAt);
      if (d4 !== null) verbalToWon.push(d4);

      const closeAt = wonAt ?? lostAt;
      const d5 = daysBetween(opp.created_at, closeAt);
      if (d5 !== null) createdToClose.push(d5);
    }

    return {
      leadToQualified: avg(leadToQualified),
      qualifiedToProposal: avg(qualifiedToProposal),
      proposalToVerbal: avg(proposalToVerbal),
      verbalToWon: avg(verbalToWon),
      totalCycle: avg(createdToClose),
    };
  }, [historyRows, opps]);

  return (
    <div>
      <PageHeader
        title="Win/Loss Analysis"
        description="Deal outcomes, loss reasons, and sales velocity"
        actions={
          <Select value={range} onValueChange={(v) => setRange(v as DateRange)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last 365 days</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <SummaryCard
            label="Win Rate"
            value={`${summary.winRate.toFixed(1)}%`}
            sub={`${summary.wonCount} won / ${summary.lostCount} lost`}
          />
          <SummaryCard
            label="Total Closed Won"
            value={formatCurrency(summary.totalWon)}
          />
          <SummaryCard
            label="Total Closed Lost"
            value={formatCurrency(summary.totalLost)}
          />
          <SummaryCard
            label="Avg Deal Size"
            value={formatCurrency(summary.avgDealSize)}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Loss Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : lossReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No closed-lost deals in this period
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={lossReasons}
                  layout="vertical"
                  margin={{ left: 20, right: 20 }}
                >
                  <XAxis type="number" fontSize={12} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="reason"
                    fontSize={12}
                    width={140}
                  />
                  <Tooltip
                    formatter={(value) => [String(value), "Deals"]}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {lossReasons.map((_, i) => (
                      <Cell key={i} fill="#ef4444" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sales Velocity</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage Transition</TableHead>
                    <TableHead className="text-right">Avg Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <VelocityRow
                    label="Lead &rarr; Qualified"
                    days={velocity.leadToQualified}
                  />
                  <VelocityRow
                    label="Qualified &rarr; Proposal"
                    days={velocity.qualifiedToProposal}
                  />
                  <VelocityRow
                    label="Proposal &rarr; Verbal Commit"
                    days={velocity.proposalToVerbal}
                  />
                  <VelocityRow
                    label="Verbal Commit &rarr; Closed Won"
                    days={velocity.verbalToWon}
                  />
                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell>Total Sales Cycle</TableCell>
                    <TableCell className="text-right">
                      {velocity.totalCycle > 0
                        ? `${velocity.totalCycle.toFixed(1)} days`
                        : "\u2014"}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Win Rate by Owner</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : ownerRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No closed deals in this period
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Won</TableHead>
                  <TableHead className="text-right">Lost</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Total Won</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ownerRows.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{row.won}</TableCell>
                    <TableCell className="text-right">{row.lost}</TableCell>
                    <TableCell className="text-right">
                      {row.winRate.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(row.wonAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground font-medium">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function VelocityRow({ label, days }: { label: string; days: number }) {
  return (
    <TableRow>
      <TableCell
        className="text-sm"
        dangerouslySetInnerHTML={{ __html: label }}
      />
      <TableCell className="text-right">
        {days > 0 ? `${days.toFixed(1)} days` : "\u2014"}
      </TableCell>
    </TableRow>
  );
}
