import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Pencil,
  Check,
  X,
  ExternalLink,
  Info,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Save,
  RotateCcw,
  Lock,
  LockOpen,
  Printer,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/formatters";
import {
  STATUS_BG,
  type Goals,
  type GoalStatus,
} from "@/features/reports/dashboardGoals";
import {
  loadWidgets,
  saveWidgets,
  type DashboardWidgets,
} from "@/features/reports/dashboardWidgets";
import {
  loadMilestones,
  saveMilestones,
  newMilestone,
  deriveStatus,
  STATUS_TONES,
  type Milestone,
} from "@/features/reports/dashboardMilestones";
import {
  METRICS,
  METRIC_KEYS,
  DEFAULT_GOALS,
  getQuarterGoals,
  saveQuarterGoals,
  resetQuarterToDefaults,
  isQuarterLocked,
  setQuarterLocked,
  listSavedQuarters,
  quarterLabelFromDate,
  quarterMonths,
  parseQuarterLabel,
  currentMonthIndex,
  fillMonthGoals,
  type QuarterGoals,
  type MetricKey,
  type MetricMeta,
  type MetricGoal,
} from "@/features/reports/dashboardGoalsByQuarter";
import {
  SegmentedLineChart,
  type SegmentPoint,
} from "@/features/reports/SegmentedLineChart";
import {
  captureWeeklySnapshotIfNeeded,
  loadSnapshots,
  deleteSnapshot,
  SNAPSHOT_METRIC_LABELS,
  type DashboardSnapshot,
} from "@/features/reports/dashboardSnapshots";

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

type DashboardView = "dashboard" | "goals" | "historical";

export function TeamDashboard() {
  const { profile, user } = useAuth();
  /** Raw owner status (drives tab/toggle visibility — always honored). */
  const isOwnerAccount =
    (profile?.role === "admin" || profile?.role === "super_admin") &&
    user?.email === DASHBOARD_OWNER_EMAIL;

  /** Owner-only sub-view selector (Dashboard / Goals / Historical). */
  const [view, setView] = useState<DashboardView>("dashboard");

  /**
   * Owner can preview the dashboard the way other users see it (no
   * inline goal pencils, no quote/widget editors, no milestone Edit
   * button). When `viewAsTeam` is true we suppress edit affordances by
   * collapsing the effective owner flag, but the tabs/toggle stay
   * visible so the owner can flip back.
   */
  const [viewAsTeam, setViewAsTeam] = useState(false);
  const isOwner = isOwnerAccount && !viewAsTeam;

  // Per-quarter goals — Codex-parity store. The dashboard always reads
  // the *current* quarter; the Goals admin page can edit any quarter.
  const currentQuarter = useMemo(() => quarterLabelFromDate(new Date()), []);
  const [qgoals, setQgoals] = useState<QuarterGoals>(() =>
    getQuarterGoals(currentQuarter),
  );
  useEffect(() => {
    saveQuarterGoals(currentQuarter, qgoals);
  }, [currentQuarter, qgoals]);

  // Pick up goal edits made on the admin page (cross-tab + same-tab).
  useEffect(() => {
    function refresh() {
      setQgoals(getQuarterGoals(currentQuarter));
    }
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [currentQuarter]);

  // Adapter: legacy `Goals` shape for the unchanged KpiCard / chart code.
  // All edits flow through to the per-quarter store via `setGoalQuarter`.
  const goals: Goals = useMemo(
    () => ({
      arr: qgoals.arr.quarter_goal,
      new_customers: qgoals.new_customers.quarter_goal,
      new_sales: qgoals.new_sales.quarter_goal,
      total_active_pipeline: qgoals.total_active_pipeline.quarter_goal,
      sql: qgoals.sql.quarter_goal,
      mql: qgoals.mql.quarter_goal,
      renewals_amount: qgoals.renewals_number.quarter_goal,
      nrr_customer_pct: qgoals.nrr_customer_pct.quarter_goal,
      nrr_dollar_pct: qgoals.nrr_dollar_pct.quarter_goal,
      qtd_billing: qgoals.qtd_billing_progress.quarter_goal,
    }),
    [qgoals],
  );

  /** Update a metric's quarter_goal (used by the inline pencil edits). */
  function setGoalQuarter(key: MetricKey, quarter_goal: number) {
    setQgoals((q) => ({
      ...q,
      [key]: { ...q[key], quarter_goal },
    }));
  }

  // Which of the 3 quarter months is "today"? Drives the
  // "current month goal" subtitle on running-total charts.
  const monthIdx = useMemo(
    () => currentMonthIndex(currentQuarter, new Date()),
    [currentQuarter],
  );
  const monthShort = useMemo(() => {
    const names = quarterMonths(currentQuarter);
    return monthIdx == null ? names[2] : names[monthIdx];
  }, [currentQuarter, monthIdx]);

  // Manual widgets (Most Recent Quote, QTD Billing override).
  // Milestones moved to their own store (`dashboardMilestones`).
  const [widgets, setWidgets] = useState<DashboardWidgets>(() => loadWidgets());
  useEffect(() => {
    saveWidgets(widgets);
  }, [widgets]);

  // Milestones (Development section) — Codex-parity storage.
  const [milestones, setMilestones] = useState<Milestone[]>(() =>
    loadMilestones(),
  );
  useEffect(() => {
    saveMilestones(milestones);
  }, [milestones]);
  const [milestoneEditMode, setMilestoneEditMode] = useState(false);
  const [milestoneSelected, setMilestoneSelected] = useState<Set<string>>(
    new Set(),
  );

  const { data: m, isLoading, error } = useDashboardMetrics();
  const { data: lost } = useLostCustomers();
  const { data: arrTrend } = useArrTrend();
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

  // Running-total point arrays for the segmented line charts.
  const qStart = m?.fiscal_quarter_start ?? "";
  const qEnd = m?.fiscal_quarter_end ?? "";

  // Per-month cumulative goals (M1, M2, M3) for each charted KPI.
  // Pulled from the per-quarter Goals admin page; null months auto-fill
  // to even thirds. Locked metrics (NRR, pipeline) are flat.
  const newCustomersMonthGoals = useMemo(
    () => fillMonthGoals(qgoals.new_customers),
    [qgoals.new_customers],
  );
  const newSalesMonthGoals = useMemo(
    () => fillMonthGoals(qgoals.new_sales),
    [qgoals.new_sales],
  );
  const renewalsMonthGoals = useMemo(
    () => fillMonthGoals(qgoals.renewals_number),
    [qgoals.renewals_number],
  );
  const sqlMonthGoals = useMemo(() => fillMonthGoals(qgoals.sql), [qgoals.sql]);
  const mqlMonthGoals = useMemo(() => fillMonthGoals(qgoals.mql), [qgoals.mql]);

  const newCustomersRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (newCustomerRows ?? []).map((r) => ({ date: r.close_date, value: 1 })),
        qStart,
        qEnd,
        newCustomersMonthGoals,
      ),
    [newCustomerRows, qStart, qEnd, newCustomersMonthGoals],
  );

  const newSalesRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (newCustomerRows ?? []).map((r) => ({ date: r.close_date, value: r.amount })),
        qStart,
        qEnd,
        newSalesMonthGoals,
      ),
    [newCustomerRows, qStart, qEnd, newSalesMonthGoals],
  );

  const renewalsClosedRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (renewalsClosedRows ?? []).map((r) => ({ date: r.close_date, value: r.amount })),
        qStart,
        qEnd,
        renewalsMonthGoals,
      ),
    [renewalsClosedRows, qStart, qEnd, renewalsMonthGoals],
  );

  const sqlRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (sqlRows ?? []).map((r) => ({ date: r.event_date, value: 1 })),
        qStart,
        qEnd,
        sqlMonthGoals,
      ),
    [sqlRows, qStart, qEnd, sqlMonthGoals],
  );

  const mqlRunning = useMemo<SegmentPoint[]>(
    () =>
      buildRunningTotal(
        (mqlRows ?? []).map((r) => ({ date: r.event_date, value: 1 })),
        qStart,
        qEnd,
        mqlMonthGoals,
      ),
    [mqlRows, qStart, qEnd, mqlMonthGoals],
  );

  // ARR trend → SegmentPoint format. Codex-parity: ONE point per
  // calendar quarter (the trailing-365 ARR at end-of-quarter), starting
  // at Q2-2025 and rolling forward as new quarters complete. The
  // current in-progress quarter is shown using the latest available
  // monthly snapshot so the line keeps moving instead of dropping off.
  const arrPoints = useMemo<SegmentPoint[]>(() => {
    if (!arrTrend || arrTrend.length === 0) return [];
    // End-of-quarter month for each calendar quarter is month index
    // 2 (Mar), 5 (Jun), 8 (Sep), 11 (Dec). Filter monthly rows to those.
    const eoq = arrTrend.filter((p) => {
      const d = new Date(p.month_start);
      const m = d.getUTCMonth();
      return m === 2 || m === 5 || m === 8 || m === 11;
    });
    // Start at Q2-2025 (June 2025 — month_start '2025-06-01') going forward.
    const WINDOW_START = "2025-06-01";
    const completed = eoq.filter((p) => p.month_start >= WINDOW_START);
    // Append the current in-progress quarter using the latest available
    // monthly snapshot (only if it isn't already an EOQ row that was
    // captured above).
    const last = arrTrend[arrTrend.length - 1];
    const lastIsEoq = (() => {
      const m = new Date(last.month_start).getUTCMonth();
      return m === 2 || m === 5 || m === 8 || m === 11;
    })();
    const points = [...completed];
    if (!lastIsEoq && last.month_start >= WINDOW_START) {
      const today = new Date();
      const currentQ = Math.floor(today.getUTCMonth() / 3) + 1;
      points.push({
        ...last,
        fiscal_period: `Q${currentQ}-${today.getUTCFullYear()}`,
      });
    }
    return points.map((p) => {
      // Re-label completed EOQ rows from the month_start, since
      // `fiscal_period` from the view may use a different convention.
      const d = new Date(p.month_start);
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      const label = `Q${q}-${d.getUTCFullYear()}`;
      return {
        label,
        actual: Number(p.trailing_365_arr) || 0,
        goal: goals.arr,
      };
    });
  }, [arrTrend, goals.arr]);

  // Capture a weekly snapshot once per ISO week the first time the
  // dashboard renders with real metrics that week. Idempotent — safe
  // to call on every render. Owner-only: writing snapshots from the
  // team-view session would pollute history with the wrong author.
  useEffect(() => {
    if (!isOwnerAccount || !m) return;
    captureWeeklySnapshotIfNeeded({
      metrics: {
        arr: num(m.current_arr),
        new_customers_qtd: num(m.new_customers_qtd),
        new_customer_amount_qtd: num(m.new_customer_amount_qtd),
        pipeline_amount: num(m.pipeline_amount),
        renewals_amount_qtd: num(m.renewals_amount_qtd),
        nrr_by_customer_pct: num(
          m.nrr_by_customer_true_pct ?? m.nrr_by_customer_legacy_pct,
        ),
        nrr_by_dollar_pct: num(
          m.nrr_by_dollar_true_pct ?? m.nrr_by_dollar_legacy_pct,
        ),
        sql_qtd: num(m.sql_qtd),
        mql_unique_qtd: num(m.mql_unique_qtd),
        qtd_billing:
          widgets.qtd_billing_actual ??
          num(m.new_customer_amount_qtd) + num(m.renewals_amount_qtd),
      },
      milestones,
      quote_text: widgets.quote_text,
      quote_author: widgets.quote_author,
    });
  }, [isOwnerAccount, m, milestones, widgets]);

  // ---- Owner sub-views (Goals, Historical) ----
  // Both gated to the raw owner account so a "team view" preview still
  // shows them in the tab bar.
  const tabBar = isOwnerAccount ? (
    <DashboardTabBar
      view={view}
      onView={setView}
      viewAsTeam={viewAsTeam}
      onViewAsTeam={setViewAsTeam}
    />
  ) : null;

  if (isOwnerAccount && view === "goals") {
    return (
      <div className="space-y-4">
        {tabBar}
        <GoalsView />
      </div>
    );
  }

  if (isOwnerAccount && view === "historical") {
    return (
      <div className="space-y-4">
        {tabBar}
        <HistoricalView />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {tabBar}
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        {tabBar}
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Couldn't load dashboard metrics: {(error as Error).message}
        </div>
      </div>
    );
  }

  if (!m) {
    return (
      <div className="space-y-4">
        {tabBar}
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No metrics available yet for the current quarter.
          </CardContent>
        </Card>
      </div>
    );
  }

  const arr = num(m.current_arr);
  const newCustomers = num(m.new_customers_qtd);
  const newSales = num(m.new_customer_amount_qtd);
  const pipeline = num(m.pipeline_amount);
  const renewalsClosedAmt = num(m.renewals_amount_qtd);
  const nrrCust = num(m.nrr_by_customer_true_pct ?? m.nrr_by_customer_legacy_pct);
  const nrrDollar = num(m.nrr_by_dollar_true_pct ?? m.nrr_by_dollar_legacy_pct);

  return (
    <div className="space-y-6">
      {tabBar}
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

      {/* ----- Sales -----
          Codex-parity layout: KPI directly above its chart (ARR | New
          Customers stacked on top row), then New Sales | Pipeline side by
          side below. Whole section is wrapped in a tinted card so it's
          clearly demarcated from Marketing / CS / Services / Development. */}
      <SectionWrap title="Sales" tone="bg-blue-50 dark:bg-blue-950/30">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ARR — KPI above quarterly chart */}
          <div className="space-y-3">
            <KpiCard
              label="ARR (rolling 365)"
              value={formatCurrency(arr)}
              progress={pct(arr, goals.arr)}
              goal={goals.arr}
              formatGoal={formatCurrency}
              onGoalChange={(v) => setGoalQuarter("arr", v)}
              editable={isOwner}
              hint="Sum of closed-won amount in the trailing 365 days (v_arr_rolling_365)."
              to="/reports?tab=standard"
            />
            {arrPoints.length > 0 && (
              <ChartCard
                title={`ARR by Quarter — goal ${formatCurrency(goals.arr)}`}
              >
                <ChartLegend />
                <SegmentedLineChart
                  data={arrPoints}
                  yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tooltipFormatter={(v) => formatCurrency(v)}
                  height={220}
                />
              </ChartCard>
            )}
          </div>

          {/* New Customers — KPI above running-total chart */}
          <div className="space-y-3">
            <KpiCard
              label="New Customers QTD"
              value={String(newCustomers)}
              progress={pct(newCustomers, goals.new_customers)}
              goal={goals.new_customers}
              formatGoal={(v) => String(v)}
              onGoalChange={(v) => setGoalQuarter("new_customers", v)}
              editable={isOwner}
              hint="Closed-won opps with kind='new_business' & close_date in current fiscal quarter (v_new_customers_qtd)."
              to="/reports?tab=standard"
            />
            {newCustomersRunning.length > 1 && (
              <ChartCard
                title={`New Customers — running total (Q goal ${goals.new_customers})`}
                subtitle={
                  monthIdx != null
                    ? `${monthShort} pace goal: ${Math.round(newCustomersMonthGoals[monthIdx])}`
                    : undefined
                }
              >
                <ChartLegend />
                <SegmentedLineChart
                  data={newCustomersRunning}
                  yFormatter={(v) => String(Math.round(v))}
                  tooltipFormatter={(v) => String(Math.round(v))}
                  height={220}
                />
                {isOwner && (
                  <MonthSplitInline
                    metricKey="new_customers"
                    quarter={currentQuarter}
                    onSaved={() => setQgoals(getQuarterGoals(currentQuarter))}
                  />
                )}
              </ChartCard>
            )}
          </div>

          {/* New Sales — KPI above running-total chart */}
          <div className="space-y-3">
            <KpiCard
              label="New Sales $ QTD"
              value={formatCurrency(newSales)}
              progress={pct(newSales, goals.new_sales)}
              goal={goals.new_sales}
              formatGoal={formatCurrency}
              onGoalChange={(v) => setGoalQuarter("new_sales", v)}
              editable={isOwner}
              hint="Sum of amount on rows in v_new_customers_qtd."
              to="/reports?tab=standard"
            />
            {newSalesRunning.length > 1 && (
              <ChartCard
                title={`New Sales $ — running total (Q goal ${formatCurrency(goals.new_sales)})`}
                subtitle={
                  monthIdx != null
                    ? `${monthShort} pace goal: ${formatCurrency(newSalesMonthGoals[monthIdx])}`
                    : undefined
                }
              >
                <ChartLegend />
                <SegmentedLineChart
                  data={newSalesRunning}
                  yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tooltipFormatter={(v) => formatCurrency(v)}
                  height={220}
                />
                {isOwner && (
                  <MonthSplitInline
                    metricKey="new_sales"
                    quarter={currentQuarter}
                    onSaved={() => setQgoals(getQuarterGoals(currentQuarter))}
                  />
                )}
              </ChartCard>
            )}
          </div>

          {/* Pipeline — KPI alone (locked metric, no per-month split) */}
          <div className="space-y-3">
            <KpiCard
              label="Active Pipeline"
              value={formatCurrency(pipeline)}
              progress={pct(pipeline, goals.total_active_pipeline)}
              goal={goals.total_active_pipeline}
              formatGoal={formatCurrency}
              onGoalChange={(v) => setGoalQuarter("total_active_pipeline", v)}
              editable={isOwner}
              hint={`${m.pipeline_count ?? 0} open • weighted ${formatCurrency(num(m.pipeline_weighted_amount))} (v_active_pipeline)`}
              to="/opportunities"
            />
          </div>
        </div>
      </SectionWrap>

      {/* ----- Marketing (graphs-only per Codex parity) ----- */}
      <SectionWrap title="Marketing" tone="bg-purple-50 dark:bg-purple-950/30">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {sqlRunning.length > 1 && (
            <ChartCard
              title={`SQL — running total (Q goal ${goals.sql})`}
              subtitle={
                monthIdx != null
                  ? `${monthShort} pace goal: ${Math.round(sqlMonthGoals[monthIdx])}`
                  : undefined
              }
            >
              <ChartLegend />
              <SegmentedLineChart
                data={sqlRunning}
                yFormatter={(v) => String(Math.round(v))}
                tooltipFormatter={(v) => String(Math.round(v))}
                height={220}
              />
              {isOwner && (
                <MonthSplitInline
                  metricKey="sql"
                  quarter={currentQuarter}
                  onSaved={() => setQgoals(getQuarterGoals(currentQuarter))}
                />
              )}
            </ChartCard>
          )}
          {mqlRunning.length > 1 && (
            <ChartCard
              title={`MQL — running total (Q goal ${goals.mql})`}
              subtitle={
                monthIdx != null
                  ? `${monthShort} pace goal: ${Math.round(mqlMonthGoals[monthIdx])}`
                  : undefined
              }
            >
              <ChartLegend />
              <SegmentedLineChart
                data={mqlRunning}
                yFormatter={(v) => String(Math.round(v))}
                tooltipFormatter={(v) => String(Math.round(v))}
                height={220}
              />
              {isOwner && (
                <MonthSplitInline
                  metricKey="mql"
                  quarter={currentQuarter}
                  onSaved={() => setQgoals(getQuarterGoals(currentQuarter))}
                />
              )}
            </ChartCard>
          )}
        </div>
      </SectionWrap>

      {/* ----- Customer Success ----- */}
      <SectionWrap title="Customer Success" tone="bg-emerald-50 dark:bg-emerald-950/30">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Renewals — KPI above running-total chart */}
          <div className="space-y-3">
            <KpiCard
              label="Renewals Closed QTD"
              value={formatCurrency(renewalsClosedAmt)}
              progress={pct(renewalsClosedAmt, goals.renewals_amount)}
              goal={goals.renewals_amount}
              formatGoal={formatCurrency}
              onGoalChange={(v) => setGoalQuarter("renewals_number", v)}
              editable={isOwner}
              hint={`${m.renewals_qtd ?? 0} renewal-kind closed-won w/ close_date this quarter (v_renewals_qtd, excludes EHR Implementation).`}
              to="/renewals?tab=closed-won&preset=this-quarter"
            />
            {renewalsClosedRunning.length > 1 && (
              <ChartCard
                title={`Renewals Closed $ — running total (Q goal ${formatCurrency(goals.renewals_amount)})`}
                subtitle={
                  monthIdx != null
                    ? `${monthShort} pace goal: ${formatCurrency(renewalsMonthGoals[monthIdx])}`
                    : undefined
                }
              >
                <ChartLegend />
                <SegmentedLineChart
                  data={renewalsClosedRunning}
                  yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tooltipFormatter={(v) => formatCurrency(v)}
                  height={220}
                />
                {isOwner && (
                  <MonthSplitInline
                    metricKey="renewals_number"
                    quarter={currentQuarter}
                    onSaved={() => setQgoals(getQuarterGoals(currentQuarter))}
                  />
                )}
              </ChartCard>
            )}
          </div>

          {/* QTD Billing — KPI alone */}
          <div className="space-y-3">
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
              onGoalChange={(v) => setGoalQuarter("qtd_billing_progress", v)}
              editable={isOwner}
              hint={
                widgets.qtd_billing_actual != null
                  ? "Using manual override. Clear it below to fall back to New Sales + Renewals."
                  : "New Sales $ QTD + Renewals Closed $ QTD. Set a manual override below if billing system says otherwise."
              }
            />
            <KpiCard
              label="NRR by Customer"
              value={fmtPct(nrrCust)}
              progress={Math.min(100, (nrrCust / goals.nrr_customer_pct) * 100)}
              goal={goals.nrr_customer_pct}
              formatGoal={(v) => `${v}%`}
              onGoalChange={(v) => setGoalQuarter("nrr_customer_pct", v)}
              editable={isOwner}
              hint="(starting customers − churn QTD) / starting customers. 100% means zero churn this quarter so far."
            />
            <KpiCard
              label="NRR by Dollar"
              value={fmtPct(nrrDollar)}
              progress={Math.min(100, (nrrDollar / goals.nrr_dollar_pct) * 100)}
              goal={goals.nrr_dollar_pct}
              formatGoal={(v) => `${v}%`}
              onGoalChange={(v) => setGoalQuarter("nrr_dollar_pct", v)}
              editable={isOwner}
              hint="(starting ARR − churn $ QTD) / starting ARR."
            />
          </div>
        </div>
      </SectionWrap>

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

      {/* ----- Services (ClickUp) ----- */}
      <SectionWrap title="Services" tone="bg-amber-50 dark:bg-amber-950/30">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        </div>
      </SectionWrap>

      {/* ----- Development (manual milestones) ----- */}
      <SectionWrap title="Development" tone="bg-rose-50 dark:bg-rose-950/30">
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Manually-tracked milestones. Status auto-derives from the
                completion date + complete checkbox.
              </p>
              {isOwner && (
                <div className="flex items-center gap-1.5">
                  {milestoneEditMode ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMilestones((items) =>
                            items.filter((it) => !milestoneSelected.has(it.id)),
                          );
                          setMilestoneSelected(new Set());
                        }}
                        disabled={milestoneSelected.size === 0}
                        title="Remove the selected milestones"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Remove Selected
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setMilestoneEditMode(false);
                          setMilestoneSelected(new Set());
                        }}
                      >
                        Done
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setMilestoneEditMode(true)}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setMilestones((items) => [...items, newMilestone()])
                    }
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Milestone
                  </Button>
                </div>
              )}
            </div>
            {milestones.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No milestones yet.{" "}
                {isOwner ? "Click 'Add Milestone' to track one." : ""}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      {milestoneEditMode && isOwner && (
                        <th className="px-2 py-2 font-medium w-10 text-center">
                          <input
                            type="checkbox"
                            checked={
                              milestones.length > 0 &&
                              milestoneSelected.size === milestones.length
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setMilestoneSelected(
                                  new Set(milestones.map((it) => it.id)),
                                );
                              } else {
                                setMilestoneSelected(new Set());
                              }
                            }}
                            className="h-4 w-4 cursor-pointer"
                            aria-label="Select all"
                          />
                        </th>
                      )}
                      <th className="px-2 py-2 font-medium">Project</th>
                      <th className="px-2 py-2 font-medium">Completion Date</th>
                      <th className="px-2 py-2 font-medium text-center">
                        Complete
                      </th>
                      <th className="px-2 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((item) => {
                      const status = deriveStatus(item);
                      const tone =
                        STATUS_TONES[status] ??
                        "bg-muted text-muted-foreground";
                      const canEdit = isOwner && milestoneEditMode;
                      return (
                        <tr key={item.id} className="border-t">
                          {milestoneEditMode && isOwner && (
                            <td className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={milestoneSelected.has(item.id)}
                                onChange={(e) => {
                                  setMilestoneSelected((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(item.id);
                                    else next.delete(item.id);
                                    return next;
                                  });
                                }}
                                className="h-4 w-4 cursor-pointer"
                              />
                            </td>
                          )}
                          <td className="px-2 py-1.5">
                            {canEdit ? (
                              <Input
                                value={item.project}
                                onChange={(e) =>
                                  setMilestones((items) =>
                                    items.map((d) =>
                                      d.id === item.id
                                        ? { ...d, project: e.target.value }
                                        : d,
                                    ),
                                  )
                                }
                                className="h-7 text-sm"
                                placeholder="Project name"
                              />
                            ) : (
                              <span>{item.project || "—"}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {canEdit ? (
                              <Input
                                type="date"
                                value={item.completion_date}
                                onChange={(e) =>
                                  setMilestones((items) =>
                                    items.map((d) =>
                                      d.id === item.id
                                        ? {
                                            ...d,
                                            completion_date: e.target.value,
                                          }
                                        : d,
                                    ),
                                  )
                                }
                                className="h-7 text-sm"
                              />
                            ) : (
                              <span>{item.completion_date || "—"}</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <input
                              type="checkbox"
                              checked={item.complete}
                              disabled={!canEdit}
                              onChange={(e) =>
                                setMilestones((items) =>
                                  items.map((d) =>
                                    d.id === item.id
                                      ? { ...d, complete: e.target.checked }
                                      : d,
                                  ),
                                )
                              }
                              className="h-4 w-4 cursor-pointer disabled:cursor-default"
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded text-[11px] font-medium ${tone}`}
                            >
                              {status}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </SectionWrap>

      <Card className="print:hidden">
        <CardContent className="p-3 text-[11px] text-muted-foreground space-y-1">
          <p>
            Sources:{" "}
            <code className="bg-muted px-1 py-0.5 rounded">v_dashboard_metrics</code>
            ,{" "}
            <code className="bg-muted px-1 py-0.5 rounded">v_lost_customers_qtd</code>
            ,{" "}
            <code className="bg-muted px-1 py-0.5 rounded">v_arr_rolling_365</code>.
          </p>
          <p>
            Goals + milestones + weekly snapshots persist in your browser
            (localStorage). DB-backed storage can come next.
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
  monthGoals: [number, number, number],
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
  // monthGoals are cumulative end-of-month-N targets — admin can set
  // per-month targets in Goals page (else default to even thirds).
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
      goal: monthGoals[i],
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

/**
 * Visually-demarcated section wrapper. The caller controls the inner
 * grid (so Sales can stack KPI-above-chart, while Marketing can do a
 * simple chart row). The colored `tone` background is what makes
 * Sales / Marketing / CS / Services / Development each look like
 * separate cards on the page, matching Codex's dashboard.
 */
function SectionWrap({
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
      <div className={`rounded-lg p-3 ${tone}`}>{children}</div>
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

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
          {subtitle && (
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5">
              {subtitle}
            </span>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Inline per-month split editor (owner-only, dashboard view). Lets the
 * owner override the auto-thirds split for a given metric without
 * leaving the dashboard. Quarter goal stays untouched — only M1/M2/M3
 * cumulative targets change. Surfaces a warning if the cumulative
 * series isn't monotonically increasing or M3 disagrees with the
 * quarter goal (which would make the chart's R/Y/G coloring
 * misleading).
 */
function MonthSplitInline({
  metricKey,
  quarter,
  onSaved,
}: {
  metricKey: MetricKey;
  quarter: string;
  onSaved: () => void;
}) {
  const meta = METRICS.find((m) => m.key === metricKey)!;
  const months = useMemo(() => quarterMonths(quarter), [quarter]);
  const [goal, setGoal] = useState<MetricGoal>(() =>
    getQuarterGoals(quarter)[metricKey],
  );
  useEffect(() => {
    setGoal(getQuarterGoals(quarter)[metricKey]);
  }, [quarter, metricKey]);

  // M3 cumulative defaults to quarter_goal (Codex parity); user can
  // override it, but we warn when it disagrees.
  const m1Filled = goal.month_goals[0] ?? goal.quarter_goal / 3;
  const m2Filled = goal.month_goals[1] ?? (2 * goal.quarter_goal) / 3;
  const m3Filled = goal.month_goals[2] ?? goal.quarter_goal;

  function commit(idx: 0 | 1 | 2, raw: string) {
    const parsed = Number(raw);
    const next: MetricGoal = {
      quarter_goal: goal.quarter_goal,
      month_goals: [...goal.month_goals] as MetricGoal["month_goals"],
    };
    next.month_goals[idx] =
      raw === "" || !Number.isFinite(parsed) ? null : parsed;
    setGoal(next);
    const all = getQuarterGoals(quarter);
    saveQuarterGoals(quarter, { ...all, [metricKey]: next });
    onSaved();
  }

  function reset() {
    const next: MetricGoal = {
      quarter_goal: goal.quarter_goal,
      month_goals: [null, null, null],
    };
    setGoal(next);
    const all = getQuarterGoals(quarter);
    saveQuarterGoals(quarter, { ...all, [metricKey]: next });
    onSaved();
  }

  // Validation: cumulative should be monotonically non-decreasing,
  // and M3 should equal quarter_goal so the chart's R/Y/G coloring
  // still makes sense.
  const warnings: string[] = [];
  if (m1Filled > m2Filled) {
    warnings.push(`${months[0]} (${m1Filled}) > ${months[1]} (${m2Filled})`);
  }
  if (m2Filled > m3Filled) {
    warnings.push(`${months[1]} (${m2Filled}) > ${months[2]} (${m3Filled})`);
  }
  if (Math.abs(m3Filled - goal.quarter_goal) > 0.0001) {
    warnings.push(
      `${months[2]} cumulative (${m3Filled}) ≠ quarter goal (${goal.quarter_goal})`,
    );
  }

  if (meta.locked) return null;

  return (
    <div className="mt-2 pt-2 border-t print:hidden">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Month splits (cumulative):
        </span>
        <button
          type="button"
          onClick={reset}
          className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          title="Restore auto-thirds (M1 = Q/3, M2 = 2Q/3, M3 = Q)"
        >
          reset
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {([0, 1, 2] as const).map((i) => (
          <label key={i} className="flex flex-col text-[10px] text-muted-foreground gap-0.5">
            <span>{months[i]}</span>
            <Input
              type="number"
              value={goal.month_goals[i] ?? ""}
              placeholder={String(
                Math.round(
                  i === 0
                    ? goal.quarter_goal / 3
                    : i === 1
                      ? (2 * goal.quarter_goal) / 3
                      : goal.quarter_goal,
                ),
              )}
              onChange={(e) => commit(i, e.target.value)}
              className="h-7 w-24 text-xs"
            />
          </label>
        ))}
      </div>
      {warnings.length > 0 && (
        <div className="mt-1.5 text-[10px] text-amber-700 dark:text-amber-400">
          ⚠ {warnings.join(" • ")}
        </div>
      )}
    </div>
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

// ---------------------------------------------------------------------------
// Owner-only sub-views: tab bar, Goals, Historical
// ---------------------------------------------------------------------------

/**
 * Top-of-page tab bar for the dashboard owner. Always rendered for
 * isOwnerAccount (even in team-view mode) so the owner can flip back.
 */
function DashboardTabBar({
  view,
  onView,
  viewAsTeam,
  onViewAsTeam,
}: {
  view: DashboardView;
  onView: (v: DashboardView) => void;
  viewAsTeam: boolean;
  onViewAsTeam: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b print:hidden">
      <div className="flex items-center gap-1">
        <TabBarButton
          label="Dashboard"
          active={view === "dashboard"}
          onClick={() => onView("dashboard")}
        />
        <TabBarButton
          label="Goals"
          active={view === "goals"}
          onClick={() => onView("goals")}
        />
        <TabBarButton
          label="Historical"
          active={view === "historical"}
          onClick={() => onView("historical")}
        />
      </div>
      <div className="flex items-center gap-2">
        {view === "dashboard" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            title="Export the current dashboard view to PDF (uses your browser's print → Save as PDF)"
            className="mb-1"
          >
            <Printer className="h-3.5 w-3.5 mr-1.5" />
            Export PDF
          </Button>
        )}
        {view === "dashboard" && (
          <Button
            variant={viewAsTeam ? "default" : "outline"}
            size="sm"
            onClick={() => onViewAsTeam(!viewAsTeam)}
            title={
              viewAsTeam
                ? "Currently previewing as team — click to return to owner view"
                : "Preview the dashboard the way other users see it"
            }
            className="mb-1"
          >
            {viewAsTeam ? (
              <>
                <EyeOff className="h-3.5 w-3.5 mr-1.5" />
                Previewing Team View
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                View as Team
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

function TabBarButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ----- Goals view (per-quarter goal editor) ----------------------------------

function GoalsView() {
  const currentQuarter = useMemo(() => quarterLabelFromDate(new Date()), []);

  // Available quarters in dropdown: saved + current + a few future quarters,
  // sorted chronologically (oldest → future) so the timeline reads naturally.
  const quarterOptions = useMemo(() => {
    const set = new Set<string>(listSavedQuarters());
    set.add(currentQuarter);
    const parsed = parseQuarterLabel(currentQuarter);
    if (parsed) {
      let q = parsed.quarter;
      let y = parsed.year;
      for (let i = 0; i < 4; i++) {
        if (q === 4) {
          q = 1;
          y += 1;
        } else {
          q = (q + 1) as 1 | 2 | 3 | 4;
        }
        set.add(`Q${q}-${y}`);
      }
    }
    // Chronological sort: parse year + quarter and compare numerically.
    // String sort would put Q1-2026 before Q2-2025, which is wrong.
    return Array.from(set).sort((a, b) => {
      const pa = parseQuarterLabel(a);
      const pb = parseQuarterLabel(b);
      if (!pa || !pb) return a.localeCompare(b);
      if (pa.year !== pb.year) return pa.year - pb.year;
      return pa.quarter - pb.quarter;
    });
  }, [currentQuarter]);

  const [quarter, setQuarter] = useState<string>(currentQuarter);
  const [draft, setDraft] = useState<QuarterGoals>(() =>
    getQuarterGoals(quarter),
  );
  const [saved, setSaved] = useState<QuarterGoals>(() =>
    getQuarterGoals(quarter),
  );
  const [locked, setLockedState] = useState<boolean>(() =>
    isQuarterLocked(quarter),
  );
  const [editing, setEditing] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const loaded = getQuarterGoals(quarter);
    setDraft(loaded);
    setSaved(loaded);
    setLockedState(isQuarterLocked(quarter));
    setEditing(false);
  }, [quarter]);

  useEffect(() => {
    if (!feedback) return;
    const id = window.setTimeout(() => setFeedback(null), 2500);
    return () => window.clearTimeout(id);
  }, [feedback]);

  const dirty = useMemo(() => {
    return METRIC_KEYS.some((k) => {
      const a = draft[k];
      const b = saved[k];
      return (
        a.quarter_goal !== b.quarter_goal ||
        a.month_goals[0] !== b.month_goals[0] ||
        a.month_goals[1] !== b.month_goals[1] ||
        a.month_goals[2] !== b.month_goals[2]
      );
    });
  }, [draft, saved]);

  const months = useMemo(() => quarterMonths(quarter), [quarter]);
  const canEdit = editing && !locked;

  function handleQuarterGoalChange(key: MetricKey, raw: string) {
    const meta = METRICS.find((m) => m.key === key)!;
    const parsed = Number(raw);
    setDraft((d) => {
      const q = Number.isFinite(parsed) ? parsed : 0;
      const next = { ...d };
      if (meta.locked) {
        // Locked metrics (NRR %, Pipeline) are flat — every month equals q.
        next[key] = { quarter_goal: q, month_goals: [q, q, q] };
      } else {
        // Don't clobber month overrides — let M3 stay null (auto-fill = q)
        // or whatever the user typed. They can also edit M3 directly now.
        next[key] = {
          quarter_goal: q,
          month_goals: [...d[key].month_goals] as MetricGoal["month_goals"],
        };
      }
      return next;
    });
  }

  function handleMonthChange(key: MetricKey, idx: 0 | 1 | 2, raw: string) {
    const parsed = Number(raw);
    setDraft((d) => {
      const next = { ...d };
      const goals = [...d[key].month_goals] as [
        number | null,
        number | null,
        number | null,
      ];
      goals[idx] = raw === "" || !Number.isFinite(parsed) ? null : parsed;
      next[key] = { ...d[key], month_goals: goals };
      return next;
    });
  }

  function handleSave() {
    saveQuarterGoals(quarter, draft);
    setSaved(draft);
    setEditing(false);
    setFeedback(`Saved goals for ${quarter}.`);
  }

  function handleResetQuarterDefaults() {
    resetQuarterToDefaults(quarter);
    const fresh = getQuarterGoals(quarter);
    setDraft(fresh);
    setSaved(fresh);
    setFeedback(`Reset ${quarter} to defaults.`);
  }

  function handleResetField(key: MetricKey) {
    setDraft((d) => ({ ...d, [key]: DEFAULT_GOALS[key] }));
  }

  function toggleLock() {
    const next = !locked;
    setQuarterLocked(quarter, next);
    setLockedState(next);
    if (next) setEditing(false);
    setFeedback(next ? `Locked ${quarter}.` : `Unlocked ${quarter}.`);
  }

  const groups: Array<MetricMeta["group"]> = [
    "Sales",
    "Marketing",
    "Customer Success",
  ];

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Dashboard Goals</h2>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Set per-quarter targets. Each metric has a quarter goal plus
              cumulative end-of-month targets (M1, M2, M3). All three months
              are independently editable — leave blank for auto-fill (even
              thirds for M1/M2, quarter goal for M3). Editing a month doesn't
              change the quarter goal. Warnings flag splits that aren't
              monotonic or don't land on the quarter goal. Locked metrics
              (NRR %, Active Pipeline) stay flat across the quarter.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground">Quarter</Label>
              <Select value={quarter} onValueChange={setQuarter}>
                <SelectTrigger className="h-8 w-32 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {quarterOptions.map((q) => (
                    <SelectItem key={q} value={q}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={toggleLock}
              title={locked ? "Unlock to edit" : "Lock so no edits can happen"}
            >
              {locked ? (
                <>
                  <Lock className="h-3.5 w-3.5 mr-1.5" />
                  Locked
                </>
              ) : (
                <>
                  <LockOpen className="h-3.5 w-3.5 mr-1.5" />
                  Unlocked
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!locked && !editing && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            )}
            {editing && (
              <>
                <Button size="sm" onClick={handleSave} disabled={!dirty}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(saved);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResetQuarterDefaults}
            disabled={locked}
            title="Restore default goals for this quarter"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            Reset Quarter to Defaults
          </Button>
        </div>

        {feedback && (
          <div className="text-xs rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 px-3 py-2">
            {feedback}
          </div>
        )}

        <div className="space-y-5">
          {groups.map((g) => {
            const fields = METRICS.filter((m) => m.group === g);
            if (fields.length === 0) return null;
            return (
              <div key={g} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g}
                </h3>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium w-1/3">Metric</th>
                        <th className="px-3 py-2 font-medium">Quarter Goal</th>
                        <th className="px-3 py-2 font-medium">{months[0]}</th>
                        <th className="px-3 py-2 font-medium">{months[1]}</th>
                        <th className="px-3 py-2 font-medium">{months[2]}</th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((meta) => (
                        <GoalRow
                          key={meta.key}
                          meta={meta}
                          value={draft[meta.key]}
                          months={months}
                          canEdit={canEdit}
                          onQuarterChange={(raw) =>
                            handleQuarterGoalChange(meta.key, raw)
                          }
                          onMonthChange={(idx, raw) =>
                            handleMonthChange(meta.key, idx, raw)
                          }
                          onReset={() => handleResetField(meta.key)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function GoalRow({
  meta,
  value,
  months,
  canEdit,
  onQuarterChange,
  onMonthChange,
  onReset,
}: {
  meta: MetricMeta;
  value: QuarterGoals[MetricKey];
  months: [string, string, string];
  canEdit: boolean;
  onQuarterChange: (raw: string) => void;
  onMonthChange: (idx: 0 | 1 | 2, raw: string) => void;
  onReset: () => void;
}) {
  function display(v: number | null | undefined): string {
    if (v == null || !Number.isFinite(v)) return "—";
    if (meta.format === "currency") return formatCurrency(v);
    if (meta.format === "percent") return `${v}%`;
    return String(v);
  }

  // Auto-fill defaults (even thirds) used as placeholders + when null at read.
  const filled: [number, number, number] = [
    value.month_goals[0] ?? value.quarter_goal / 3,
    value.month_goals[1] ?? (2 * value.quarter_goal) / 3,
    value.month_goals[2] ?? value.quarter_goal,
  ];
  const placeholder = (i: 0 | 1 | 2) =>
    String(Math.round(((i + 1) * value.quarter_goal) / 3));

  // Validation warnings — don't block save; just surface inconsistencies so
  // the user can sanity-check their split. Cumulative targets should be
  // monotonically non-decreasing and should land at the quarter goal by M3.
  const warnings: string[] = [];
  if (!meta.locked) {
    if (filled[0] > filled[1]) {
      warnings.push(
        `${months[0]} (${display(filled[0])}) is greater than ${months[1]} (${display(filled[1])}) — cumulative targets shouldn't go backwards.`,
      );
    }
    if (filled[1] > filled[2]) {
      warnings.push(
        `${months[1]} (${display(filled[1])}) is greater than ${months[2]} (${display(filled[2])}).`,
      );
    }
    if (Math.abs(filled[2] - value.quarter_goal) > 0.0001) {
      warnings.push(
        `${months[2]} (${display(filled[2])}) doesn't match the quarter goal (${display(value.quarter_goal)}).`,
      );
    }
  }

  return (
    <>
      <tr className="border-t">
        <td className="px-3 py-2 align-top">
          <div className="font-medium">{meta.label}</div>
          <div className="text-[11px] text-muted-foreground">{meta.hint}</div>
        </td>
        <td className="px-3 py-2 align-top">
          {canEdit ? (
            <Input
              type="number"
              value={value.quarter_goal}
              onChange={(e) => onQuarterChange(e.target.value)}
              className="h-8 text-sm w-32"
            />
          ) : (
            <span className="text-sm">{display(value.quarter_goal)}</span>
          )}
        </td>
        {([0, 1, 2] as const).map((i) => (
          <td key={i} className="px-3 py-2 align-top">
            {meta.locked ? (
              <span className="text-xs text-muted-foreground italic">
                {display(value.quarter_goal)} (locked)
              </span>
            ) : canEdit ? (
              <Input
                type="number"
                value={value.month_goals[i] ?? ""}
                onChange={(e) => onMonthChange(i, e.target.value)}
                placeholder={placeholder(i)}
                className="h-8 text-sm w-28"
              />
            ) : (
              <span className="text-sm">
                {value.month_goals[i] == null ? (
                  <span className="text-muted-foreground italic">
                    {display(filled[i])} (auto)
                  </span>
                ) : (
                  display(value.month_goals[i])
                )}
              </span>
            )}
          </td>
        ))}
        <td className="px-3 py-2 align-top text-right">
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={onReset}
              title="Reset this metric to default"
            >
              Reset
            </Button>
          )}
        </td>
      </tr>
      {warnings.length > 0 && (
        <tr className="border-t-0">
          <td
            colSpan={6}
            className="px-3 pb-2 pt-0 text-[11px] text-amber-700 dark:text-amber-400"
          >
            <div className="rounded-sm bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-2 py-1 space-y-0.5">
              {warnings.map((w, idx) => (
                <div key={idx}>⚠ {w}</div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ----- Historical view (weekly snapshots) ------------------------------------

function HistoricalView() {
  const [snapshots, setSnapshots] = useState<DashboardSnapshot[]>(() =>
    loadSnapshots(),
  );
  // When set, we drill into a single snapshot's detail page (frozen view of
  // that week). Empty string = list view. Using the week_start as the id.
  const [selectedWeek, setSelectedWeek] = useState<string>("");

  function refresh() {
    setSnapshots(loadSnapshots());
  }

  function handleDelete(weekStart: string) {
    if (!window.confirm(`Delete snapshot for week of ${weekStart}?`)) return;
    deleteSnapshot(weekStart);
    refresh();
  }

  if (selectedWeek) {
    const snap = snapshots.find((s) => s.week_start === selectedWeek);
    if (!snap) {
      // Snapshot was deleted out from under us — bounce back to the list.
      setSelectedWeek("");
      return null;
    }
    const idx = snapshots.findIndex((s) => s.week_start === selectedWeek);
    const prev = snapshots[idx + 1];
    return (
      <SnapshotDetailView
        snapshot={snap}
        previous={prev}
        onBack={() => setSelectedWeek("")}
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Historical Snapshots</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            One snapshot per ISO week, captured automatically the first time
            you load the dashboard each week. Each row shows the week's KPI
            values and the delta vs the previous week. Click a row to see
            the frozen dashboard from that week.
          </p>
        </div>

        {snapshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No snapshots yet — one will be captured the next time you load
            the dashboard with metrics available.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Week of</th>
                  <th className="px-3 py-2 font-medium">Quarter</th>
                  {SNAPSHOT_METRIC_LABELS.map((c) => (
                    <th
                      key={c.key}
                      className="px-3 py-2 font-medium text-right whitespace-nowrap"
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snap, idx) => {
                  // Snapshots are newest-first → previous = next index.
                  const prev = snapshots[idx + 1];
                  return (
                    <tr
                      key={snap.week_start}
                      className="border-t cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => setSelectedWeek(snap.week_start)}
                      title="Click to view the frozen dashboard from this week"
                    >
                      <td className="px-3 py-2 whitespace-nowrap font-medium">
                        {snap.week_start}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {snap.quarter}
                      </td>
                      {SNAPSHOT_METRIC_LABELS.map((c) => (
                        <td
                          key={c.key}
                          className="px-3 py-2 text-right tabular-nums whitespace-nowrap"
                        >
                          <div>{formatSnap(snap.metrics[c.key], c.format)}</div>
                          {prev && (
                            <DeltaPill
                              current={snap.metrics[c.key]}
                              previous={prev.metrics[c.key]}
                              format={c.format}
                            />
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            // Don't drill in when clicking the delete icon.
                            e.stopPropagation();
                            handleDelete(snap.week_start);
                          }}
                          title="Delete this snapshot"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Frozen single-snapshot view. Renders the KPI tiles + milestones + quote
 * exactly as captured at 11:59 Monday of that week. Pure read-only — no
 * editing, no live data fetches. Goal context is pulled from the current
 * goal store keyed by the snapshot's quarter (we don't snapshot goals
 * because they're owner-set and rarely change mid-quarter).
 */
function SnapshotDetailView({
  snapshot,
  previous,
  onBack,
}: {
  snapshot: DashboardSnapshot;
  previous?: DashboardSnapshot;
  onBack: () => void;
}) {
  // Pull live goals for the captured quarter so the user has context for
  // each KPI. If the snapshot's quarter has been retconned the numbers
  // shown here will use the latest goal — that's fine because the actuals
  // are immutable.
  const goals = useMemo(() => getQuarterGoals(snapshot.quarter), [snapshot.quarter]);
  const monthIdx = currentMonthIndex(snapshot.quarter, new Date(snapshot.snapshot_date));

  const cumulativeGoalAt = (key: MetricKey): number => {
    const g = goals[key];
    const filled = fillMonthGoals(g);
    if (monthIdx == null) return g.quarter_goal;
    return filled[monthIdx];
  };

  // Map snapshot metric key → matching goal key (where one exists).
  // Some snapshot metrics (e.g. qtd_billing) line up 1:1; others are
  // computed and not goal-backed.
  const goalKeyFor: Partial<Record<keyof DashboardSnapshot["metrics"], MetricKey>> = {
    arr: "arr",
    new_customers_qtd: "new_customers",
    new_customer_amount_qtd: "new_sales",
    pipeline_amount: "total_active_pipeline",
    renewals_amount_qtd: "renewals_number",
    nrr_by_customer_pct: "nrr_customer_pct",
    nrr_by_dollar_pct: "nrr_dollar_pct",
    sql_qtd: "sql",
    mql_unique_qtd: "mql",
    qtd_billing: "qtd_billing_progress",
  };

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="-ml-2 h-7 px-2 text-xs"
            >
              ← Back to all snapshots
            </Button>
            <h2 className="text-lg font-semibold">
              Dashboard snapshot — week of {snapshot.week_start}
            </h2>
            <p className="text-xs text-muted-foreground">
              {snapshot.quarter} · captured {snapshot.snapshot_date} ·
              this is the frozen view from that Monday at 11:59 — not live
              data
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SNAPSHOT_METRIC_LABELS.map((c) => {
            const actual = snapshot.metrics[c.key];
            const prevVal = previous ? previous.metrics[c.key] : null;
            const gk = goalKeyFor[c.key];
            const goalVal = gk ? cumulativeGoalAt(gk) : null;
            return (
              <div
                key={c.key}
                className="rounded-md border bg-card p-3 space-y-1"
              >
                <div className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  {c.label}
                </div>
                <div className="text-xl font-semibold tabular-nums">
                  {formatSnap(actual, c.format)}
                </div>
                <div className="flex items-center gap-2">
                  {goalVal != null && (
                    <span className="text-[11px] text-muted-foreground">
                      goal {formatSnap(goalVal, c.format)}
                    </span>
                  )}
                  {prevVal != null && (
                    <DeltaPill
                      current={actual}
                      previous={prevVal}
                      format={c.format}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {snapshot.milestones.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Milestones at the time</h3>
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Project</th>
                    <th className="px-3 py-2 font-medium">Completion date</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.milestones.map((m) => {
                    const status = deriveStatus(m);
                    const tone =
                      STATUS_TONES[status] ??
                      "bg-slate-100 text-slate-700";
                    return (
                      <tr key={m.id} className="border-t">
                        <td className="px-3 py-2">{m.project || "—"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {m.completion_date || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
                          >
                            {status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {(snapshot.quote_text || snapshot.quote_author) && (
          <div className="rounded-md border bg-muted/30 p-4 space-y-1">
            {snapshot.quote_text && (
              <p className="text-sm italic">"{snapshot.quote_text}"</p>
            )}
            {snapshot.quote_author && (
              <p className="text-[11px] text-muted-foreground">
                — {snapshot.quote_author}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatSnap(
  v: number,
  format: "currency" | "count" | "percent",
): string {
  if (!Number.isFinite(v)) return "—";
  if (format === "currency") return formatCurrency(v);
  if (format === "percent") return `${v.toFixed(1)}%`;
  return String(Math.round(v));
}

function DeltaPill({
  current,
  previous,
  format,
}: {
  current: number;
  previous: number;
  format: "currency" | "count" | "percent";
}) {
  const delta = current - previous;
  if (!Number.isFinite(delta) || delta === 0) {
    return (
      <div className="text-[10px] text-muted-foreground">±0</div>
    );
  }
  const positive = delta > 0;
  const tone = positive
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-red-600 dark:text-red-400";
  const sign = positive ? "+" : "−";
  const abs = Math.abs(delta);
  let body: string;
  if (format === "currency") body = formatCurrency(abs);
  else if (format === "percent") body = `${abs.toFixed(1)}%`;
  else body = String(Math.round(abs));
  return <div className={`text-[10px] ${tone}`}>{sign}{body}</div>;
}
