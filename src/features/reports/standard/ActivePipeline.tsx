import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
import { formatCurrency, stageLabel } from "@/lib/formatters";
import type { OpportunityStage } from "@/types/crm";

// PostgREST can't auto-infer the shape of a `select` with embedded
// joins when multiple relations come back, so declare the shape
// here and cast. Cheaper than pulling in a generated types file
// for one query.
interface PipelineOpp {
  id: string;
  name: string;
  stage: OpportunityStage;
  amount: number | null;
  probability: number | null;
  close_date: string | null;
  account: { id: string; name: string } | null;
  owner: { id: string; full_name: string | null } | null;
}

/**
 * Active Pipeline — open opportunities by stage and owner, weighted
 * by probability. Stage ladder order mirrors the SF probability
 * progression (Details Analysis 40% → Demo 60% → Proposal/Price
 * Quote 75% → Proposal Conversation 90%).
 *
 * Weighted $ = amount × probability / 100
 * Both raw and weighted are shown because reps care about raw pipeline
 * and leadership cares about the forecast.
 */
const ACTIVE_STAGES: OpportunityStage[] = [
  "details_analysis",
  "demo",
  "proposal_and_price_quote",
  "proposal_conversation",
];

export function ActivePipeline() {
  const { data: opps, isLoading } = useQuery({
    queryKey: ["report", "active-pipeline"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, name, stage, amount, probability, close_date, " +
          "account:accounts!account_id(id, name), " +
          "owner:user_profiles!owner_user_id(id, full_name)"
        )
        .in("stage", ACTIVE_STAGES);
      if (error) throw error;
      return ((data ?? []) as unknown) as PipelineOpp[];
    },
  });

  const byStage = useMemo(() => {
    const m = new Map<OpportunityStage, { count: number; amount: number; weighted: number }>();
    for (const s of ACTIVE_STAGES) m.set(s, { count: 0, amount: 0, weighted: 0 });
    for (const o of opps ?? []) {
      const cur = m.get(o.stage);
      if (!cur) continue;
      const amt = Number(o.amount ?? 0);
      const p = Number(o.probability ?? 0) / 100;
      cur.count += 1;
      cur.amount += amt;
      cur.weighted += amt * p;
    }
    return Array.from(m.entries()).map(([stage, v]) => ({
      stage,
      label: stageLabel(stage),
      ...v,
    }));
  }, [opps]);

  const byOwner = useMemo(() => {
    const m = new Map<string, { name: string; count: number; amount: number; weighted: number }>();
    for (const o of opps ?? []) {
      const oid = o.owner?.id ?? "__unassigned";
      const oname = o.owner?.full_name ?? "Unassigned";
      if (!m.has(oid)) m.set(oid, { name: oname, count: 0, amount: 0, weighted: 0 });
      const cur = m.get(oid)!;
      const amt = Number(o.amount ?? 0);
      const p = Number(o.probability ?? 0) / 100;
      cur.count += 1;
      cur.amount += amt;
      cur.weighted += amt * p;
    }
    return Array.from(m.values()).sort((a, b) => b.weighted - a.weighted);
  }, [opps]);

  const totalAmount = byStage.reduce((s, r) => s + r.amount, 0);
  const totalWeighted = byStage.reduce((s, r) => s + r.weighted, 0);
  const totalCount = byStage.reduce((s, r) => s + r.count, 0);

  function exportCsv() {
    const header = ["Stage", "Count", "Total $", "Weighted $"];
    const rows = byStage.map((r) => [
      r.label,
      r.count,
      r.amount.toFixed(2),
      r.weighted.toFixed(2),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `active-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
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
        title="Active Pipeline"
        description="Open opportunities by stage and owner, weighted by probability."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Open Opportunities" value={totalCount.toLocaleString()} />
        <Kpi label="Total Pipeline $" value={formatCurrency(totalAmount)} />
        <Kpi label="Weighted Pipeline $" value={formatCurrency(totalWeighted)} />
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">By Stage</h3>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byStage}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis
                    tickFormatter={(v) => (v === 0 ? "$0" : `$${(v / 1000).toFixed(0)}k`)}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip
                    formatter={(v) => (typeof v === "number" ? formatCurrency(v) : String(v ?? ""))}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="amount" name="Raw $" fill="#3b82f6" />
                  <Bar dataKey="weighted" name="Weighted $" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">By Stage (Table)</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Total $</TableHead>
                <TableHead className="text-right">Weighted $</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byStage.map((r) => (
                <TableRow key={r.stage}>
                  <TableCell>{r.label}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(r.weighted)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">By Owner</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Total $</TableHead>
                <TableHead className="text-right">Weighted $</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byOwner.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.amount)}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(r.weighted)}
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
