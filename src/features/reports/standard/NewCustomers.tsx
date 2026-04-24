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
  typeLabel,
  type DateRangeKey,
} from "./report-helpers";

/**
 * New Customers — closed_won + kind=new_business.
 * Default range: current fiscal quarter. Configurable via picker.
 * Queries opportunities directly so any range works (the QTD view
 * is only used when range is locked to current quarter).
 */
interface NewCustRow {
  id: string;
  opportunity_owner: string | null;
  account_name: string | null;
  opportunity_name: string | null;
  type: string | null;
  amount: number | null;
  close_date: string | null;
  lead_source: string | null;
}

export function NewCustomers() {
  const [range, setRange] = useState<DateRangeKey>("current_quarter");
  const { start, end } = resolveRange(range);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["report", "new-customers", start, end],
    queryFn: async () => {
      let q = supabase
        .from("opportunities")
        .select(
          "id, name, amount, close_date, lead_source, kind, " +
          "account:accounts!account_id(name), " +
          "owner:user_profiles!owner_user_id(full_name)",
        )
        .eq("stage", "closed_won")
        .eq("kind", "new_business")
        .is("archived_at", null);
      if (start) q = q.gte("close_date", start);
      if (end) q = q.lte("close_date", end);
      q = q.order("close_date", { ascending: false, nullsFirst: false });
      const { data, error } = await q;
      if (error) throw error;
      type Raw = {
        id: string;
        name: string;
        amount: number | null;
        close_date: string | null;
        lead_source: string | null;
        kind: string | null;
        account: { name: string } | null;
        owner: { full_name: string | null } | null;
      };
      return ((data ?? []) as unknown as Raw[]).map((r) => ({
        id: r.id,
        opportunity_owner: r.owner?.full_name ?? "Unassigned",
        account_name: r.account?.name ?? null,
        opportunity_name: r.name,
        type: typeLabel(r.kind),
        amount: r.amount,
        close_date: r.close_date,
        lead_source: r.lead_source,
      })) as NewCustRow[];
    },
  });

  const summary = useMemo(() => {
    const list = rows ?? [];
    const total = list.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    return { count: list.length, total };
  }, [rows]);

  function exportCsv() {
    const header = [
      "Opportunity Owner",
      "Account Name",
      "Opportunity Name",
      "Type",
      "Amount",
      "Close Date",
      "Lead Source",
    ];
    const data = (rows ?? []).map((r) => [
      r.opportunity_owner ?? "",
      r.account_name ?? "",
      r.opportunity_name ?? "",
      r.type ?? "",
      csvCurrency(r.amount),
      r.close_date ?? "",
      r.lead_source ?? "",
    ]);
    downloadCsv(`new-customers-${todayStamp()}.csv`, [header, ...data]);
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
        title="New Customers"
        description="New Business closed-won opportunities."
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Count" value={summary.count.toLocaleString()} />
        <Kpi label="Amount" value={formatCurrency(summary.total)} />
        <Kpi label="Range" value={DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ""} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Opportunity Owner</TableHead>
                <TableHead>Account Name</TableHead>
                <TableHead>Opportunity Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Close Date</TableHead>
                <TableHead>Lead Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-4">
                    <Skeleton className="h-48 w-full" />
                  </TableCell>
                </TableRow>
              ) : !rows?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-6 text-sm text-muted-foreground text-center">
                    No new customers in the selected range.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.opportunity_owner ?? ""}</TableCell>
                    <TableCell className="font-medium">{r.account_name ?? ""}</TableCell>
                    <TableCell>{r.opportunity_name ?? ""}</TableCell>
                    <TableCell>{r.type ?? ""}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(Number(r.amount ?? 0))}
                    </TableCell>
                    <TableCell>{formatDate(r.close_date)}</TableCell>
                    <TableCell>{r.lead_source ?? ""}</TableCell>
                  </TableRow>
                ))
              )}
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
