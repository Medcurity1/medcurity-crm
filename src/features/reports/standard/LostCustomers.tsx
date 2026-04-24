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
import { formatCurrency, formatDate, stageLabel } from "@/lib/formatters";
import { downloadCsv, todayStamp, csvCurrency } from "./report-helpers";

/**
 * Lost Customers — current fiscal quarter, closed_lost,
 * kind=renewal (Existing Business), account lifecycle_status=inactive.
 * Columns match SF:
 *   Account Name, Opportunity Name, Stage, Status, Fiscal Period,
 *   Amount, Probability (%), Age, Close Date, Created Date, Next Step,
 *   Lead Source, Type
 *
 * API: /rest/v1/v_lost_customers_qtd?select=*
 */
interface LostRow {
  id: string;
  account_name: string | null;
  opportunity_name: string | null;
  stage: string | null;
  account_status: string | null;
  fiscal_period: string | null;
  amount: number | null;
  probability: number | null;
  age: number | null;
  close_date: string | null;
  created_date: string | null;
  next_step: string | null;
  lead_source: string | null;
  type: string | null;
}

export function LostCustomers() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["report", "lost-customers-qtd"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_lost_customers_qtd")
        .select("*")
        .order("close_date", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown) as LostRow[];
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
      r.account_name ?? "",
      r.opportunity_name ?? "",
      r.stage ?? "",
      r.account_status ?? "",
      r.fiscal_period ?? "",
      csvCurrency(r.amount),
      r.probability ?? "",
      r.age ?? "",
      r.close_date ?? "",
      r.created_date ?? "",
      r.next_step ?? "",
      r.lead_source ?? "",
      r.type ?? "",
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
        description="Existing Business closed-lost this fiscal quarter on inactive accounts."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Count" value={summary.count.toLocaleString()} />
        <Kpi label="Amount Lost" value={formatCurrency(summary.total)} />
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
              No lost customers this fiscal quarter.
            </p>
          ) : (
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
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.account_name ?? ""}</TableCell>
                      <TableCell>{r.opportunity_name ?? ""}</TableCell>
                      <TableCell>{r.stage ? stageLabel(r.stage as never) : ""}</TableCell>
                      <TableCell>{r.account_status ?? ""}</TableCell>
                      <TableCell>{r.fiscal_period ?? ""}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(r.amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-right">{r.probability ?? ""}</TableCell>
                      <TableCell className="text-right">{r.age ?? ""}</TableCell>
                      <TableCell>{formatDate(r.close_date)}</TableCell>
                      <TableCell>{formatDate(r.created_date)}</TableCell>
                      <TableCell>{r.next_step ?? ""}</TableCell>
                      <TableCell>{r.lead_source ?? ""}</TableCell>
                      <TableCell>{r.type ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
