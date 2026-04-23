import { useState, useMemo } from "react";
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

/**
 * Renewals Queue — upcoming renewals in the next N days, driven by
 * opportunity.maturity_date rather than close_date. An opp is
 * "upcoming renewal" if:
 *   - stage = closed_won (active contract)
 *   - maturity_date IS NOT NULL
 *   - maturity_date BETWEEN today AND today + window
 *   - account.renewal_type IS NOT 'no_auto_renew'
 *
 * This matches the SF renewal-flow trigger logic (120-day lookahead).
 * Table is sortable by maturity date so reps see what's closest
 * first.
 */
const WINDOW_OPTIONS = [30, 60, 90, 120, 180] as const;
type WindowDays = (typeof WINDOW_OPTIONS)[number];

// Same PostgREST inference trick as ActivePipeline — declare the
// shape locally and cast to avoid `Property does not exist on type
// 'GenericStringError'` noise from embedded-select typings.
interface RenewalOpp {
  id: string;
  name: string;
  amount: number | null;
  maturity_date: string | null;
  close_date: string | null;
  account: {
    id: string;
    name: string;
    renewal_type: string | null;
    lifecycle_status: string | null;
  } | null;
  owner: { id: string; full_name: string | null } | null;
}

export function RenewalsQueue() {
  const [windowDays, setWindowDays] = useState<WindowDays>(120);

  const { data: opps, isLoading } = useQuery({
    queryKey: ["report", "renewals-queue", windowDays],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const until = new Date();
      until.setDate(until.getDate() + windowDays);
      const untilIso = until.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, name, amount, maturity_date, close_date, " +
          "account:accounts!account_id(id, name, renewal_type, lifecycle_status), " +
          "owner:user_profiles!owner_user_id(id, full_name)"
        )
        .eq("stage", "closed_won")
        .gte("maturity_date", today)
        .lte("maturity_date", untilIso)
        .order("maturity_date", { ascending: true });
      if (error) throw error;
      // Filter out 'no_auto_renew' accounts client-side since we can't
      // nested-filter through a join in PostgREST without a view.
      const rows = ((data ?? []) as unknown) as RenewalOpp[];
      return rows.filter((o) => o.account?.renewal_type !== "no_auto_renew");
    },
  });

  const summary = useMemo(() => {
    const rows = opps ?? [];
    const totalArr = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    // Buckets by days-from-now
    const now = Date.now();
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "91+": 0 };
    for (const r of rows) {
      if (!r.maturity_date) continue;
      const days = Math.ceil((new Date(r.maturity_date).getTime() - now) / 86400000);
      if (days <= 30) buckets["0-30"]++;
      else if (days <= 60) buckets["31-60"]++;
      else if (days <= 90) buckets["61-90"]++;
      else buckets["91+"]++;
    }
    return { count: rows.length, totalArr, buckets };
  }, [opps]);

  function exportCsv() {
    const header = ["Account", "Opportunity", "Maturity Date", "Amount", "Owner", "Renewal Type"];
    const rows = (opps ?? []).map((o) => [
      o.account?.name ?? "",
      o.name,
      o.maturity_date ?? "",
      Number(o.amount ?? 0).toFixed(2),
      o.owner?.full_name ?? "Unassigned",
      o.account?.renewal_type ?? "",
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `renewals-queue-${new Date().toISOString().slice(0, 10)}.csv`;
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
        title="Renewals Queue"
        description={`Closed-won contracts maturing in the next ${windowDays} days.`}
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border">
              {WINDOW_OPTIONS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWindowDays(w)}
                  className={`px-3 py-1.5 text-sm ${windowDays === w ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {w}d
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Total" value={summary.count.toLocaleString()} />
        <Kpi label="0-30 days" value={summary.buckets["0-30"].toLocaleString()} highlight />
        <Kpi label="31-60 days" value={summary.buckets["31-60"].toLocaleString()} />
        <Kpi label="61-90 days" value={summary.buckets["61-90"].toLocaleString()} />
        <Kpi label="At-Risk ARR" value={formatCurrency(summary.totalArr)} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !opps?.length ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              No renewals in the next {windowDays} days.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Opportunity</TableHead>
                  <TableHead>Maturity</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opps.map((o) => {
                  const days = o.maturity_date
                    ? Math.ceil(
                        (new Date(o.maturity_date).getTime() - Date.now()) / 86400000
                      )
                    : null;
                  return (
                    <TableRow key={o.id}>
                      <TableCell>
                        {o.account ? (
                          <Link
                            to={`/accounts/${o.account.id}`}
                            className="text-primary hover:underline font-medium"
                          >
                            {o.account.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/opportunities/${o.id}`}
                          className="text-primary hover:underline"
                        >
                          {o.name}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(o.maturity_date)}</TableCell>
                      <TableCell
                        className={
                          days !== null && days <= 30
                            ? "text-destructive font-medium"
                            : ""
                        }
                      >
                        {days !== null ? `${days}d` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(Number(o.amount ?? 0))}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {o.owner?.full_name ?? "Unassigned"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "border-destructive/40" : ""}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p
          className={`text-2xl font-semibold mt-1 ${highlight ? "text-destructive" : ""}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
