import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
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
import { formatCurrency, formatDate } from "@/lib/formatters";
import { downloadCsv, todayStamp, csvCurrency } from "./report-helpers";

/**
 * New Customers — closed_won + kind=new_business in the current fiscal
 * quarter. Columns match SF:
 *   Opportunity Owner, Account Name, Opportunity Name, Type, Amount,
 *   Close Date, Lead Source
 *
 * API: /rest/v1/v_new_customers_qtd?select=*
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
  fiscal_period: string | null;
}

export function NewCustomers() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["report", "new-customers-qtd"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_new_customers_qtd")
        .select("*")
        .order("close_date", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown) as NewCustRow[];
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
        description="New Business closed-won this fiscal quarter."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Count" value={summary.count.toLocaleString()} />
        <Kpi label="Amount" value={formatCurrency(summary.total)} />
        <Kpi label="Fiscal Period" value={rows?.[0]?.fiscal_period ?? ""} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !rows?.length ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              No new customers in the current fiscal quarter yet.
            </p>
          ) : (
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
                {rows.map((r) => (
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
                ))}
              </TableBody>
            </Table>
          )}
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
