import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
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
import { formatCurrency, formatDate, stageLabel } from "@/lib/formatters";
import type { OpportunityStage } from "@/types/crm";
import {
  downloadCsv,
  todayStamp,
  csvCurrency,
  ownerRoleLabel,
  fiscalPeriod,
  typeLabel,
  DATE_RANGE_OPTIONS,
  resolveRange,
  type DateRangeKey,
} from "./report-helpers";
import { fetchAccountsById, fetchUsersById, fetchAllRows } from "./report-fetchers";
import { PreviewNote, PREVIEW_LIMIT } from "./PreviewNote";

interface RenewalRow {
  id: string;
  owner_role: string;
  opportunity_owner: string;
  account_name: string;
  opportunity_name: string;
  stage: OpportunityStage | null;
  fiscal_period: string;
  amount: number | null;
  probability: number | null;
  age: number | null;
  close_date: string | null;
  created_date: string | null;
  next_step: string | null;
  lead_source: string | null;
  type: string;
}

export function RenewalsQueue() {
  const [range, setRange] = useState<DateRangeKey>("current_quarter");
  const { start, end } = resolveRange(range);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["report", "renewals-v2", start, end],
    queryFn: async (): Promise<RenewalRow[]> => {
      type OppRaw = {
        id: string;
        name: string | null;
        amount: number | null;
        close_date: string | null;
        created_at: string | null;
        next_step: string | null;
        lead_source: string | null;
        probability: number | null;
        stage: string | null;
        kind: string | null;
        account_id: string | null;
        owner_user_id: string | null;
      };
      const opps = await fetchAllRows<OppRaw>(() => {
        let q = supabase
          .from("opportunities")
          .select(
            "id, name, amount, close_date, created_at, next_step, lead_source, probability, stage, kind, account_id, owner_user_id",
          )
          .eq("stage", "closed_won")
          .eq("kind", "renewal")
          .neq("name", "EHR Implementation")
          .is("archived_at", null);
        if (start) q = q.gte("close_date", start);
        if (end) q = q.lte("close_date", end);
        return q.order("close_date", { ascending: false, nullsFirst: false });
      });
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

      const today = new Date();
      return opps.map((o) => {
        const owner = users.get(o.owner_user_id as string);
        const closeDate = o.close_date as string | null;
        return {
          id: o.id as string,
          owner_role: ownerRoleLabel(owner?.role),
          opportunity_owner: owner?.full_name ?? "Unassigned",
          account_name: accounts.get(o.account_id as string)?.name ?? "",
          opportunity_name: (o.name as string) ?? "",
          stage: (o.stage as OpportunityStage | null) ?? ("closed_won" as OpportunityStage),
          fiscal_period: fiscalPeriod(closeDate),
          amount: o.amount as number | null,
          probability: o.probability as number | null,
          age: closeDate
            ? Math.floor(
                (today.getTime() - new Date(closeDate).getTime()) / 86400000,
              )
            : null,
          close_date: closeDate,
          created_date:
            (o.created_at as string | null)?.slice(0, 10) ?? null,
          next_step: o.next_step as string | null,
          lead_source: o.lead_source as string | null,
          type: typeLabel(o.kind as string | null),
        };
      });
    },
  });

  const summary = useMemo(() => {
    const list = rows ?? [];
    const total = list.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    return { count: list.length, total };
  }, [rows]);

  function exportCsv() {
    const header = [
      "Owner Role",
      "Opportunity Owner",
      "Account Name",
      "Opportunity Name",
      "Stage",
      "Fiscal Period",
      "Amount",
      "Probability (%)",
      "Age",
      "Close Date",
      "Created Date",
      "Next Step",
      "Lead Source",
      "Type",
    ];
    const data = (rows ?? []).map((r) => [
      r.owner_role,
      r.opportunity_owner,
      r.account_name,
      r.opportunity_name,
      r.stage ? stageLabel(r.stage) : "",
      r.fiscal_period,
      csvCurrency(r.amount),
      r.probability ?? "",
      r.age ?? "",
      r.close_date ?? "",
      r.created_date ?? "",
      r.next_step ?? "",
      r.lead_source ?? "",
      r.type,
    ]);
    downloadCsv(`renewals-${todayStamp()}.csv`, [header, ...data]);
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
        title="Renewals"
        description="Existing Business closed-won. Excludes EHR Implementation."
        actions={
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as DateRangeKey)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Renewals Closed" value={summary.count.toLocaleString()} />
        <Kpi label="Amount" value={formatCurrency(summary.total)} />
        <Kpi label="Range" value={DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ""} />
      </div>

      <PreviewNote total={rows?.length ?? 0} shown={PREVIEW_LIMIT} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Owner Role</TableHead>
                  <TableHead>Opportunity Owner</TableHead>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Opportunity Name</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Fiscal Period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Prob %</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead>Close Date</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Next Step</TableHead>
                  <TableHead>Lead Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="p-4">
                      <Skeleton className="h-48 w-full" />
                    </TableCell>
                  </TableRow>
                ) : !rows?.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={13}
                      className="p-6 text-sm text-muted-foreground text-center"
                    >
                      No renewals in the selected range.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.slice(0, PREVIEW_LIMIT).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.owner_role}</TableCell>
                      <TableCell>{r.opportunity_owner}</TableCell>
                      <TableCell className="font-medium">{r.account_name}</TableCell>
                      <TableCell>{r.opportunity_name}</TableCell>
                      <TableCell>{r.stage ? stageLabel(r.stage) : ""}</TableCell>
                      <TableCell>{r.fiscal_period}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(r.amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-right">{r.probability ?? ""}</TableCell>
                      <TableCell className="text-right">{r.age ?? ""}</TableCell>
                      <TableCell>{formatDate(r.close_date)}</TableCell>
                      <TableCell>{formatDate(r.created_date)}</TableCell>
                      <TableCell>{r.next_step ?? ""}</TableCell>
                      <TableCell>{r.lead_source ?? ""}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
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
