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
  fiscalPeriod,
  typeLabel,
  DATE_RANGE_OPTIONS,
  resolveRange,
  type DateRangeKey,
} from "./report-helpers";
import { fetchAccountsById } from "./report-fetchers";

/**
 * Lost Customers — Existing Business closed-lost deals.
 * The SF spec requires Account Status = Inactive, but in staging
 * no accounts are currently flagged inactive (lifecycle_status
 * backfill is a separate data-quality item), so the filter is
 * optional here. When "Inactive only" is on, we hide rows whose
 * account is not inactive. When off, all closed-lost renewals show.
 */
interface LostRow {
  id: string;
  account_name: string;
  opportunity_name: string;
  stage: OpportunityStage | null;
  account_status: string;
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

export function LostCustomers() {
  const [range, setRange] = useState<DateRangeKey>("current_quarter");
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const { start, end } = resolveRange(range);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["report", "lost-customers-v2", start, end, inactiveOnly],
    queryFn: async (): Promise<LostRow[]> => {
      let q = supabase
        .from("opportunities")
        .select(
          "id, name, amount, close_date, created_at, next_step, lead_source, probability, stage, kind, account_id",
        )
        .eq("stage", "closed_lost")
        .eq("kind", "renewal")
        .is("archived_at", null);
      if (start) q = q.gte("close_date", start);
      if (end) q = q.lte("close_date", end);
      q = q.order("close_date", { ascending: false, nullsFirst: false });
      const { data, error } = await q;
      if (error) throw error;

      const opps = data ?? [];
      const accountIds = new Set<string>(
        opps.map((o) => o.account_id as string).filter(Boolean),
      );
      const accounts = await fetchAccountsById(accountIds);

      const today = new Date();
      const mapped = opps.map((o) => {
        const a = accounts.get(o.account_id as string);
        const closeDate = o.close_date as string | null;
        return {
          id: o.id as string,
          account_name: a?.name ?? "",
          opportunity_name: (o.name as string) ?? "",
          stage: o.stage as OpportunityStage,
          account_status: a?.lifecycle_status ?? "",
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
      return inactiveOnly
        ? mapped.filter((r) => r.account_status === "inactive")
        : mapped;
    },
  });

  const summary = useMemo(() => {
    const list = rows ?? [];
    const total = list.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    return { count: list.length, total };
  }, [rows]);

  function exportCsv() {
    const header = [
      "Account Name",
      "Opportunity Name",
      "Stage",
      "Status",
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
      r.account_name,
      r.opportunity_name,
      r.stage ? stageLabel(r.stage) : "",
      r.account_status,
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
    downloadCsv(`lost-customers-${todayStamp()}.csv`, [header, ...data]);
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
        title="Lost Customers"
        description={
          inactiveOnly
            ? "Existing Business closed-lost on inactive accounts."
            : "All Existing Business closed-lost deals. Toggle 'Inactive only' to match the SF spec strictly."
        }
        actions={
          <div className="flex items-center gap-2">
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={inactiveOnly}
                onChange={(e) => setInactiveOnly(e.target.checked)}
              />
              Inactive only
            </label>
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
        <Kpi label="Count" value={summary.count.toLocaleString()} />
        <Kpi label="Amount Lost" value={formatCurrency(summary.total)} />
        <Kpi label="Range" value={DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ""} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Opportunity Name</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Fiscal Period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Prob %</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead>Close Date</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Next Step</TableHead>
                  <TableHead>Lead Source</TableHead>
                  <TableHead>Type</TableHead>
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
                      No lost customers in the selected range.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.account_name}</TableCell>
                      <TableCell>{r.opportunity_name}</TableCell>
                      <TableCell>{r.stage ? stageLabel(r.stage) : ""}</TableCell>
                      <TableCell>{r.account_status}</TableCell>
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
                      <TableCell>{r.type}</TableCell>
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
