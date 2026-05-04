import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Check, X, ExternalLink, Info } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/formatters";

/**
 * Team Dashboard — CRM-native port of the Python /Team Dashboard
 * (dashboard_team_view.html). Sections are ordered the same way
 * the Python dashboard renders them: Sales / Marketing / Customer
 * Success / Services / Development.
 *
 * Each KPI:
 *  - shows current value vs goal with a progress bar
 *  - has a Why-this-number hint so the user can validate the metric
 *  - links to a drill-down (filtered list / underlying view) so the
 *    raw data is one click away
 *
 * Goals are editable inline by admins (persisted to localStorage for
 * now — DB-backed goals/history can come next).
 */

const GOALS_LS_KEY = "team_dashboard_goals_v1";

interface Goals {
  arr: number;
  new_customers: number;
  new_sales: number;
  total_active_pipeline: number;
  sql: number;
  mql: number;
  renewals_amount: number;
  nrr_customer_pct: number;
  nrr_dollar_pct: number;
  qtd_billing: number;
}

const DEFAULT_GOALS: Goals = {
  arr: 1_100_000,
  new_customers: 24,
  new_sales: 36_000,
  total_active_pipeline: 800_000,
  sql: 15,
  mql: 75,
  renewals_amount: 150_000,
  nrr_customer_pct: 90,
  nrr_dollar_pct: 90,
  qtd_billing: 350_000,
};

function loadGoals(): Goals {
  if (typeof window === "undefined") return DEFAULT_GOALS;
  try {
    const raw = window.localStorage.getItem(GOALS_LS_KEY);
    if (!raw) return DEFAULT_GOALS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_GOALS, ...parsed };
  } catch {
    return DEFAULT_GOALS;
  }
}

function saveGoals(g: Goals) {
  try {
    window.localStorage.setItem(GOALS_LS_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

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
  starting_customers: number | null;
  starting_arr: number | null;
  churn_customers_qtd: number | null;
  churn_amount_qtd: number | null;
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

interface ArrPoint {
  month_start: string;
  fiscal_period: string;
  closed_won_amount: number;
  trailing_365_arr: number;
}

interface RenewalDueRow {
  id: string;
  amount: number;
  contract_end_date: string;
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

function useArrTrend() {
  return useQuery({
    queryKey: ["team-dashboard", "arr-trend"],
    queryFn: async (): Promise<ArrPoint[]> => {
      const { data, error } = await supabase
        .from("v_arr_rolling_365")
        .select("month_start, fiscal_period, closed_won_amount, trailing_365_arr")
        .order("month_start", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ArrPoint[];
    },
  });
}

/** Renewals "due this quarter" — closed-won opps whose contract_end_date
 * sits inside the current calendar quarter. Different from the metrics
 * view's `renewals_amount_qtd`, which is closed-won renewals ALREADY
 * won this quarter. Both numbers matter to the team. */
function useRenewalsDueThisQuarter(quarterStart: string, quarterEnd: string) {
  return useQuery({
    queryKey: ["team-dashboard", "renewals-due", quarterStart, quarterEnd],
    enabled: !!quarterStart && !!quarterEnd,
    queryFn: async (): Promise<RenewalDueRow[]> => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("id, amount, contract_end_date")
        .is("archived_at", null)
        .eq("stage", "closed_won")
        .not("contract_end_date", "is", null)
        .gte("contract_end_date", quarterStart)
        .lte("contract_end_date", quarterEnd);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        amount: Number(r.amount) || 0,
        contract_end_date: r.contract_end_date,
      }));
    },
  });
}

export function TeamDashboard() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";

  const [goals, setGoals] = useState<Goals>(() => loadGoals());
  useEffect(() => {
    saveGoals(goals);
  }, [goals]);

  const { data: m, isLoading, error } = useDashboardMetrics();
  const { data: lost } = useLostCustomers();
  const { data: arrTrend } = useArrTrend();
  const { data: renewalsDue } = useRenewalsDueThisQuarter(
    m?.fiscal_quarter_start ?? "",
    m?.fiscal_quarter_end ?? "",
  );

  // Per-month breakdown of renewals due in the current quarter.
  const renewalsDueByMonth = useMemo(() => {
    if (!m || !renewalsDue) return [] as { label: string; total: number; count: number }[];
    const start = new Date(m.fiscal_quarter_start);
    const months = [0, 1, 2].map((i) => {
      const ms = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const me = new Date(start.getFullYear(), start.getMonth() + i + 1, 0);
      return {
        label: ms.toLocaleString("en-US", { month: "short", year: "numeric" }),
        start: ms,
        end: me,
      };
    });
    return months.map(({ label, start: ms, end }) => {
      const inWindow = renewalsDue.filter((r) => {
        const d = new Date(r.contract_end_date);
        return d >= ms && d <= end;
      });
      return {
        label,
        count: inWindow.length,
        total: inWindow.reduce((s, r) => s + r.amount, 0),
      };
    });
  }, [m, renewalsDue]);

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
  const sqlCount = num(m.sql_qtd);
  const mql = num(m.mql_unique_qtd);
  const renewalsClosedAmt = num(m.renewals_amount_qtd);
  const renewalsDueAmt = (renewalsDue ?? []).reduce((s, r) => s + r.amount, 0);
  const renewalsDueCount = (renewalsDue ?? []).length;
  const nrrCust = num(m.nrr_by_customer_true_pct ?? m.nrr_by_customer_legacy_pct);
  const nrrDollar = num(m.nrr_by_dollar_true_pct ?? m.nrr_by_dollar_legacy_pct);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Team Dashboard</h2>
          <p className="text-xs text-muted-foreground">
            Fiscal {m.fiscal_period} ({m.fiscal_quarter_start} → {m.fiscal_quarter_end}).
            Click any KPI to drill into the underlying records.
            {isAdmin ? " Admins can edit goals via the pencil." : ""}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Updated {new Date(m.computed_at).toLocaleString()}
        </span>
      </div>

      {/* ----- Sales ----- */}
      <Section title="Sales" tone="bg-blue-50 dark:bg-blue-950/30">
        <KpiCard
          label="ARR (rolling 365)"
          value={formatCurrency(arr)}
          progress={pct(arr, goals.arr)}
          goal={goals.arr}
          formatGoal={formatCurrency}
          onGoalChange={(v) => setGoals((g) => ({ ...g, arr: v }))}
          editable={isAdmin}
          hint="Sum of closed-won amount in the trailing 365 days (v_arr_rolling_365)."
          to="/reports?tab=standard"
        />
        <KpiCard
          label="New Customers QTD"
          value={String(newCustomers)}
          progress={pct(newCustomers, goals.new_customers)}
          goal={goals.new_customers}
          formatGoal={(v) => String(v)}
          onGoalChange={(v) => setGoals((g) => ({ ...g, new_customers: v }))}
          editable={isAdmin}
          hint="Closed-won opps with kind='new_business' & close_date in current fiscal quarter (v_new_customers_qtd)."
          to="/reports?tab=standard"
        />
        <KpiCard
          label="New Sales $ QTD"
          value={formatCurrency(newSales)}
          progress={pct(newSales, goals.new_sales)}
          goal={goals.new_sales}
          formatGoal={formatCurrency}
          onGoalChange={(v) => setGoals((g) => ({ ...g, new_sales: v }))}
          editable={isAdmin}
          hint="Sum of amount on rows in v_new_customers_qtd."
          to="/reports?tab=standard"
        />
        <KpiCard
          label="Active Pipeline"
          value={formatCurrency(pipeline)}
          progress={pct(pipeline, goals.total_active_pipeline)}
          goal={goals.total_active_pipeline}
          formatGoal={formatCurrency}
          onGoalChange={(v) => setGoals((g) => ({ ...g, total_active_pipeline: v }))}
          editable={isAdmin}
          hint={`${m.pipeline_count ?? 0} open • weighted ${formatCurrency(num(m.pipeline_weighted_amount))} (v_active_pipeline)`}
          to="/opportunities"
        />
      </Section>

      {arrTrend && arrTrend.length > 0 && (
        <ChartCard title="ARR Trend (rolling 365)">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={arrTrend.slice(-18)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="fiscal_period" tick={{ fontSize: 10 }} />
              <YAxis
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10 }}
              />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Line
                type="monotone"
                dataKey="trailing_365_arr"
                stroke="#2563eb"
                dot={false}
                strokeWidth={2}
                name="Trailing 365 ARR"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ----- Marketing ----- */}
      <Section title="Marketing" tone="bg-violet-50 dark:bg-violet-950/30">
        <KpiCard
          label="SQL QTD"
          value={String(sqlCount)}
          progress={pct(sqlCount, goals.sql)}
          goal={goals.sql}
          formatGoal={(v) => String(v)}
          onGoalChange={(v) => setGoals((g) => ({ ...g, sql: v }))}
          editable={isAdmin}
          hint="Accounts with a contact whose sql_date falls in current quarter (v_sql_accounts)."
          to="/contacts?qualification=sql"
        />
        <KpiCard
          label="MQL QTD (unique)"
          value={String(mql)}
          progress={pct(mql, goals.mql)}
          goal={goals.mql}
          formatGoal={(v) => String(v)}
          onGoalChange={(v) => setGoals((g) => ({ ...g, mql: v }))}
          editable={isAdmin}
          hint="Deduped MQL across leads + contacts in current quarter."
          to="/leads?qualification=mql"
        />
      </Section>

      {/* ----- Customer Success ----- */}
      <Section title="Customer Success" tone="bg-emerald-50 dark:bg-emerald-950/30">
        <KpiCard
          label="Renewals Closed QTD"
          value={formatCurrency(renewalsClosedAmt)}
          progress={pct(renewalsClosedAmt, goals.renewals_amount)}
          goal={goals.renewals_amount}
          formatGoal={formatCurrency}
          onGoalChange={(v) => setGoals((g) => ({ ...g, renewals_amount: v }))}
          editable={isAdmin}
          hint={`${m.renewals_qtd ?? 0} renewal-kind closed-won w/ close_date this quarter (v_renewals_qtd, excludes EHR Implementation).`}
          to="/renewals?tab=closed-won&preset=this-quarter"
        />
        <KpiCard
          label="Renewals Due This Q"
          value={formatCurrency(renewalsDueAmt)}
          progress={pct(renewalsDueAmt, goals.renewals_amount)}
          goal={goals.renewals_amount}
          formatGoal={formatCurrency}
          onGoalChange={(v) => setGoals((g) => ({ ...g, renewals_amount: v }))}
          editable={isAdmin}
          hint={`${renewalsDueCount} closed-won opps with contract_end_date in this quarter — at-risk ARR.`}
          to="/renewals?preset=this-quarter"
        />
        <KpiCard
          label="NRR by Customer"
          value={fmtPct(nrrCust)}
          progress={Math.min(100, (nrrCust / goals.nrr_customer_pct) * 100)}
          goal={goals.nrr_customer_pct}
          formatGoal={(v) => `${v}%`}
          onGoalChange={(v) => setGoals((g) => ({ ...g, nrr_customer_pct: v }))}
          editable={isAdmin}
          hint="(starting customers − churn QTD) / starting customers. 100% means zero churn this quarter so far."
        />
        <KpiCard
          label="NRR by Dollar"
          value={fmtPct(nrrDollar)}
          progress={Math.min(100, (nrrDollar / goals.nrr_dollar_pct) * 100)}
          goal={goals.nrr_dollar_pct}
          formatGoal={(v) => `${v}%`}
          onGoalChange={(v) => setGoals((g) => ({ ...g, nrr_dollar_pct: v }))}
          editable={isAdmin}
          hint="(starting ARR − churn $ QTD) / starting ARR."
        />
      </Section>

      {/* Per-month breakdown of renewals due in current quarter */}
      {renewalsDueByMonth.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Renewals due — by month of current quarter
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {renewalsDueByMonth.map((mb) => (
              <Card key={mb.label}>
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground font-medium">{mb.label}</p>
                  <p className="text-xl font-semibold mt-0.5">{formatCurrency(mb.total)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {mb.count} renewal{mb.count === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Lost customers list */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Lost Customers — this quarter ({num(m.lost_customers_qtd)} •{" "}
          {formatCurrency(num(m.lost_customer_amount_qtd))})
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

      {/* Renewals Closed by month — last 6 months */}
      {arrTrend && arrTrend.length > 0 && (
        <ChartCard title="Closed-Won by Month (last 12)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={arrTrend.slice(-12)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="fiscal_period" tick={{ fontSize: 10 }} />
              <YAxis
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                tick={{ fontSize: 10 }}
              />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="closed_won_amount" fill="#10b981" name="Closed-Won $" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ----- Services (ClickUp) ----- */}
      <Section title="Services" tone="bg-amber-50 dark:bg-amber-950/30">
        <PlaceholderCard
          label="Project Status Breakdown"
          message="ClickUp integration not yet wired. The Python dashboard pulls Project Status from ClickUp; the CRM doesn't have that data source yet."
          cta="ClickUp connector pending"
        />
        <PlaceholderCard
          label="Active Projects"
          message="Awaiting ClickUp connector."
          cta="—"
        />
      </Section>

      {/* ----- Development ----- */}
      <Section title="Development" tone="bg-rose-50 dark:bg-rose-950/30">
        <KpiCard
          label="QTD Billing Goal"
          value={formatCurrency(num(m.new_customer_amount_qtd) + renewalsClosedAmt)}
          progress={pct(
            num(m.new_customer_amount_qtd) + renewalsClosedAmt,
            goals.qtd_billing,
          )}
          goal={goals.qtd_billing}
          formatGoal={formatCurrency}
          onGoalChange={(v) => setGoals((g) => ({ ...g, qtd_billing: v }))}
          editable={isAdmin}
          hint="New Sales $ QTD + Renewals Closed $ QTD. Replace with billing system data when wired."
        />
        <PlaceholderCard
          label="Production Health"
          message="No production-data source connected yet."
          cta="Connector pending"
        />
      </Section>

      <Card>
        <CardContent className="p-3 text-[11px] text-muted-foreground space-y-1">
          <p>
            Sources:{" "}
            <code className="bg-muted px-1 py-0.5 rounded">v_dashboard_metrics</code>
            ,{" "}
            <code className="bg-muted px-1 py-0.5 rounded">v_lost_customers_qtd</code>
            ,{" "}
            <code className="bg-muted px-1 py-0.5 rounded">v_arr_rolling_365</code>
            , and a direct opportunities query for "Renewals Due This Q".
          </p>
          <p>
            Goals stored in your browser (localStorage). Historical snapshots,
            ClickUp / Production connectors, and DB-backed goals can come next.
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

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <h4 className="text-sm font-medium text-muted-foreground mb-2">{title}</h4>
        {children}
      </CardContent>
    </Card>
  );
}

function KpiCard({
  label,
  value,
  progress,
  goal,
  formatGoal,
  onGoalChange,
  editable,
  hint,
  to,
}: {
  label: string;
  value: string;
  progress: number;
  goal: number;
  formatGoal: (v: number) => string;
  onGoalChange: (v: number) => void;
  editable: boolean;
  hint?: string;
  to?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(goal));

  function commit() {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed >= 0) onGoalChange(parsed);
    setEditing(false);
  }

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div>
          <div className="flex items-center justify-between gap-1">
            <p className="text-xs text-muted-foreground font-medium">{label}</p>
            {to && (
              <Link
                to={to}
                className="text-muted-foreground hover:text-primary"
                title="Drill into source data"
              >
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
          <p className="text-2xl font-semibold mt-0.5">{value}</p>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-1">
          {editing ? (
            <div className="flex items-center gap-1 flex-1">
              <Input
                type="number"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-6 text-[11px] px-1.5"
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") {
                    setDraft(String(goal));
                    setEditing(false);
                  }
                }}
                autoFocus
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={commit}
              >
                <Check className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                onClick={() => {
                  setDraft(String(goal));
                  setEditing(false);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">
                Goal {formatGoal(goal)}
              </p>
              {editable && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setDraft(String(goal));
                    setEditing(true);
                  }}
                  title="Edit goal"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </>
          )}
        </div>
        {hint && (
          <p className="text-[10px] text-muted-foreground flex items-start gap-1">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{hint}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PlaceholderCard({
  label,
  message,
  cta,
}: {
  label: string;
  message: string;
  cta: string;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="p-3 space-y-1">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-sm">{message}</p>
        <p className="text-[10px] text-muted-foreground italic">{cta}</p>
      </CardContent>
    </Card>
  );
}
