import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
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
import { formatCurrency, formatDate, stageLabel } from "@/lib/formatters";
import type { OpportunityStage } from "@/types/crm";
import { downloadCsv, todayStamp, csvCurrency } from "./report-helpers";

/**
 * Active Pipeline — open opportunities (not Closed Won / Closed Lost).
 * Columns match SF "Active Pipeline":
 *   Opportunity Name, Account Name, Close Date, Amount, Opportunity Owner
 * Grouping: Stage → Type
 *
 * API: /rest/v1/v_active_pipeline?select=*
 */
interface PipelineRow {
  id: string;
  account_id: string | null;
  stage: OpportunityStage;
  type: string | null;
  opportunity_name: string | null;
  account_name: string | null;
  close_date: string | null;
  amount: number | null;
  probability: number | null;
  weighted_amount: number | null;
  opportunity_owner: string | null;
}

export function ActivePipeline() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["report", "active-pipeline-v2"],
    queryFn: async () => {
      // Batch-fetch + client join. Embedded PostgREST joins were
      // silently returning empty in staging.
      const { fetchAccountsById, fetchUsersById, fetchAllRows } = await import("./report-fetchers");
      type OppRaw = {
        id: string;
        name: string | null;
        stage: string | null;
        amount: number | null;
        probability: number | null;
        close_date: string | null;
        kind: string | null;
        account_id: string | null;
        owner_user_id: string | null;
      };
      const opps = await fetchAllRows<OppRaw>(() =>
        supabase
          .from("opportunities")
          .select(
            "id, name, stage, amount, probability, close_date, kind, account_id, owner_user_id",
          )
          .not("stage", "in", "(closed_won,closed_lost)")
          .is("archived_at", null)
          .order("stage", { ascending: true })
          .order("amount", { ascending: false, nullsFirst: false }),
      );
      const accountIds = new Set<string>(
        opps.map((o) => o.account_id as string).filter(Boolean),
      );
      const ownerIds = new Set<string>(
        opps.map((o) => o.owner_user_id as string).filter(Boolean),
      );
      const [accounts, users] = await Promise.all([
        fetchAccountsById(accountIds),
        fetchUsersById(ownerIds),
      ]);

      return opps.map((r) => {
        const amount = r.amount as number | null;
        const probability = r.probability as number | null;
        return {
          id: r.id as string,
          stage: (r.stage as OpportunityStage | null) ?? ("lead" as OpportunityStage),
          type:
            r.kind === "new_business"
              ? "New Business"
              : r.kind === "renewal"
                ? "Existing Business"
                : "",
          opportunity_name: (r.name as string) ?? "",
          account_id: r.account_id as string | null,
          account_name: accounts.get(r.account_id as string)?.name ?? null,
          close_date: r.close_date as string | null,
          amount,
          probability,
          weighted_amount:
            (Number(amount ?? 0) * Number(probability ?? 0)) / 100,
          opportunity_owner:
            users.get(r.owner_user_id as string)?.full_name ?? "Unassigned",
        };
      }) as PipelineRow[];
    },
  });

  // Group by Stage → Type → rows
  const grouped = useMemo(() => {
    const byStage = new Map<OpportunityStage, Map<string, PipelineRow[]>>();
    for (const r of rows ?? []) {
      const stageMap = byStage.get(r.stage) ?? new Map();
      const typeKey = r.type || "Unspecified";
      const list = stageMap.get(typeKey) ?? [];
      list.push(r);
      stageMap.set(typeKey, list);
      byStage.set(r.stage, stageMap);
    }
    return byStage;
  }, [rows]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    const count = list.length;
    const amount = list.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const weighted = list.reduce((s, r) => s + Number(r.weighted_amount ?? 0), 0);
    return { count, amount, weighted };
  }, [rows]);

  function exportCsv() {
    const header = [
      "Stage",
      "Type",
      "Opportunity Name",
      "Account Name",
      "Close Date",
      "Amount",
      "Opportunity Owner",
    ];
    const data = (rows ?? []).map((r) => [
      r.stage ? stageLabel(r.stage) : "",
      r.type ?? "",
      r.opportunity_name ?? "",
      r.account_name ?? "",
      r.close_date ?? "",
      csvCurrency(r.amount),
      r.opportunity_owner ?? "",
    ]);
    downloadCsv(`active-pipeline-${todayStamp()}.csv`, [header, ...data]);
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
        description="All open opportunities grouped by Stage → Type. Matches the SF Active Pipeline report."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Open Opportunities" value={totals.count.toLocaleString()} />
        <Kpi label="Total Pipeline" value={formatCurrency(totals.amount)} />
        <Kpi label="Weighted" value={formatCurrency(totals.weighted)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !rows?.length ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              No open opportunities.
            </p>
          ) : (
            <div className="divide-y">
              {Array.from(grouped.entries()).map(([stage, typeMap]) => (
                <StageGroup
                  key={stage}
                  stage={stage}
                  typeMap={typeMap}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StageGroup({
  stage,
  typeMap,
}: {
  stage: OpportunityStage;
  typeMap: Map<string, PipelineRow[]>;
}) {
  const [open, setOpen] = useState(true);
  const stageCount = Array.from(typeMap.values()).reduce((s, l) => s + l.length, 0);
  const stageAmount = Array.from(typeMap.values())
    .flat()
    .reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 bg-muted/50 hover:bg-muted text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-semibold">{stageLabel(stage)}</span>
        <span className="text-sm text-muted-foreground ml-2">
          {stageCount} opp{stageCount === 1 ? "" : "s"} · {formatCurrency(stageAmount)}
        </span>
      </button>
      {open &&
        Array.from(typeMap.entries()).map(([type, list]) => (
          <TypeGroup key={type} type={type} list={list} />
        ))}
    </div>
  );
}

function TypeGroup({ type, list }: { type: string; list: PipelineRow[] }) {
  const typeAmount = list.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return (
    <div className="border-t">
      <div className="px-8 py-2 text-xs uppercase tracking-wide text-muted-foreground bg-muted/20">
        {type} · {list.length} · {formatCurrency(typeAmount)}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-12">Opportunity Name</TableHead>
            <TableHead>Account Name</TableHead>
            <TableHead>Close Date</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Opportunity Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="pl-12">
                <Link
                  to={`/opportunities/${r.id}`}
                  className="text-primary hover:underline"
                >
                  {r.opportunity_name ?? "—"}
                </Link>
              </TableCell>
              <TableCell>
                {r.account_id ? (
                  <Link to={`/accounts/${r.account_id}`} className="text-primary hover:underline">
                    {r.account_name ?? ""}
                  </Link>
                ) : (
                  r.account_name ?? ""
                )}
              </TableCell>
              <TableCell>{formatDate(r.close_date)}</TableCell>
              <TableCell className="text-right">
                {formatCurrency(Number(r.amount ?? 0))}
              </TableCell>
              <TableCell>{r.opportunity_owner ?? ""}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
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
