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
  DATE_RANGE_OPTIONS,
  resolveRange,
  type DateRangeKey,
} from "./report-helpers";
import { PreviewNote, PREVIEW_LIMIT } from "./PreviewNote";

/**
 * ARR Base Dataset — matches SF report column-for-column:
 *   Account Name, Account Number, Opportunity Name, Opportunity Owner,
 *   Created Date, Close Date, Age, Amount, Fiscal Period,
 *   Payment Frequency, One Time Project, Stage, Type, Account Type,
 *   Primary Partner, Lead Source
 *
 * Business logic (baked into v_arr_base_dataset):
 *   - Type in ('New Business', 'Existing Business', '')
 *   - Opportunity Name ≠ 'Customer Service'
 *   - one_time_project = false (spec excludes one-time projects from
 *     the ARR dataset; the column still shows the value for clarity)
 *
 * API endpoint for the financial spreadsheet:
 *   GET https://<ref>.supabase.co/rest/v1/v_arr_base_dataset?select=*
 */
interface ArrRow {
  id: string;
  account_name: string | null;
  account_number: string | null;
  opportunity_name: string | null;
  opportunity_owner: string | null;
  created_date: string | null;
  close_date: string | null;
  age: number | null;
  amount: number | null;
  fiscal_period: string | null;
  payment_frequency: string | null;
  one_time_project: boolean | null;
  stage: string | null;
  type: string | null;
  account_type: string | null;
  primary_partner: string | null;
  lead_source: string | null;
}

export function ArrBaseDataset() {
  const [range, setRange] = useState<DateRangeKey>("all_time");
  const { start, end } = resolveRange(range);

  const { data: rows, isLoading, error: fetchError } = useQuery({
    queryKey: ["report", "arr-base-dataset-v2", start, end],
    queryFn: async (): Promise<ArrRow[]> => {
      const {
        fetchAccountsById,
        fetchUsersById,
        fetchAllRows,
        fetchPrimaryPartnersByMemberId,
      } = await import("./report-fetchers");
      type OppRaw = {
        id: string;
        name: string | null;
        amount: number | null;
        close_date: string | null;
        created_at: string | null;
        payment_frequency: string | null;
        one_time_project: boolean | null;
        stage: string | null;
        kind: string | null;
        lead_source: string | null;
        lead_source_detail: string | null;
        account_id: string | null;
        owner_user_id: string | null;
      };
      const opps = (await fetchAllRows<OppRaw>(() => {
        let q = supabase
          .from("opportunities")
          .select(
            "id, name, amount, close_date, created_at, payment_frequency, " +
            "one_time_project, stage, kind, lead_source, lead_source_detail, account_id, owner_user_id",
          )
          .is("archived_at", null)
          .neq("name", "Customer Service")
          .eq("one_time_project", false);
        if (start) q = q.gte("close_date", start);
        if (end) q = q.lte("close_date", end);
        return q.order("close_date", { ascending: false, nullsFirst: false });
      })) as OppRaw[];

      // SF "ARR - Chad" spec: Type must be New Business, Existing Business,
      // or blank (but NOT a stale SF default). Our CRM maps kind values
      // (new_business | renewal | null) directly to those — no extra filter
      // needed here. If you want to hide blank-type opps, uncomment below.
      // const oppsFiltered = opps.filter((o) => o.kind !== null);
      const accountIds = new Set<string>(
        opps.map((o) => o.account_id as string).filter(Boolean),
      );
      const ownerIds = new Set<string>(
        opps.map((o) => o.owner_user_id as string).filter(Boolean),
      );
      const [accounts, users, partners] = await Promise.all([
        fetchAccountsById(accountIds),
        fetchUsersById(ownerIds),
        fetchPrimaryPartnersByMemberId(accountIds),
      ]);

      const today = new Date();
      return opps.map((o) => {
        const a = accounts.get(o.account_id as string);
        const closeDate = o.close_date as string | null;
        // Prefer the preserved SF lead source label (lead_source_detail)
        // over the coarse enum value (lead_source). The importer stashes
        // the original SF string in lead_source_detail when the value
        // didn't match a CRM enum (`other`) so it's the real human label.
        const ls = o.lead_source as string | null;
        const lsd = o.lead_source_detail as string | null;
        const leadSourceDisplay =
          lsd && lsd.trim() !== ""
            ? lsd
            : ls && ls !== "other"
              ? // Convert snake_case enum value to Title Case label.
                ls
                  .split("_")
                  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                  .join(" ")
              : (ls ?? "");
        return {
          id: o.id as string,
          account_name: a?.name ?? null,
          account_number: a?.account_number ?? null,
          opportunity_name: (o.name as string) ?? null,
          opportunity_owner:
            users.get(o.owner_user_id as string)?.full_name ?? "Unassigned",
          created_date: (o.created_at as string | null)?.slice(0, 10) ?? null,
          close_date: closeDate,
          age: closeDate
            ? Math.floor(
                (today.getTime() - new Date(closeDate).getTime()) / 86400000,
              )
            : null,
          amount: o.amount as number | null,
          fiscal_period: closeDate
            ? `Q${Math.floor(new Date(closeDate).getUTCMonth() / 3) + 1}-${new Date(closeDate).getUTCFullYear()}`
            : null,
          payment_frequency: (o.payment_frequency as string | null) ?? null,
          one_time_project: o.one_time_project as boolean | null,
          stage: o.stage
            ? stageLabel(o.stage as OpportunityStage)
            : null,
          type:
            o.kind === "new_business"
              ? "New Business"
              : o.kind === "renewal"
                ? "Existing Business"
                : "",
          account_type: a?.account_type ?? null,
          primary_partner: partners.get(o.account_id as string) ?? null,
          lead_source: leadSourceDisplay,
        };
      });
    },
  });

  const summary = useMemo(() => {
    const list = rows ?? [];
    const totalAmount = list.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const wonAmount = list
      .filter((r) => r.stage === "closed_won")
      .reduce((s, r) => s + Number(r.amount ?? 0), 0);
    return { count: list.length, totalAmount, wonAmount };
  }, [rows]);

  function exportCsv() {
    const header = [
      "Account Name",
      "Account Number",
      "Opportunity Name",
      "Opportunity Owner",
      "Created Date",
      "Close Date",
      "Age",
      "Amount",
      "Fiscal Period",
      "Payment Frequency",
      "One Time Project",
      "Stage",
      "Type",
      "Account Type",
      "Primary Partner",
      "Lead Source",
    ];
    const data = (rows ?? []).map((r) => [
      r.account_name ?? "",
      // Account Number as a bare number, not a quoted string — matches
      // the SF "ARR - Chad" column format so pivot tables can use it
      // as a numeric key.
      r.account_number != null && r.account_number !== ""
        ? Number(r.account_number)
        : "",
      r.opportunity_name ?? "",
      r.opportunity_owner ?? "",
      r.created_date ?? "",
      r.close_date ?? "",
      r.age ?? "",
      // Bare numeric so Excel treats Amount as a number for SUM/pivots.
      r.amount != null ? Number(r.amount) : "",
      r.fiscal_period ?? "",
      r.payment_frequency ?? "",
      r.one_time_project ? "TRUE" : "FALSE",
      r.stage ?? "",
      r.type ?? "",
      r.account_type ?? "",
      r.primary_partner ?? "",
      r.lead_source ?? "",
    ]);
    downloadCsv(`arr-base-dataset-${todayStamp()}.csv`, [header, ...data]);
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
        title="ARR Base Dataset"
        description="All ARR-relevant opportunities. Feeds the financial model."
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

      {fetchError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Error: {(fetchError as Error).message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Opportunities" value={summary.count.toLocaleString()} />
        <Kpi label="Total Amount" value={formatCurrency(summary.totalAmount)} />
        <Kpi label="Closed Won Amount" value={formatCurrency(summary.wonAmount)} />
        <Kpi label="API" value="/rest/v1/v_arr_base_dataset" tiny />
      </div>

      <PreviewNote total={rows?.length ?? 0} shown={PREVIEW_LIMIT} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account Name</TableHead>
                  <TableHead>Account #</TableHead>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Close</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Fiscal Period</TableHead>
                  <TableHead>Pay Freq</TableHead>
                  <TableHead>One-Time</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Acct Type</TableHead>
                  <TableHead>Primary Partner</TableHead>
                  <TableHead>Lead Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={16} className="p-4">
                      <Skeleton className="h-48 w-full" />
                    </TableCell>
                  </TableRow>
                ) : !rows?.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={16}
                      className="p-6 text-sm text-muted-foreground text-center"
                    >
                      No opportunities in the selected range.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.slice(0, PREVIEW_LIMIT).map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.account_name ?? "—"}</TableCell>
                      <TableCell>{r.account_number ?? ""}</TableCell>
                      <TableCell>{r.opportunity_name ?? ""}</TableCell>
                      <TableCell>{r.opportunity_owner ?? ""}</TableCell>
                      <TableCell>{formatDate(r.created_date)}</TableCell>
                      <TableCell>{formatDate(r.close_date)}</TableCell>
                      <TableCell className="text-right">{r.age ?? ""}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(r.amount ?? 0))}
                      </TableCell>
                      <TableCell>{r.fiscal_period ?? ""}</TableCell>
                      <TableCell>{r.payment_frequency ?? ""}</TableCell>
                      <TableCell>{r.one_time_project ? "Yes" : "No"}</TableCell>
                      <TableCell>{r.stage ?? ""}</TableCell>
                      <TableCell>{r.type ?? ""}</TableCell>
                      <TableCell>{r.account_type ?? ""}</TableCell>
                      <TableCell>{r.primary_partner ?? ""}</TableCell>
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

function Kpi({ label, value, tiny }: { label: string; value: string; tiny?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className={tiny ? "text-sm font-mono mt-1 truncate" : "text-2xl font-semibold mt-1"}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
