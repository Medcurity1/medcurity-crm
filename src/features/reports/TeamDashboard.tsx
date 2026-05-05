import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Check, X, ExternalLink, Info, Plus, Trash2 } from "lucide-react";
import {
  ResponsiveContainer,
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
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/formatters";
import {
  loadGoals,
  saveGoals,
  STATUS_BG,
  type Goals,
  type GoalStatus,
} from "@/features/reports/dashboardGoals";
import {
  loadWidgets,
  saveWidgets,
  newDevItem,
  autoStatus,
  STATUS_TONES,
  type DashboardWidgets,
} from "@/features/reports/dashboardWidgets";
import {
  SegmentedLineChart,
  type SegmentPoint,
} from "@/features/reports/SegmentedLineChart";

/**
 * Team Dashboard — CRM-native port of the Python /Team Dashboard
 * (dashboard_team_view.html). Sections are ordered the same way
 * the Python dashboard renders them: Sales / Marketing / Customer
 * Success / Services / Development.
 *
 * Each KPI:
 *  - shows current value vs goal with a progress bar
 *  - has a status dot (red < 50%, yellow 50-89%, green ≥ 90% of goal)
 *  - has a Why-this-number hint so the user can validate the metric
 *  - links to a drill-down (filtered list / underlying view) so the
 *    raw data is one click away
 *
 * Goals are editable inline OR centrally via Admin → Dashboard Goals.
 * Both write to the same localStorage key (`team_dashboard_goals_v1`).
 */

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

/** Per-row data for the running-total charts. */
function useNewCustomersRows(quarterStart: string, quarterEnd: string) {
  return useQuery({
    queryKey: ["team-dashboard", "new-customers-rows", quarterStart, quarterEnd],
    enabled: !!quarterStart && !!quarterEnd,
    queryFn: async (): Promise<{ close_date: string; amount: number }[]> => {
      const { data, error } = await supabase
        .from("v_new_customers_qtd")
        .select("close_date, amount");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        close_date: r.close_date,
        amount: Number(r.amount) || 0,
      }));
    },
  });
}

function useRenewalsClosedRows(quarterStart: string, quarterEnd: string) {
  return useQuery({
    queryKey: ["team-dashboard", "renewals-closed-rows", quarterStart, quarterEnd],
    enabled: !!quarterStart && !!quarterEnd,
    queryFn: async (): Promise<{ close_date: string; amount: number }[]> => {
      const { data, error } = await supabase
        .from("v_renewals_qtd")
        .select("close_date, amount");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        close_date: r.close_date,
        amount: Number(r.amount) || 0,
      }));
    },
  });
}

function useSqlRowsQtd(quarterStart: string, quarterEnd: string) {
  return useQuery({
    queryKey: ["team-dashboard", "sql-rows", quarterStart, quarterEnd],
    enabled: !!quarterStart && !!quarterEnd,
    queryFn: async (): Promise<{ event_date: string }[]> => {
      const { data, error } = await supabase
        .from("v_sql_accounts")
        .select("sql_date")
        .gte("sql_date", quarterStart)
        .lte("sql_date", quarterEnd);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ event_date: r.sql_date }));
    },
  });
}

function useMqlRowsQtd(quarterStart: string, quarterEnd: string) {
  return useQuery({
    queryKey: ["team-dashboard", "mql-rows", quarterStart, quarterEnd],
    enabled: !!quarterStart && !!quarterEnd,
    queryFn: async (): Promise<{ event_date: string }[]> => {
      // Pull from both leads + contacts deduped by date count (we just need
      // dates — uniqueness across leads/contacts already handled in the
      // dashboard's `mql_unique_qtd` aggregate; for the running-total chart
      // a simple union of dates is enough for the visual.)
      const [{ data: lRows, error: lErr }, { data: cRows, error: cErr }] = await Promise.all([
        supabase
          .from("leads")
          .select("mql_date")
          .not("mql_date", "is", null)
          .gte("mql_date", quarterStart)
          .lte("mql_date", quarterEnd)
          .is("archived_at", null),
        supabase
          .from("contacts")
          .select("mql_date")
          .not("mql_date", "is", null)
          .gte("mql_date", quarterStart)
          .lte("mql_date", quarterEnd)
          .is("archived_at", null),
      ]);
      if (lErr) throw lErr;
      if (cErr) throw cErr;
      const all = [
        ...(lRows ?? []).map((r: any) => ({ event_date: r.mql_date })),
        ...(cRows ?? []).map((r: any) => ({ event_date: r.mql_date })),
      ];
      return all;
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

/**
 * Dashboard "owner" = the one user allowed to edit goals, the manual
 * widgets (quote, QTD billing override), and the dev milestones. Other
 * admins / users get the read-only team-view experience.
 *
 * Brayden's call-out: regular admins should see the dashboard but not be
 * able to mutate goals. Gate by email so role escalation in user_profiles
 * doesn't accidentally hand someone else editing rights.
 */
const DASHBOARD_OWNER_EMAIL = "braydenf@medcurity.com";

export function TeamDashboard() {
  const { profile, user } = useAuth();
  const isOwner =
    (profile?.role === "admin" || profile?.role === "super_admin") &&
    user?.email === DASHBOARD_OWNER_EMAIL;

  const [goals, setGoals] = useState<Goals>(() => loadGoals());
  useEffect(() => {
    saveGoals(goals);
  }, [goals]);

  // Pick up goals saved from Admin → Dashboard Goals (cross-tab + same-tab).
  useEffect(() => {
    function refresh() {
      setGoals(loadGoals());
    }
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // Manual widgets (Most Recent Quote, QTD Billing override, Dev items)
  const [widgets, setWidgets] = useState<DashboardWidgets>(() => loadWidgets());
  useEffect(() => {
    saveWidgets(widgets);
  }, [widgets]);

  const { data: m, isLoading, error } = useDashboardMetrics();
  const { data: lost } = useLostCustomers();
  const { data: arrTrend } = useArrTrend();
  const { data: renewalsDue } = useRenewalsDueThisQuarter(
    m?.fiscal_quarter_start ?? "",
    m?.fiscal_quarter_end ?? "",
  );
  const { data: newCustomerRows } = useNewCustomersRows(
    m?.fiscal_quarter_start ?? "",
    m?.fiscal_quarter_end ?? "",
  );
  const { data: renewalsClosedRows } = useRenewalsClosedRows(
    m?.fiscal_quarter_start ?? "",
    m?.fiscal_quarter_end ?? "",
  );
  const { data: sqlRows } = useSqlRowsQtd(
    m?.fiscal_quarter_start ?? "",
    m?.fiscal_quarter_end ?? "",
  );
  const { data: mqlRows } = useMqlRowsQtd(
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

  // Running-total point arrays for the segmented line charts.
  const qStart = m?.fiscal_quarter_start ?? "";
  const qEnd = m?.fiscal_quarter_end ?? "";

  const newCustomersRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (newCustomerRows ?? []).map((r) => ({ date: r.close_date, value: 1 })),
        qStart,
        qEnd,
        goals.new_customers,
      ),
    [newCustomerRows, qStart, qEnd, goals.new_customers],
  );

  const newSalesRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (newCustomerRows ?? []).map((r) => ({ date: r.close_date, value: r.amount })),
        qStart,
        qEnd,
        goals.new_sales,
      ),
    [newCustomerRows, qStart, qEnd, goals.new_sales],
  );

  const renewalsClosedRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (renewalsClosedRows ?? []).map((r) => ({ date: r.close_date, value: r.amount })),
        qStart,
        qEnd,
        goals.renewals_amount,
      ),
    [renewalsClosedRows, qStart, qEnd, goals.renewals_amount],
  );

  const sqlRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (sqlRows ?? []).map((r) => ({ date: r.event_date, value: 1 })),
        qStart,
        qEnd,
        goals.sql,
      ),
    [sqlRows, qStart, qEnd, goals.sql],
  );

  const mqlRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (mqlRows ?? []).map((r) => ({ date: r.event_date, value: 1 })),
        qStart,
        qEnd,
        goals.mql,
      ),
    [mqlRows, qStart, qEnd, goals.mql],
  );

  // ARR trend → SegmentPoint format. Goal is constant across the trend
  // (one ARR target for the year), so each segment gets colored vs
  // that single threshold and the dashed reference line is flat.
  const arrPoints = useMemo<SegmentPoint[]>(() => {
    if (!arrTrend) return [];
    return arrTrend.slice(-12).map((p) => ({
      label: p.fiscal_period,
      actual: Number(p.trailing_365_arr) || 0,
      goal: goals.arr,
    }));
  }, [arrTrend, goals.arr]);

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
            {isOwner ? " You can edit goals via the pencil icons." : ""}
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
          editable={isOwner}
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
          editable={isOwner}
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
          editable={isOwner}
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
          editable={isOwner}
          hint={`${m.pipeline_count ?? 0} open • weighted ${formatCurrency(num(m.pipeline_weighted_amount))} (v_active_pipeline)`}
          to="/opportunities"
        />
      </Section>

      {arrPoints.length > 0 && (
        <ChartCard
          title={`ARR Trend (rolling 365) — goal ${formatCurrency(goals.arr)}`}
        >
          <ChartLegend />
          <SegmentedLineChart
            data={arrPoints}
            yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            tooltipFormatter={(v) => formatCurrency(v)}
          />
        </ChartCard>
      )}

      {/* Sales running totals (bottom of Sales section) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {newCustomersRunning.length > 1 && (
          <ChartCard title={`New Customers — running total (goal ${goals.new_customers})`}>
            <ChartLegend />
            <SegmentedLineChart
              data={newCustomersRunning}
              yFormatter={(v) => String(Math.round(v))}
              tooltipFormatter={(v) => String(Math.round(v))}
              height={200}
            />
          </ChartCard>
        )}
        {newSalesRunning.length > 1 && (
          <ChartCard title={`New Sales $ — running total (goal ${formatCurrency(goals.new_sales)})`}>
            <ChartLegend />
            <SegmentedLineChart
              data={newSalesRunning}
              yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              tooltipFormatter={(v) => formatCurrency(v)}
              height={200}
            />
          </ChartCard>
        )}
      </div>

      {/* ----- Marketing ----- */}
      <Section title="Marketing" tone="bg-violet-50 dark:bg-violet-950/30">
        <KpiCard
          label="SQL QTD"
          value={String(sqlCount)}
          progress={pct(sqlCount, goals.sql)}
          goal={goals.sql}
          formatGoal={(v) => String(v)}
          onGoalChange={(v) => setGoals((g) => ({ ...g, sql: v }))}
          editable={isOwner}
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
          editable={isOwner}
          hint="Deduped MQL across leads + contacts in current quarter."
          to="/leads?qualification=mql"
        />
      </Section>

      {/* Marketing running totals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {sqlRunning.length > 1 && (
          <ChartCard title={`SQL — running total (goal ${goals.sql})`}>
            <ChartLegend />
            <SegmentedLineChart
              data={sqlRunning}
              yFormatter={(v) => String(Math.round(v))}
              tooltipFormatter={(v) => String(Math.round(v))}
              height={200}
            />
          </ChartCard>
        )}
        {mqlRunning.length > 1 && (
          <ChartCard title={`MQL — running total (goal ${goals.mql})`}>
            <ChartLegend />
            <SegmentedLineChart
              data={mqlRunning}
              yFormatter={(v) => String(Math.round(v))}
              tooltipFormatter={(v) => String(Math.round(v))}
              height={200}
            />
          </ChartCard>
        )}
      </div>

      {/* ----- Customer Success ----- */}
      <Section title="Customer Success" tone="bg-emerald-50 dark:bg-emerald-950/30">
        <KpiCard
          label="Renewals Closed QTD"
          value={formatCurrency(renewalsClosedAmt)}
          progress={pct(renewalsClosedAmt, goals.renewals_amount)}
          goal={goals.renewals_amount}
          formatGoal={formatCurrency}
          onGoalChange={(v) => setGoals((g) => ({ ...g, renewals_amount: v }))}
          editable={isOwner}
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
          editable={isOwner}
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
          editable={isOwner}
          hint="(starting customers − churn QTD) / starting customers. 100% means zero churn this quarter so far."
        />
        <KpiCard
          label="NRR by Dollar"
          value={fmtPct(nrrDollar)}
          progress={Math.min(100, (nrrDollar / goals.nrr_dollar_pct) * 100)}
          goal={goals.nrr_dollar_pct}
          formatGoal={(v) => `${v}%`}
          onGoalChange={(v) => setGoals((g) => ({ ...g, nrr_dollar_pct: v }))}
          editable={isOwner}
          hint="(starting ARR − churn $ QTD) / starting ARR."
        />
        <KpiCard
          label={
            widgets.qtd_billing_actual != null
              ? "QTD Billing (manual)"
              : "QTD Billing Goal"
          }
          value={formatCurrency(
            widgets.qtd_billing_actual ??
              num(m.new_customer_amount_qtd) + renewalsClosedAmt,
          )}
          progress={pct(
            widgets.qtd_billing_actual ??
              num(m.new_customer_amount_qtd) + renewalsClosedAmt,
            goals.qtd_billing,
          )}
          goal={goals.qtd_billing}
          formatGoal={formatCurrency}
          onGoalChange={(v) => setGoals((g) => ({ ...g, qtd_billing: v }))}
          editable={isOwner}
          hint={
            widgets.qtd_billing_actual != null
              ? "Using manual override. Clear it below to fall back to New Sales + Renewals."
              : "New Sales $ QTD + Renewals Closed $ QTD. Set a manual override below if billing system says otherwise."
          }
        />
      </Section>

      {/* QTD Billing manual override (owner-only edit, visible to all) */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground font-medium">
            QTD Billing actual override:
          </p>
          {isOwner ? (
            <>
              <Input
                type="number"
                value={widgets.qtd_billing_actual ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const parsed = raw === "" ? null : Number(raw);
                  setWidgets((w) => ({
                    ...w,
                    qtd_billing_actual:
                      parsed === null || !Number.isFinite(parsed) ? null : parsed,
                  }));
                }}
                placeholder="Auto-compute"
                className="h-8 w-40 text-sm"
              />
              {widgets.qtd_billing_actual != null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setWidgets((w) => ({ ...w, qtd_billing_actual: null }))
                  }
                >
                  Clear override
                </Button>
              )}
            </>
          ) : (
            <span className="text-sm">
              {widgets.qtd_billing_actual != null
                ? formatCurrency(widgets.qtd_billing_actual)
                : "(none — using auto-computed value)"}
            </span>
          )}
        </CardContent>
      </Card>

      {/* Most Recent Quote — manually edited on the dashboard */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-muted-foreground">
              Most Recent Quote
              {widgets.quote_rating && (
                <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                  {widgets.quote_rating}
                </span>
              )}
            </h4>
            {!isOwner && !widgets.quote_text && (
              <span className="text-[11px] text-muted-foreground italic">
                No quote yet.
              </span>
            )}
          </div>
          {isOwner ? (
            <div className="space-y-2">
              <Textarea
                value={widgets.quote_text}
                onChange={(e) =>
                  setWidgets((w) => ({ ...w, quote_text: e.target.value }))
                }
                placeholder="Customer quote…"
                className="min-h-[80px] text-sm"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  value={widgets.quote_author}
                  onChange={(e) =>
                    setWidgets((w) => ({ ...w, quote_author: e.target.value }))
                  }
                  placeholder="Attribution (e.g., Holli Kivett @ Northwest Women's Clinic)"
                  className="h-8 text-sm"
                />
                <Input
                  value={widgets.quote_rating}
                  onChange={(e) =>
                    setWidgets((w) => ({ ...w, quote_rating: e.target.value }))
                  }
                  placeholder="Rating (e.g., 10/10)"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          ) : widgets.quote_text ? (
            <div className="space-y-1">
              <blockquote className="text-sm italic border-l-2 pl-3 border-emerald-500/40">
                "{widgets.quote_text}"
              </blockquote>
              {widgets.quote_author && (
                <p className="text-xs text-muted-foreground text-right">
                  — {widgets.quote_author}
                </p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Renewals closed running-total */}
      {renewalsClosedRunning.length > 1 && (
        <ChartCard title={`Renewals Closed $ — running total (goal ${formatCurrency(goals.renewals_amount)})`}>
          <ChartLegend />
          <SegmentedLineChart
            data={renewalsClosedRunning}
            yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
            tooltipFormatter={(v) => formatCurrency(v)}
            height={220}
          />
        </ChartCard>
      )}

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

      {/* ----- Development (manual line items) ----- */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Development
        </h3>
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Manually-tracked dev projects. Status auto-derives from completion
                date + checkbox.
              </p>
              {isOwner && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setWidgets((w) => ({
                      ...w,
                      dev_items: [...w.dev_items, newDevItem()],
                    }))
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add row
                </Button>
              )}
            </div>
            {widgets.dev_items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No dev items yet. {isOwner ? "Click 'Add row' to track one." : ""}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="px-2 py-2 font-medium">Project</th>
                      <th className="px-2 py-2 font-medium">Completion Date</th>
                      <th className="px-2 py-2 font-medium text-center">Complete</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      {isOwner && <th className="px-2 py-2 w-10" />}
                    </tr>
                  </thead>
                  <tbody>
                    {widgets.dev_items.map((item) => {
                      const status = autoStatus(item);
                      const tone =
                        STATUS_TONES[status] ??
                        "bg-muted text-muted-foreground";
                      return (
                        <tr key={item.id} className="border-t">
                          <td className="px-2 py-1.5">
                            {isOwner ? (
                              <Input
                                value={item.project}
                                onChange={(e) =>
                                  setWidgets((w) => ({
                                    ...w,
                                    dev_items: w.dev_items.map((d) =>
                                      d.id === item.id
                                        ? { ...d, project: e.target.value }
                                        : d,
                                    ),
                                  }))
                                }
                                className="h-7 text-sm"
                                placeholder="Project name"
                              />
                            ) : (
                              <span>{item.project || "—"}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {isOwner ? (
                              <Input
                                type="date"
                                value={item.completion_date}
                                onChange={(e) =>
                                  setWidgets((w) => ({
                                    ...w,
                                    dev_items: w.dev_items.map((d) =>
                                      d.id === item.id
                                        ? { ...d, completion_date: e.target.value }
                                        : d,
                                    ),
                                  }))
                                }
                                className="h-7 text-sm"
                              />
                            ) : (
                              <span>{item.completion_date}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={item.complete}
                              disabled={!isOwner}
                              onChange={(e) =>
                                setWidgets((w) => ({
                                  ...w,
                                  dev_items: w.dev_items.map((d) =>
                                    d.id === item.id
                                      ? { ...d, complete: e.target.checked }
                                      : d,
                                  ),
                                }))
                              }
                              className="h-4 w-4 cursor-pointer"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${tone}`}
                            >
                              {status}
                            </span>
                          </td>
                          {isOwner && (
                            <td className="px-2 py-1.5 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() =>
                                  setWidgets((w) => ({
                                    ...w,
                                    dev_items: w.dev_items.filter(
                                      (d) => d.id !== item.id,
                                    ),
                                  }))
                                }
                                title="Delete row"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
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

/**
 * Build a MONTHLY running-total point series for a charted KPI within
 * the current fiscal quarter — produces 3 points (M1, M2, M3), matching
 * the format Codex's Python dashboard uses (`chart_data: [{month, label,
 * value}, ...]`). Brayden specifically asked for monthly buckets, not
 * weekly.
 *
 * `actual` at month N = cumulative total of events through end-of-month-N.
 * `goal` at month N = proportional pace, i.e. quarter_goal * (N/3) by
 * default. (Per-month overrides come from the per-quarter goals store
 * once that's wired in — for now we use even thirds.)
 */
function buildRunningTotal(
  events: { date: string; value: number }[],
  quarterStart: string,
  quarterEnd: string,
  totalGoal: number,
): SegmentPoint[] {
  if (!quarterStart || !quarterEnd) return [];
  const start = new Date(quarterStart);
  const end = new Date(quarterEnd);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return [];
  }

  const sorted = [...events]
    .filter((e) => e.date >= quarterStart && e.date <= quarterEnd)
    .sort((a, b) => a.date.localeCompare(b.date));

  // The 3 calendar months of the current fiscal quarter. Use the start
  // month as M1 — this matches Codex's labels (e.g., Q1 → Jan/Feb/Mar).
  const points: SegmentPoint[] = [];
  for (let i = 0; i < 3; i++) {
    const monthStart = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, 0);
    // Don't extend past quarter end (e.g., short quarters / off-by-one).
    const cap = monthEnd > end ? end : monthEnd;
    const capStr = cap.toISOString().slice(0, 10);

    const cumulative = sorted
      .filter((e) => e.date <= capStr)
      .reduce((s, e) => s + e.value, 0);

    points.push({
      label: monthStart.toLocaleString("en-US", { month: "short" }),
      actual: cumulative,
      goal: totalGoal * ((i + 1) / 3),
    });
  }
  return points;
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

/** Legend explaining the R/Y/G segment coloring on the running-total charts. */
function ChartLegend() {
  return (
    <p className="text-[11px] text-muted-foreground mb-2">
      Segments colored vs proportional goal:{" "}
      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle mr-1" />
      ≥ 90%{" "}
      <span className="inline-block h-2 w-2 rounded-full bg-amber-500 align-middle ml-2 mr-1" />
      50–89%{" "}
      <span className="inline-block h-2 w-2 rounded-full bg-red-500 align-middle ml-2 mr-1" />
      &lt; 50% — dashed line is the goal pace.
    </p>
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

  // Approximate "actual" from progress so we can color the dot. progress
  // is clamped to 100 by the caller, so for >100% of goal we show green.
  const status: GoalStatus =
    goal > 0 && progress >= 90
      ? "green"
      : goal > 0 && progress >= 50
      ? "yellow"
      : goal > 0
      ? "red"
      : "neutral";
  const dotClass = STATUS_BG[status];
  const barClass =
    status === "green"
      ? "bg-emerald-500"
      : status === "yellow"
      ? "bg-amber-500"
      : status === "red"
      ? "bg-red-500"
      : "bg-primary";

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div>
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                aria-hidden="true"
                title={
                  status === "green"
                    ? "≥ 90% of goal"
                    : status === "yellow"
                    ? "50–89% of goal"
                    : status === "red"
                    ? "< 50% of goal"
                    : "No goal set"
                }
                className={`inline-block h-2 w-2 rounded-full ${dotClass} shrink-0`}
              />
              <p className="text-xs text-muted-foreground font-medium truncate">
                {label}
              </p>
            </div>
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
            className={`h-full transition-all ${barClass}`}
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
