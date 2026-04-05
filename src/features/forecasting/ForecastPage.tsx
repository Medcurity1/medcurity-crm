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
import { formatCurrency, stageLabel } from "@/lib/formatters";

type ForecastOpportunity = Opportunity & {
  owner: { full_name: string | null } | null;
};

const STAGE_WEIGHTS: Record<OpportunityStage, number> = {
  lead: 0.1,
  qualified: 0.3,
  proposal: 0.6,
  verbal_commit: 0.9,
  closed_won: 1.0,
  closed_lost: 0,
};

const FORECAST_STAGES: OpportunityStage[] = [
  "lead",
  "qualified",
  "proposal",
  "verbal_commit",
];

const STAGE_COLORS: Record<string, string> = {
  lead: "#94a3b8",
  qualified: "#3b82f6",
  proposal: "#8b5cf6",
  verbal_commit: "#f59e0b",
};

const QUOTA_PLACEHOLDER = 500000;

function useForecastOpportunities(year: number, quarter: number) {
  return useQuery({
    queryKey: ["forecast", year, quarter],
    queryFn: async () => {
      const startOfQuarter = new Date(year, quarter * 3, 1);
      const endOfQuarter = new Date(year, quarter * 3 + 3, 0);
      const { data, error } = await supabase
        .from("opportunities")
        .select("*, owner:user_profiles!owner_user_id(full_name)")
        .is("archived_at", null)
        .gte("expected_close_date", startOfQuarter.toISOString().slice(0, 10))
        .lte("expected_close_date", endOfQuarter.toISOString().slice(0, 10));
      if (error) throw error;
      return (data ?? []) as ForecastOpportunity[];
    },
  });
}

function getCurrentQuarter(): number {
  return Math.floor(new Date().getMonth() / 3);
}

export function ForecastPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(getCurrentQuarter());

  const { data: opps, isLoading } = useForecastOpportunities(year, quarter);

  const summary = useMemo(() => {
    const list = opps ?? [];
    const sumAmount = (filterFn: (o: ForecastOpportunity) => boolean) =>
      list.filter(filterFn).reduce((sum, o) => sum + Number(o.amount || 0), 0);

    const committed = sumAmount(
      (o) => o.stage === "closed_won" || o.stage === "verbal_commit"
    );
    const proposalAmount = sumAmount((o) => o.stage === "proposal");
    const bestCase = committed + proposalAmount * 0.6;
    const pipeline = sumAmount((o) => o.stage !== "closed_lost");
    return { committed, bestCase, pipeline, quota: QUOTA_PLACEHOLDER };
  }, [opps]);

  const ownerRows = useMemo(() => {
    const list = opps ?? [];
    const byOwner: Record<
      string,
      {
        name: string;
        committed: number;
        proposalAmount: number;
        pipeline: number;
        count: number;
      }
    > = {};
    for (const o of list) {
      if (o.stage === "closed_lost") continue;
      const ownerName = o.owner?.full_name ?? "Unassigned";
      const key = o.owner_user_id ?? "unassigned";
      if (!byOwner[key]) {
        byOwner[key] = {
          name: ownerName,
          committed: 0,
          proposalAmount: 0,
          pipeline: 0,
          count: 0,
        };
      }
      const amt = Number(o.amount || 0);
      byOwner[key].pipeline += amt;
      byOwner[key].count += 1;
      if (o.stage === "closed_won" || o.stage === "verbal_commit") {
        byOwner[key].committed += amt;
      }
      if (o.stage === "proposal") {
        byOwner[key].proposalAmount += amt;
      }
    }
    return Object.values(byOwner)
      .map((r) => ({
        name: r.name,
        committed: r.committed,
        bestCase: r.committed + r.proposalAmount * 0.6,
        pipeline: r.pipeline,
        count: r.count,
      }))
      .sort((a, b) => b.bestCase - a.bestCase);
  }, [opps]);

  const ownerTotals = useMemo(
    () =>
      ownerRows.reduce(
        (acc, r) => ({
          committed: acc.committed + r.committed,
          bestCase: acc.bestCase + r.bestCase,
          pipeline: acc.pipeline + r.pipeline,
          count: acc.count + r.count,
        }),
        { committed: 0, bestCase: 0, pipeline: 0, count: 0 }
      ),
    [ownerRows]
  );

  const weightedChartData = useMemo(() => {
    const list = opps ?? [];
    return FORECAST_STAGES.map((stage) => {
      const rawAmount = list
        .filter((o) => o.stage === stage)
        .reduce((sum, o) => sum + Number(o.amount || 0), 0);
      const weighted = rawAmount * STAGE_WEIGHTS[stage];
      return {
        stage: stageLabel(stage),
        stageKey: stage,
        weighted,
        raw: rawAmount,
      };
    });
  }, [opps]);

  const yearOptions = useMemo(() => {
    const thisYear = new Date().getFullYear();
    return [thisYear - 1, thisYear, thisYear + 1];
  }, []);

  return (
    <div>
      <PageHeader
        title="Sales Forecast"
        description="Projected revenue based on open pipeline"
        actions={
          <div className="flex items-center gap-2">
            <Select
              value={String(quarter)}
              onValueChange={(v) => setQuarter(Number(v))}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Q1</SelectItem>
                <SelectItem value="1">Q2</SelectItem>
                <SelectItem value="2">Q3</SelectItem>
                <SelectItem value="3">Q4</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={String(year)}
              onValueChange={(v) => setYear(Number(v))}
            >
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
          <SummaryCard label="Committed" value={formatCurrency(summary.committed)} />
          <SummaryCard label="Best Case" value={formatCurrency(summary.bestCase)} />
          <SummaryCard label="Pipeline" value={formatCurrency(summary.pipeline)} />
          <SummaryCard label="Quota" value={formatCurrency(summary.quota)} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Forecast by Owner</CardTitle>
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
                No opportunities with expected close dates in this quarter
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Committed</TableHead>
                    <TableHead className="text-right">Best Case</TableHead>
                    <TableHead className="text-right">Pipeline</TableHead>
                    <TableHead className="text-right">Deals</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ownerRows.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.committed)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.bestCase)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.pipeline)}
                      </TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-semibold bg-muted/30">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(ownerTotals.committed)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(ownerTotals.bestCase)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(ownerTotals.pipeline)}
                    </TableCell>
                    <TableCell className="text-right">
                      {ownerTotals.count}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Weighted Pipeline by Stage</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : weightedChartData.every((d) => d.weighted === 0) ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                No pipeline data for this quarter
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={weightedChartData}>
                  <XAxis dataKey="stage" fontSize={12} />
                  <YAxis
                    tickFormatter={(v) => formatCurrency(Number(v))}
                    fontSize={12}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      formatCurrency(Number(value)),
                      name === "weighted" ? "Weighted" : "Raw",
                    ]}
                    labelStyle={{ fontWeight: 600 }}
                  />
                  <Bar dataKey="weighted" radius={[4, 4, 0, 0]}>
                    {weightedChartData.map((entry) => (
                      <Cell
                        key={entry.stageKey}
                        fill={STAGE_COLORS[entry.stageKey] ?? "#6b7280"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground font-medium">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
