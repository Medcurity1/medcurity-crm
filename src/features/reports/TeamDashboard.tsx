import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency } from "@/lib/formatters";

/**
 * Team Dashboard — CRM-native port of the Python dashboard at
 * /Python Projects/Team Dashboard/dashboard_team_view.html.
 *
 * One pane, three sections (Sales / Marketing / Customer Success),
 * each KPI showing current value vs goal with a progress bar.
 *
 * All numbers come from the v_dashboard_metrics single-row view +
 * v_lost_customers_qtd for the lost-customers list. No background job
 * required — TanStack Query refetches on focus / 30s stale.
 */

const GOALS = {
  arr: 1_100_000,
  new_customers: 24,
  new_sales: 36_000,
  total_active_pipeline: 800_000,
  sql: 15,
  mql: 75,
  renewals_amount: 150_000,
  nrr_customer_pct: 90,
  nrr_dollar_pct: 90,
} as const;

interface MetricsRow {
  fiscal_period: string;
  fiscal_quarter_start: string;
  fiscal_quarter_end: string;
  current_arr: number | null;
  new_customers_qtd: number | null;
  new_customer_amount_qtd: number | null;
  renewals_qtd: number | null;
  renewals_amount_qtd: number | null;
  pipeline_count: number | null;
  pipeline_amount: number | null;
  pipeline_weighted_amount: number | null;
  lost_customers_qtd: number | null;
  lost_customer_amount_qtd: number | null;
  nrr_by_customer_legacy_pct: number | null;
  nrr_by_dollar_legacy_pct: number | null;
  nrr_by_customer_true_pct: number | null;
  nrr_by_dollar_true_pct: number | null;
  sql_qtd: number | null;
  mql_unique_qtd: number | null;
  computed_at: string;
}

interface LostCustomerRow {
  id: string;
  account_id: string | null;
  account_name: string;
  opportunity_name: string;
  amount: number | null;
  close_date: string;
}

function useDashboardMetrics() {
  return useQuery({
    queryKey: ["team-dashboard", "metrics"],
    queryFn: async (): Promise<MetricsRow | null> => {
      const { data, error } = await supabase
        .from("v_dashboard_metrics")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as MetricsRow | null;
    },
  });
}

function useLostCustomers() {
  return useQuery({
    queryKey: ["team-dashboard", "lost-customers"],
    queryFn: async (): Promise<LostCustomerRow[]> => {
      const { data, error } = await supabase
        .from("v_lost_customers_qtd")
        .select("id, account_id, account_name, opportunity_name, amount, close_date")
        .order("close_date", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as LostCustomerRow[];
    },
  });
}

export function TeamDashboard() {
  const { data: m, isLoading, error } = useDashboardMetrics();
  const { data: lost } = useLostCustomers();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        Couldn't load dashboard metrics: {(error as Error).message}
      </div>
    );
  }

  if (!m) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          No metrics available yet for the current quarter.
        </CardContent>
      </Card>
    );
  }

  const arr = num(m.current_arr);
  const newCustomers = num(m.new_customers_qtd);
  const newSales = num(m.new_customer_amount_qtd);
  const pipeline = num(m.pipeline_amount);
  const sql = num(m.sql_qtd);
  const mql = num(m.mql_unique_qtd);
  const renewalsAmt = num(m.renewals_amount_qtd);
  // Prefer "true" NRR; fall back to legacy if true is null.
  const nrrCust = num(m.nrr_by_customer_true_pct ?? m.nrr_by_customer_legacy_pct);
  const nrrDollar = num(m.nrr_by_dollar_true_pct ?? m.nrr_by_dollar_legacy_pct);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Team Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            Fiscal {m.fiscal_period} ({m.fiscal_quarter_start} → {m.fiscal_quarter_end}).
            Goals from the Team Dashboard config; live numbers from the CRM.
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Updated {new Date(m.computed_at).toLocaleString()}
        </span>
      </div>

      <Section title="Sales" tone="bg-blue-50 dark:bg-blue-950/30">
        <KpiCard
          label="ARR (rolling 365)"
          value={formatCurrency(arr)}
          progress={pct(arr, GOALS.arr)}
          goal={`Goal ${formatCurrency(GOALS.arr)}`}
        />
        <KpiCard
          label="New Customers QTD"
          value={String(newCustomers)}
          progress={pct(newCustomers, GOALS.new_customers)}
          goal={`Goal ${GOALS.new_customers}`}
        />
        <KpiCard
          label="New Sales QTD"
          value={formatCurrency(newSales)}
          progress={pct(newSales, GOALS.new_sales)}
          goal={`Goal ${formatCurrency(GOALS.new_sales)}`}
        />
        <KpiCard
          label="Active Pipeline"
          value={formatCurrency(pipeline)}
          progress={pct(pipeline, GOALS.total_active_pipeline)}
          goal={`Goal ${formatCurrency(GOALS.total_active_pipeline)}`}
          hint={`${m.pipeline_count ?? 0} open • weighted ${formatCurrency(num(m.pipeline_weighted_amount))}`}
        />
      </Section>

      <Section title="Marketing" tone="bg-violet-50 dark:bg-violet-950/30">
        <KpiCard
          label="SQL QTD"
          value={String(sql)}
          progress={pct(sql, GOALS.sql)}
          goal={`Goal ${GOALS.sql}`}
        />
        <KpiCard
          label="MQL QTD (unique)"
          value={String(mql)}
          progress={pct(mql, GOALS.mql)}
          goal={`Goal ${GOALS.mql}`}
          hint="Deduped across leads + contacts"
        />
      </Section>

      <Section title="Customer Success" tone="bg-emerald-50 dark:bg-emerald-950/30">
        <KpiCard
          label="Renewals QTD"
          value={formatCurrency(renewalsAmt)}
          progress={pct(renewalsAmt, GOALS.renewals_amount)}
          goal={`Goal ${formatCurrency(GOALS.renewals_amount)}`}
          hint={`${m.renewals_qtd ?? 0} closed`}
        />
        <KpiCard
          label="NRR by Customer"
          value={fmtPct(nrrCust)}
          progress={Math.min(100, (nrrCust / GOALS.nrr_customer_pct) * 100)}
          goal={`Goal ${GOALS.nrr_customer_pct}%`}
        />
        <KpiCard
          label="NRR by Dollar"
          value={fmtPct(nrrDollar)}
          progress={Math.min(100, (nrrDollar / GOALS.nrr_dollar_pct) * 100)}
          goal={`Goal ${GOALS.nrr_dollar_pct}%`}
        />
        <KpiCard
          label="Lost Customers QTD"
          value={String(num(m.lost_customers_qtd))}
          progress={0}
          goal={`${formatCurrency(num(m.lost_customer_amount_qtd))} churned`}
          danger
        />
      </Section>

      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Lost Customers — this quarter
        </h3>
        <Card>
          <CardContent className="p-0">
            {!lost || lost.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No lost customers yet this quarter.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="px-3 py-2 font-medium">Account</th>
                      <th className="px-3 py-2 font-medium">Opportunity</th>
                      <th className="px-3 py-2 font-medium">Close Date</th>
                      <th className="px-3 py-2 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lost.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="px-3 py-2">
                          {r.account_id ? (
                            <Link
                              to={`/accounts/${r.account_id}`}
                              className="text-primary hover:underline"
                            >
                              {r.account_name}
                            </Link>
                          ) : (
                            r.account_name
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Link
                            to={`/opportunities/${r.id}`}
                            className="text-primary hover:underline"
                          >
                            {r.opportunity_name}
                          </Link>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {new Date(r.close_date).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatCurrency(num(r.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3 text-[11px] text-muted-foreground space-y-1">
          <p>
            Source views: <code className="bg-muted px-1 py-0.5 rounded">v_dashboard_metrics</code>,{" "}
            <code className="bg-muted px-1 py-0.5 rounded">v_lost_customers_qtd</code>.
          </p>
          <p>
            Goals are currently hard-coded to match the Python dashboard
            (dashboard_goals.json). An admin-editable goals UI can come next.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function num(v: number | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pct(actual: number, goal: number): number {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, Math.max(0, (actual / goal) * 100));
}

function fmtPct(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 rounded-lg p-3 ${tone}`}>
        {children}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  progress,
  goal,
  hint,
  danger,
}: {
  label: string;
  value: string;
  progress: number;
  goal: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className={`text-2xl font-semibold mt-0.5 ${danger ? "text-destructive" : ""}`}>
            {value}
          </p>
        </div>
        {!danger && (
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">{goal}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
