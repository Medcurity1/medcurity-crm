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
import { formatCurrency, formatDate } from "@/lib/formatters";
import {
  downloadCsv,
  todayStamp,
  csvCurrency,
  DATE_RANGE_OPTIONS,
  resolveRange,
  type DateRangeKey,
} from "./report-helpers";

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

  const { data: rows, isLoading } = useQuery({
    queryKey: ["report", "arr-base-dataset", start, end],
    queryFn: async () => {
      let q = supabase.from("v_arr_base_dataset").select("*").limit(5000);
      if (start) q = q.gte("close_date", start);
      if (end) q = q.lte("close_date", end);
      q = q.order("close_date", { ascending: false, nullsFirst: false });
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as unknown) as ArrRow[];
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
      r.account_number ?? "",
      r.opportunity_name ?? "",
      r.opportunity_owner ?? "",
      r.created_date ?? "",
      r.close_date ?? "",
      r.age ?? "",
      csvCurrency(r.amount),
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Opportunities" value={summary.count.toLocaleString()} />
        <Kpi label="Total Amount" value={formatCurrency(summary.totalAmount)} />
        <Kpi label="Closed Won Amount" value={formatCurrency(summary.wonAmount)} />
        <Kpi label="API" value="/rest/v1/v_arr_base_dataset" tiny />
      </div>

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
                  rows.map((r) => (
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
