import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  GripVertical,
  RefreshCw,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import {
  loadCardOrder,
  saveCardOrder,
  type CardOrder,
  type DashboardSectionId,
} from "@/features/reports/dashboardCardOrder";

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

/**
 * Year-over-year NRR from v_dashboard_arr_financial. The QoQ NRR
 * fields on v_dashboard_metrics (nrr_by_customer_true_pct etc.)
 * compare current-quarter churn against the customer base AT THE
 * START of the same quarter — which is null/0 for any account whose
 * first deal was inside the quarter, producing 0% NRR cards. The
 * external Codex dashboard (and the canonical SaaS metric) uses YoY:
 * customer base = active 365 days ago, churn = base minus active
 * today. Source the live point from there so live NRR matches what
 * the rest of the org sees.
 */
interface ArrFinancialRow {
  arr: number | null;
  nrr_customer_pct: number | null;
  nrr_dollar_pct: number | null;
  customer_base_count: number | null;
  customer_base_arr: number | null;
  lost_count_rolling_365: number | null;
  lost_amount_rolling_365: number | null;
}

function useArrFinancial() {
  return useQuery({
    queryKey: ["team-dashboard", "arr-financial"],
    queryFn: async (): Promise<ArrFinancialRow | null> => {
      const { data, error } = await supabase
        .from("v_dashboard_arr_financial")
        .select(
          "arr, nrr_customer_pct, nrr_dollar_pct, customer_base_count, customer_base_arr, lost_count_rolling_365, lost_amount_rolling_365",
        )
        .maybeSingle();
      if (error) throw error;
      return data as ArrFinancialRow | null;
    },
  });
}

/**
 * Latest snapshot from the `clickup-services-sync` Edge Function. Writes
 * one row per daily run to `clickup_services_snapshots`; we read the most
 * recent. Surfaces the same Services-section metrics the external Python
 * dashboard's `compute_services_from_clickup` produced.
 */
interface ClickUpServicesSnapshot {
  captured_at: string;
  quarter_label: string | null;
  task_count: number;
  active_projects: number;
  closed_projects_this_quarter: number;
  closed_projects_sra_final_quarter: number;
  avg_project_close_days_qtd: number;
  close_day_sample_count: number;
  overall_project_status: "green" | "red";
  red_item_threshold: number | null;
  projects_over_red_threshold: { project: string; red_items: number }[];
  status_breakdown: { status: string; count: number }[];
  closed_projects_quarter_names: string[];
  sra_final_quarter_names: string[];
}

function useClickUpServices() {
  return useQuery({
    queryKey: ["team-dashboard", "clickup-services"],
    queryFn: async (): Promise<ClickUpServicesSnapshot | null> => {
      const { data, error } = await supabase
        .from("clickup_services_snapshots")
        .select(
          "captured_at, quarter_label, task_count, active_projects, closed_projects_this_quarter, closed_projects_sra_final_quarter, avg_project_close_days_qtd, close_day_sample_count, overall_project_status, red_item_threshold, projects_over_red_threshold, status_breakdown, closed_projects_quarter_names, sra_final_quarter_names",
        )
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as ClickUpServicesSnapshot | null;
    },
  });
}

/**
 * Manual refresh trigger — invokes the `clickup-services-sync` Edge
 * Function, which pulls every task on the configured ClickUp list,
 * recomputes the Services metrics, and writes a new snapshot row.
 * Invalidates the latest-snapshot query on success so the panel re-reads.
 */
function useRefreshClickUpServices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "clickup-services-sync",
        { body: {} },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-dashboard", "clickup-services"] });
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

/**
 * Hard-coded historical end-of-quarter values for charts that pre-date
 * the new CRM's snapshot history. Sourced from the external Codex
 * Team Dashboard so the line picks up at the same place it left off.
 *
 * The current (in-progress) quarter is NEVER seeded here — that always
 * comes from live metrics so the rightmost point reflects today.
 *
 * Add a quarter once it's complete and the value is final; remove it
 * when weekly snapshot history covers the same quarter.
 */
const HISTORICAL_TREND_SEED: Record<
  keyof DashboardSnapshot["metrics"],
  Record<string, number>
> = {
  arr: {},
  new_customers_qtd: {},
  new_customer_amount_qtd: {},
  pipeline_amount: {
    "Q1-2026": 877123,
  },
  renewals_amount_qtd: {},
  nrr_by_customer_pct: {
    "Q2-2025": 74.4,
    "Q3-2025": 91.3,
    "Q4-2025": 87.7,
    "Q1-2026": 88.8,
  },
  nrr_by_dollar_pct: {
    "Q2-2025": 84.1,
    "Q3-2025": 93.3,
    "Q4-2025": 84.0,
    "Q1-2026": 94.3,
  },
  sql_qtd: {},
  mql_unique_qtd: {},
  qtd_billing: {},
};

/**
 * Build the ARR quarterly chart points from the `v_arr_rolling_365`
 * monthly time-series. Pulled out of the live dashboard so the
 * Historical snapshot view can render the SAME chart as of an earlier
 * date — passing `capDate` (an ISO YYYY-MM-DD string) drops any
 * months strictly after that date and treats the latest month at or
 * before the cap as the "current" in-progress quarter point.
 */
export function buildArrPoints(
  arrTrend: { month_start: string; trailing_365_arr: number | string }[],
  goalArr: number,
  capDate?: string,
): SegmentPoint[] {
  if (!arrTrend || arrTrend.length === 0) return [];
  const trend = capDate
    ? arrTrend.filter((p) => p.month_start <= capDate)
    : arrTrend;
  if (trend.length === 0) return [];
  // End-of-quarter month for each calendar quarter is month index
  // 2 (Mar), 5 (Jun), 8 (Sep), 11 (Dec). Filter monthly rows to those.
  const eoq = trend.filter((p) => {
    const d = new Date(p.month_start);
    const m = d.getUTCMonth();
    return m === 2 || m === 5 || m === 8 || m === 11;
  });
  // Start at Q2-2025 (June 2025 — month_start '2025-06-01') going forward.
  const WINDOW_START = "2025-06-01";
  const completed = eoq.filter((p) => p.month_start >= WINDOW_START);
  // Append the current in-progress quarter using the latest available
  // monthly row at/before the cap (only if it isn't already an EOQ row
  // already captured above).
  const last = trend[trend.length - 1];
  const lastIsEoq = (() => {
    const m = new Date(last.month_start).getUTCMonth();
    return m === 2 || m === 5 || m === 8 || m === 11;
  })();
  const points: typeof trend = [...completed];
  if (!lastIsEoq && last.month_start >= WINDOW_START) {
    points.push(last);
  }
  return points.map((p) => {
    const d = new Date(p.month_start);
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    const label = `Q${q}-${d.getUTCFullYear()}`;
    return {
      label,
      actual: Number(p.trailing_365_arr) || 0,
      goal: goalArr,
    } as SegmentPoint;
  });
}

/**
 * Build a quarterly trend (one point per calendar quarter, Q2-2025 → today)
 * from weekly snapshots. Mirrors the `arrPoints` window logic so the
 * Pipeline / NRR charts share the same X-axis as the ARR chart.
 *
 * For each quarter we keep the LAST snapshot in that quarter (closest
 * to end-of-quarter). The current quarter always shows the latest
 * snapshot so the line keeps moving forward instead of dropping off.
 *
 * If a quarter has no snapshot, fall back to HISTORICAL_TREND_SEED so
 * the line still extends back to Q2-2025 even on a fresh install.
 */
function quarterlySnapshotTrend(
  snapshots: DashboardSnapshot[],
  metricKey: keyof DashboardSnapshot["metrics"],
  goal: number,
): SegmentPoint[] {
  if (snapshots.length === 0) return [];
  const WINDOW_START_YEAR = 2025;
  const WINDOW_START_Q = 2;

  // Group by quarter, keep the latest snapshot per quarter (sorted by week_start ASC).
  const sorted = [...snapshots].sort((a, b) =>
    a.week_start.localeCompare(b.week_start),
  );
  const lastPerQuarter = new Map<string, DashboardSnapshot>();
  for (const s of sorted) {
    lastPerQuarter.set(s.quarter, s);
  }

  // Build ordered list of quarter labels from window start through today.
  const today = new Date();
  const currentYear = today.getUTCFullYear();
  const currentQuarter = Math.floor(today.getUTCMonth() / 3) + 1;

  const seed = HISTORICAL_TREND_SEED[metricKey] ?? {};
  const points: SegmentPoint[] = [];
  for (let y = WINDOW_START_YEAR; y <= currentYear; y++) {
    const startQ = y === WINDOW_START_YEAR ? WINDOW_START_Q : 1;
    const endQ = y === currentYear ? currentQuarter : 4;
    for (let q = startQ; q <= endQ; q++) {
      const label = `Q${q}-${y}`;
      const snap = lastPerQuarter.get(label);
      if (snap) {
        const value = Number(snap.metrics[metricKey]) || 0;
        points.push({ label, actual: value, goal });
        continue;
      }
      // Fall back to a hardcoded historical value for completed quarters
      // so brand-new installs (or any owner without 12 months of weekly
      // snapshots) still see the trend going back to Q2-2025.
      const seeded = seed[label];
      const isCurrent = y === currentYear && q === currentQuarter;
      if (!isCurrent && typeof seeded === "number") {
        points.push({ label, actual: seeded, goal });
      }
    }
  }
  return points;
}

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
  const { data: arrFin } = useArrFinancial();
  const { data: services } = useClickUpServices();
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
  const arrPoints = useMemo<SegmentPoint[]>(
    () => buildArrPoints(arrTrend ?? [], goals.arr),
    [arrTrend, goals.arr],
  );

  // Snapshots feed the historical-trend charts (Pipeline, NRR). Loaded
  // once on mount, refreshed whenever a new weekly snapshot is captured
  // so today's row appears on the chart immediately.
  const [snapshots, setSnapshots] = useState<DashboardSnapshot[]>(() =>
    loadSnapshots(),
  );

  // Capture a weekly snapshot once per ISO week the first time the
  // dashboard renders with real metrics that week. Idempotent — safe
  // to call on every render. Owner-only: writing snapshots from the
  // team-view session would pollute history with the wrong author.
  useEffect(() => {
    if (!isOwnerAccount || !m) return;
    const newSnap = captureWeeklySnapshotIfNeeded({
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
      // Freeze the live goals into the snapshot so the historical view
      // shows the targets that were in effect THAT week. Without this,
      // retconning a quarter's goals retroactively changes every past
      // snapshot's progress bars and chart goal lines.
      goals: qgoals,
    });
    if (newSnap) setSnapshots(loadSnapshots());
  }, [isOwnerAccount, m, milestones, widgets, qgoals]);

  // Quarterly trend points sourced from snapshots, with the current
  // quarter overridden by the live metric so the rightmost point always
  // reflects the current dashboard value (snapshots only capture weekly).
  const pipelineTrendPoints = useMemo<SegmentPoint[]>(() => {
    const base = quarterlySnapshotTrend(
      snapshots,
      "pipeline_amount",
      goals.total_active_pipeline,
    );
    if (!m) return base;
    const live: SegmentPoint = {
      label: currentQuarter,
      actual: num(m.pipeline_amount),
      goal: goals.total_active_pipeline,
    };
    const idx = base.findIndex((p) => p.label === currentQuarter);
    if (idx >= 0) base[idx] = live;
    else base.push(live);
    return base;
  }, [snapshots, goals.total_active_pipeline, m, currentQuarter]);

  const nrrCustomerTrendPoints = useMemo<SegmentPoint[]>(() => {
    const base = quarterlySnapshotTrend(
      snapshots,
      "nrr_by_customer_pct",
      goals.nrr_customer_pct,
    );
    // Prefer YoY NRR from v_dashboard_arr_financial (matches external
    // Codex dashboard). Fall back to QoQ if the YoY view returns null.
    const yoy = arrFin?.nrr_customer_pct;
    const liveValue =
      yoy != null
        ? Number(yoy)
        : num(m?.nrr_by_customer_true_pct ?? m?.nrr_by_customer_legacy_pct);
    if (!m && yoy == null) return base;
    const live: SegmentPoint = {
      label: currentQuarter,
      actual: liveValue,
      goal: goals.nrr_customer_pct,
    };
    const idx = base.findIndex((p) => p.label === currentQuarter);
    if (idx >= 0) base[idx] = live;
    else base.push(live);
    return base;
  }, [snapshots, goals.nrr_customer_pct, m, arrFin, currentQuarter]);

  const nrrDollarTrendPoints = useMemo<SegmentPoint[]>(() => {
    const base = quarterlySnapshotTrend(
      snapshots,
      "nrr_by_dollar_pct",
      goals.nrr_dollar_pct,
    );
    const yoy = arrFin?.nrr_dollar_pct;
    const liveValue =
      yoy != null
        ? Number(yoy)
        : num(m?.nrr_by_dollar_true_pct ?? m?.nrr_by_dollar_legacy_pct);
    if (!m && yoy == null) return base;
    const live: SegmentPoint = {
      label: currentQuarter,
      actual: liveValue,
      goal: goals.nrr_dollar_pct,
    };
    const idx = base.findIndex((p) => p.label === currentQuarter);
    if (idx >= 0) base[idx] = live;
    else base.push(live);
    return base;
  }, [snapshots, goals.nrr_dollar_pct, m, arrFin, currentQuarter]);

  // ---- Drag-and-drop card ordering ----
  // Each section (Sales / Marketing / CS) has its own sortable list
  // persisted to localStorage. Owners can drag cards within a section
  // via the grip handle that appears on hover. Cross-section drags
  // aren't supported intentionally — the section grouping is part of
  // the dashboard's information architecture (Codex parity).
  const [cardOrder, setCardOrder] = useState<CardOrder>(() => loadCardOrder());
  useEffect(() => {
    saveCardOrder(cardOrder);
  }, [cardOrder]);

  const dndSensors = useSensors(
    // 6px activation distance keeps clicks (e.g. KpiCard pencils, chart
    // tooltips) from accidentally starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleCardDragEnd(section: DashboardSectionId, e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setCardOrder((prev) => {
      const ids = prev[section];
      const from = ids.indexOf(String(active.id));
      const to = ids.indexOf(String(over.id));
      if (from < 0 || to < 0) return prev;
      return { ...prev, [section]: arrayMove(ids, from, to) };
    });
  }

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
  const pipeline = num(m.pipeline_amount);
  const renewalsClosedAmt = num(m.renewals_amount_qtd);
  // Prefer YoY NRR from v_dashboard_arr_financial; fall back to QoQ
  // from v_dashboard_metrics if the YoY view is null. See useArrFinancial.
  const nrrCust =
    arrFin?.nrr_customer_pct != null
      ? Number(arrFin.nrr_customer_pct)
      : num(m.nrr_by_customer_true_pct ?? m.nrr_by_customer_legacy_pct);
  const nrrDollar =
    arrFin?.nrr_dollar_pct != null
      ? Number(arrFin.nrr_dollar_pct)
      : num(m.nrr_by_dollar_true_pct ?? m.nrr_by_dollar_legacy_pct);

  return (
    <div className="space-y-2" data-dashboard-print-root>
      {tabBar}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-lg font-bold tracking-tight">Team Dashboard</h2>
          <p className="text-[11px] text-muted-foreground">
            Fiscal {m.fiscal_period} ({m.fiscal_quarter_start} → {m.fiscal_quarter_end})
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          Updated {new Date(m.computed_at).toLocaleString()}
        </span>
      </div>

      {/* ----- Sales -----
          Codex-parity layout: KPI directly above its chart (ARR | New
          Customers stacked on top row), then New Sales | Pipeline side by
          side below. Cards are individually draggable for the owner so
          the layout can be tuned per personal preference. */}
      <SectionWrap
        title="Sales"
        tone="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/40 dark:to-blue-900/20"
        accent="bg-blue-500"
      >
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => handleCardDragEnd("sales", e)}
        >
          <SortableContext
            items={cardOrder.sales}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {cardOrder.sales.map((id) => (
                <SortableCard key={id} id={id} enabled={isOwner}>
                  {id === "arr" && (
                    <div className="space-y-2">
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
                        showGoal={false}
                      />
                      {arrPoints.length > 0 && (
                        <ChartCard title="ARR by Quarter">
                          <ChartLegend showGoal={false} />
                          <SegmentedLineChart
                            data={arrPoints}
                            yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                            tooltipFormatter={(v) => formatCurrency(v)}
                            height={145}
                            showGoal={false}
                            lineColor="#3b82f6"
                          />
                        </ChartCard>
                      )}
                    </div>
                  )}

                  {id === "new_customers" && (
                    <div className="space-y-2">
                      <KpiCard
                        label="New Customers QTD"
                        value={String(newCustomers)}
                        progress={pct(newCustomers, goals.new_customers)}
                        goal={goals.new_customers}
                        formatGoal={(v) => String(v)}
                        onGoalChange={(v) =>
                          setGoalQuarter("new_customers", v)
                        }
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
                            height={145}
                          />
                          {isOwner && (
                            <MonthSplitInline
                              metricKey="new_customers"
                              quarter={currentQuarter}
                              onSaved={() =>
                                setQgoals(getQuarterGoals(currentQuarter))
                              }
                            />
                          )}
                        </ChartCard>
                      )}
                    </div>
                  )}

                  {id === "new_sales" && (
                    <div className="space-y-2">
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
                            yFormatter={(v) =>
                              `$${(v / 1000).toFixed(0)}k`
                            }
                            tooltipFormatter={(v) => formatCurrency(v)}
                            height={145}
                          />
                          {isOwner && (
                            <MonthSplitInline
                              metricKey="new_sales"
                              quarter={currentQuarter}
                              onSaved={() =>
                                setQgoals(getQuarterGoals(currentQuarter))
                              }
                            />
                          )}
                        </ChartCard>
                      )}
                    </div>
                  )}

                  {id === "pipeline" && (
                    <div className="space-y-2">
                      {pipelineTrendPoints.length > 0 ? (
                        <ChartCard
                          title={`Active Pipeline by Quarter — goal ${formatCurrency(goals.total_active_pipeline)}`}
                          subtitle={`Now: ${formatCurrency(pipeline)} • ${m.pipeline_count ?? 0} open • weighted ${formatCurrency(num(m.pipeline_weighted_amount))}`}
                        >
                          <ChartLegend />
                          <SegmentedLineChart
                            data={pipelineTrendPoints}
                            yFormatter={(v) =>
                              `$${(v / 1000).toFixed(0)}k`
                            }
                            tooltipFormatter={(v) => formatCurrency(v)}
                            height={145}
                          />
                        </ChartCard>
                      ) : (
                        <ChartCard
                          title={`Active Pipeline — goal ${formatCurrency(goals.total_active_pipeline)}`}
                          subtitle={`Now: ${formatCurrency(pipeline)} • ${m.pipeline_count ?? 0} open • weighted ${formatCurrency(num(m.pipeline_weighted_amount))}. Trend will fill in as weekly snapshots accumulate.`}
                        >
                          <div className="h-[220px] flex items-center justify-center text-xs text-muted-foreground">
                            No history yet.
                          </div>
                        </ChartCard>
                      )}
                    </div>
                  )}
                </SortableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </SectionWrap>

      {/* ----- Marketing (graphs-only per Codex parity) ----- */}
      <SectionWrap
        title="Marketing"
        tone="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/40 dark:to-purple-900/20"
        accent="bg-purple-500"
      >
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => handleCardDragEnd("marketing", e)}
        >
          <SortableContext
            items={cardOrder.marketing}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {cardOrder.marketing.map((id) => (
                <SortableCard key={id} id={id} enabled={isOwner}>
                  {id === "sql" && sqlRunning.length > 1 && (
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
                        height={145}
                      />
                      {isOwner && (
                        <MonthSplitInline
                          metricKey="sql"
                          quarter={currentQuarter}
                          onSaved={() =>
                            setQgoals(getQuarterGoals(currentQuarter))
                          }
                        />
                      )}
                    </ChartCard>
                  )}
                  {id === "mql" && mqlRunning.length > 1 && (
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
                        height={145}
                      />
                      {isOwner && (
                        <MonthSplitInline
                          metricKey="mql"
                          quarter={currentQuarter}
                          onSaved={() =>
                            setQgoals(getQuarterGoals(currentQuarter))
                          }
                        />
                      )}
                    </ChartCard>
                  )}
                </SortableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </SectionWrap>

      {/* ----- Customer Success ----- */}
      <SectionWrap
        title="Customer Success"
        tone="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20"
        accent="bg-emerald-500"
      >
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragEnd={(e) => handleCardDragEnd("cs", e)}
        >
          <SortableContext
            items={cardOrder.cs}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {cardOrder.cs.map((id) => (
                <SortableCard key={id} id={id} enabled={isOwner}>
                  {id === "renewals" && (
                    <div className="space-y-2">
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
                          {(() => {
                            const ticks = fixedStepTicks(
                              renewalsClosedRunning,
                              20_000,
                            );
                            return (
                              <SegmentedLineChart
                                data={renewalsClosedRunning}
                                yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                                tooltipFormatter={(v) => formatCurrency(v)}
                                height={145}
                                yDomain={[0, ticks[ticks.length - 1]]}
                                yTicks={ticks}
                              />
                            );
                          })()}
                          {isOwner && (
                            <MonthSplitInline
                              metricKey="renewals_number"
                              quarter={currentQuarter}
                              onSaved={() =>
                                setQgoals(getQuarterGoals(currentQuarter))
                              }
                            />
                          )}
                        </ChartCard>
                      )}
                    </div>
                  )}

                  {id === "qtd_billing" && (
                    <KpiCard
                      label="QTD Billing Goal"
                      value={formatCurrency(
                        num(m.new_customer_amount_qtd) + renewalsClosedAmt,
                      )}
                      progress={pct(
                        num(m.new_customer_amount_qtd) + renewalsClosedAmt,
                        goals.qtd_billing,
                      )}
                      goal={goals.qtd_billing}
                      formatGoal={formatCurrency}
                      onGoalChange={(v) => setGoalQuarter("qtd_billing_progress", v)}
                      editable={isOwner}
                      hint="New Sales $ QTD + Renewals Closed $ QTD."
                    />
                  )}
                  {id === "nrr_customer" && (
                    <div className="space-y-2">
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
                      {nrrCustomerTrendPoints.length > 0 && (
                        <ChartCard
                          title={`NRR by Customer — quarterly (goal ${goals.nrr_customer_pct}%)`}
                          subtitle={
                            nrrCustomerTrendPoints.length === 1
                              ? "Trend will fill in as weekly snapshots accumulate."
                              : undefined
                          }
                        >
                          <ChartLegend />
                          <SegmentedLineChart
                            data={nrrCustomerTrendPoints}
                            yFormatter={(v) => `${v.toFixed(0)}%`}
                            tooltipFormatter={(v) => `${v.toFixed(1)}%`}
                            height={140}
                            yDomain={[60, 100]}
                            yTicks={[60, 65, 70, 75, 80, 85, 90, 95, 100]}
                          />
                        </ChartCard>
                      )}
                    </div>
                  )}
                  {id === "nrr_dollar" && (
                    <div className="space-y-2">
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
                      {nrrDollarTrendPoints.length > 0 && (
                        <ChartCard
                          title={`NRR by Dollar — quarterly (goal ${goals.nrr_dollar_pct}%)`}
                          subtitle={
                            nrrDollarTrendPoints.length === 1
                              ? "Trend will fill in as weekly snapshots accumulate."
                              : undefined
                          }
                        >
                          <ChartLegend />
                          <SegmentedLineChart
                            data={nrrDollarTrendPoints}
                            yFormatter={(v) => `${v.toFixed(0)}%`}
                            tooltipFormatter={(v) => `${v.toFixed(1)}%`}
                            height={140}
                            yDomain={[60, 100]}
                            yTicks={[60, 65, 70, 75, 80, 85, 90, 95, 100]}
                          />
                        </ChartCard>
                      )}
                    </div>
                  )}
                </SortableCard>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </SectionWrap>

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
      <SectionWrap
        title="Services"
        tone="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/40 dark:to-amber-900/20"
        accent="bg-amber-500"
      >
        <ServicesPanel services={services ?? null} isOwner={isOwner} />
      </SectionWrap>

      {/* ----- Development (manual milestones) ----- */}
      <SectionWrap
        title="Development"
        tone="bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-950/40 dark:to-rose-900/20"
        accent="bg-rose-500"
      >
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
 * Generate Y-axis ticks at a fixed step from 0 up to the next step
 * boundary above the max value in the data set. Used by currency
 * running-total charts (renewals, new sales) where the user prefers
 * evenly-spaced increments (20k for renewals) over Recharts' default
 * auto-ticks, which can produce big jumps when data is sparse.
 */
function fixedStepTicks(points: SegmentPoint[], step: number): number[] {
  if (points.length === 0) return [0];
  let max = 0;
  for (const p of points) {
    if (Number.isFinite(p.actual) && p.actual > max) max = p.actual;
    if (Number.isFinite(p.goal) && p.goal > max) max = p.goal;
  }
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
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
  // Parse YYYY-MM-DD as LOCAL time (not UTC). `new Date("2026-04-01")`
  // is interpreted as midnight UTC, which becomes the previous day in
  // any negative-UTC timezone — so `getMonth()` returns March instead
  // of April for Q2 starts. This used to make the New Customers /
  // Renewals / SQL / MQL charts label months as Mar/Apr/May in PT
  // during Q2. Splitting the parts forces local-midnight construction.
  const start = parseLocalDate(quarterStart);
  const end = parseLocalDate(quarterEnd);
  if (
    !start ||
    !end ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime())
  ) {
    return [];
  }

  const sorted = [...events]
    .filter((e) => e.date >= quarterStart && e.date <= quarterEnd)
    .sort((a, b) => a.date.localeCompare(b.date));

  // The 3 calendar months of the current fiscal quarter. Use the start
  // month as M1 — this matches Codex's labels (e.g., Q1 → Jan/Feb/Mar).
  // monthGoals are cumulative end-of-month-N targets — admin can set
  // per-month targets in Goals page (else default to even thirds).
  //
  // Always emit all 3 month labels (Apr/May/Jun) so the X-axis stays
  // consistent quarter-over-quarter, but leave `actual = null` for any
  // month that hasn't started yet — the chart skips dots/segments for
  // null actuals. Goal line keeps drawing across all 3 so the user can
  // still see the trajectory needed to hit quarter.
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const points: SegmentPoint[] = [];
  for (let i = 0; i < 3; i++) {
    const monthStart = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const monthEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, 0);
    const inFuture = monthStart > today;
    // Don't extend past quarter end (e.g., short quarters / off-by-one).
    const cap = monthEnd > end ? end : monthEnd;
    // Format the cap date in local time. toISOString() converts to UTC
    // which drifts the date in negative-UTC timezones (Apr 30 PT
    // becomes May 1 UTC).
    const capStr = formatLocalDate(cap);

    const cumulative = inFuture
      ? null
      : sorted.filter((e) => e.date <= capStr).reduce((s, e) => s + e.value, 0);

    points.push({
      label: monthStart.toLocaleString("en-US", { month: "short" }),
      // actual is typed `number` on SegmentPoint but the chart tolerates
      // null and renders no dot for that index — cast through unknown.
      actual: cumulative as unknown as number,
      goal: monthGoals[i],
      // M1 (i=0) intentionally has no previousGoal → goalStatus
      // applies the M1 buffer (yellow, never red, when below goal).
      // M2 + M3 compare against the prior month's cumulative goal.
      previousGoal: i === 0 ? undefined : monthGoals[i - 1],
    });
  }
  return points;
}

/** Parse a "YYYY-MM-DD" string as a local-midnight Date. Returns null
 *  for malformed input. Avoids the `new Date("YYYY-MM-DD")` UTC trap. */
function parseLocalDate(s: string): Date | null {
  const parts = s.split("-");
  if (parts.length !== 3) return null;
  const [y, mo, d] = parts.map(Number);
  if (![y, mo, d].every((n) => Number.isFinite(n))) return null;
  return new Date(y, mo - 1, d);
}

/** Format a Date as "YYYY-MM-DD" in LOCAL time (mirror of toISOString
 *  but without the timezone shift). */
function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  accent,
}: {
  title: string;
  tone: string;
  children: React.ReactNode;
  /** Tailwind class for the left-edge accent bar (e.g. "bg-blue-500"). */
  accent?: string;
}) {
  // Compact, TV-friendly section panel:
  //  • Title sits inside the panel as a single tight row, no outer h3
  //  • Optional left-edge accent bar gives each section visual identity
  //    without taking extra vertical space.
  //  • px-3 py-1.5 + mb-1 title gap is the smallest legible footprint
  //    for a 1080p office TV at typical viewing distance.
  return (
    <div
      className={`relative rounded-lg px-3 py-1.5 shadow-sm ring-1 ring-black/[0.03] ${tone}`}
    >
      {accent && (
        <div
          className={`absolute left-0 top-2 bottom-2 w-1 rounded-full ${accent}`}
          aria-hidden="true"
        />
      )}
      <h3 className="text-[11px] font-semibold text-foreground/70 uppercase tracking-wider mb-1 pl-1.5">
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * Sortable wrapper for a dashboard card. Owner-only — when `enabled` is
 * false (team-view preview, snapshot detail, non-admin) we render the
 * children unwrapped so the drag affordances are completely invisible.
 *
 * The grip handle floats to the upper-left of each card and only
 * appears on hover, so the live dashboard isn't visually noisy. It is
 * also marked `print:hidden` so PDF exports don't capture it.
 */
function SortableCard({
  id,
  enabled,
  children,
}: {
  id: string;
  enabled: boolean;
  children: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !enabled });
  if (!enabled) return <>{children}</>;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="relative group/card">
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder card"
        title="Drag to reorder"
        className="absolute -left-2 top-2 z-20 hidden group-hover/card:flex items-center justify-center h-7 w-7 rounded-md bg-background/95 border border-border text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shadow-sm print:hidden"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </div>
  );
}

/** Legend explaining the R/Y/G segment coloring on the running-total charts. */
function ChartLegend({ showGoal = true }: { showGoal?: boolean }) {
  // ARR chart and other charts without a goal line want a simpler
  // legend (no "vs proportional goal" or "dashed line is the goal pace"
  // copy, since neither is rendered). Compact icon-only key — saves ~16px
  // vertical per chart vs the prior wordy paragraph, while staying
  // legible on the office TV.
  if (!showGoal) {
    return (
      <p className="text-[10px] text-muted-foreground mb-1 leading-none">
        Segments colored by quarter-over-quarter direction.
      </p>
    );
  }
  return (
    <p className="text-[10px] text-muted-foreground mb-1 leading-none">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle mr-1" />
      ≥90%
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle ml-2 mr-1" />
      50–89%
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle ml-2 mr-1" />
      &lt;50% · dashed = goal pace
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
  // Tighter padding (p-2.5) and a single-line title row make each chart
  // tile ~24px shorter than before. Subtitle pill (the M2 pace target)
  // stays full-saturation green so it remains the eye's natural focus.
  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h4 className="text-xs font-semibold text-foreground/80">{title}</h4>
          {subtitle && (
            <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2 py-0.5">
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
  showGoal = true,
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
  /** When false, hide the goal text, progress bar, and red/yellow/green
   *  status dot. Used by ARR which has no target. */
  showGoal?: boolean;
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
    <Card className="border-border/60 shadow-sm hover:shadow transition-shadow">
      <CardContent className="p-2.5 space-y-1.5">
        <div>
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 min-w-0">
              {showGoal && (
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
              )}
              <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide truncate">
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
          <p className="text-2xl font-bold leading-none tracking-tight tabular-nums">{value}</p>
        </div>
        {showGoal && (
          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full transition-all ${barClass}`}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        )}
        {showGoal && (
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
        )}
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

/**
 * Renders the Services section from the latest
 * `clickup_services_snapshots` row. Mirrors the layout of the external
 * Python team dashboard's Services card: three KPI tiles + a Project
 * Health donut + a status-breakdown chip strip (closed statuses filtered
 * out, same as the HTML view).
 */
function ServicesPanel({
  services,
  isOwner,
}: {
  services: ClickUpServicesSnapshot | null;
  isOwner: boolean;
}) {
  const refresh = useRefreshClickUpServices();
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const handleRefresh = () => {
    setRefreshError(null);
    refresh.mutate(undefined, {
      onError: (err: any) => {
        setRefreshError(err?.message ?? "Sync failed");
      },
    });
  };

  if (!services) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            No ClickUp snapshot yet. Once the daily sync runs (or you invoke{" "}
            <code>clickup-services-sync</code> manually), metrics will appear
            here.
          </p>
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={refresh.isPending}
            >
              <RefreshCw
                className={
                  "h-3.5 w-3.5 mr-1.5 " +
                  (refresh.isPending ? "animate-spin" : "")
                }
              />
              {refresh.isPending ? "Syncing…" : "Sync now"}
            </Button>
          )}
          {refreshError && (
            <p className="text-xs text-rose-600">{refreshError}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  const active = services.active_projects ?? 0;
  const flagged = (services.projects_over_red_threshold ?? []).length;
  const healthy = Math.max(active - flagged, 0);
  const breakdown = (services.status_breakdown ?? []).filter(
    (s) => s.status.trim().toLowerCase() !== "completed",
  );
  const isRed = services.overall_project_status === "red";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <ServicesKpi label="Active Projects" value={active} />
        <ServicesKpi
          label="Closed This Quarter"
          value={services.closed_projects_this_quarter ?? 0}
        />
        <ServicesKpi
          label="Avg Close Days (QTD)"
          value={Math.round(services.avg_project_close_days_qtd ?? 0)}
        />
        <ProjectHealthCard
          status={isRed ? "Red" : "Green"}
          healthy={healthy}
          atRisk={flagged}
          total={active}
        />
      </div>

      <Card>
        <CardContent className="p-3 space-y-2">
          <p className="text-xs text-muted-foreground font-medium">
            Project Status Breakdown
          </p>
          {breakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No status data.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {breakdown.map((s) => (
                <span
                  key={s.status}
                  className="text-xs px-2 py-1 rounded-full border bg-background"
                >
                  {s.status}: {s.count}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <p className="text-[10px] text-muted-foreground italic">
              Last sync: {new Date(services.captured_at).toLocaleString()}
            </p>
            {isOwner && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px]"
                onClick={handleRefresh}
                disabled={refresh.isPending}
                title="Pull fresh data from ClickUp"
              >
                <RefreshCw
                  className={
                    "h-3 w-3 mr-1 " +
                    (refresh.isPending ? "animate-spin" : "")
                  }
                />
                {refresh.isPending ? "Syncing…" : "Refresh"}
              </Button>
            )}
          </div>
          {refreshError && (
            <p className="text-xs text-rose-600">{refreshError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ServicesKpi({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          {label}
        </p>
        <p className="text-3xl font-semibold tabular-nums">
          {value.toLocaleString()}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Donut-style health indicator. Pure SVG (no chart-library) since we only
 * ever show a two-segment ring (healthy / at-risk) — recharts would be
 * overkill.
 */
function ProjectHealthCard({
  status,
  healthy,
  atRisk,
  total,
}: {
  status: "Green" | "Red";
  healthy: number;
  atRisk: number;
  total: number;
}) {
  const size = 88;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const denom = Math.max(healthy + atRisk, 1);
  const healthyLen = (healthy / denom) * c;
  const atRiskLen = (atRisk / denom) * c;
  const greenColor = "#16a34a";
  const redColor = "#dc2626";
  const isRed = status === "Red";

  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
            Project Health
          </p>
          <span
            className={
              "text-[10px] font-semibold px-2 py-0.5 rounded-full " +
              (isRed
                ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200")
            }
          >
            {status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="#e5e7eb"
              strokeWidth={stroke}
            />
            {healthy > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={greenColor}
                strokeWidth={stroke}
                strokeDasharray={`${healthyLen} ${c}`}
                strokeDashoffset={0}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )}
            {atRisk > 0 && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={redColor}
                strokeWidth={stroke}
                strokeDasharray={`${atRiskLen} ${c}`}
                strokeDashoffset={-healthyLen}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )}
            <text
              x={size / 2}
              y={size / 2}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="14"
              fontWeight="700"
              fill="currentColor"
            >
              {total}
            </text>
          </svg>
          <div className="text-[11px] space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ background: greenColor }}
              />
              <span>Healthy: {healthy}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ background: redColor }}
              />
              <span>At Risk: {atRisk}</span>
            </div>
          </div>
        </div>
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
            onClick={() => {
              // Toggle the body class that scopes our aggressive print
              // CSS (see app.css → @media print). The afterprint listener
              // cleans up so the class doesn't leak into the live UI if
              // the user cancels the dialog.
              const cleanup = () => {
                document.body.classList.remove("printing-dashboard");
                window.removeEventListener("afterprint", cleanup);
              };
              window.addEventListener("afterprint", cleanup);
              document.body.classList.add("printing-dashboard");
              // Give the browser one paint tick to apply the class
              // before the print dialog snapshots the layout.
              window.requestAnimationFrame(() => window.print());
            }}
            title="Export the current dashboard view to PDF (uses your browser's print → Save as PDF). Tip: enable 'Background graphics' in the print dialog for the colored sections."
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
        snapshots={snapshots}
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
  snapshots,
  onBack,
}: {
  snapshot: DashboardSnapshot;
  previous?: DashboardSnapshot;
  /** All snapshots — used to build the as-of-then trend charts. */
  snapshots: DashboardSnapshot[];
  onBack: () => void;
}) {
  // Prefer the frozen `snapshot.goals` captured at write time so a
  // historical week renders with the targets that were live then. Older
  // snapshots written before this field existed fall back to the
  // current per-quarter goals (the legacy, drift-prone behavior).
  const goals = useMemo(
    () => snapshot.goals ?? getQuarterGoals(snapshot.quarter),
    [snapshot.goals, snapshot.quarter],
  );
  const monthIdx = currentMonthIndex(snapshot.quarter, new Date(snapshot.snapshot_date));

  /**
   * Trend charts on the snapshot view show the dashboard "as it would
   * have looked that week" — so we filter the snapshots array down to
   * everything captured ON OR BEFORE the selected snapshot's week and
   * group by quarter (last snapshot of each quarter wins). This mirrors
   * the live dashboard's `quarterlySnapshotTrend()` but with a moving
   * cutoff instead of "today".
   */
  const trendBaseSnapshots = useMemo(
    () => snapshots.filter((s) => s.week_start <= snapshot.week_start),
    [snapshots, snapshot.week_start],
  );
  // ARR is point-in-time stable for past months — read from the live
  // `v_arr_rolling_365` view capped at the snapshot's week_start so the
  // historical view shows the FULL ARR history (every quarter from
  // Q2-2025 onward) instead of just the weekly snapshots captured so
  // far. Mirrors what the live ARR chart looked like that week.
  const { data: arrTrend } = useArrTrend();
  const arrTrendPoints = useMemo(
    () =>
      buildArrPoints(
        arrTrend ?? [],
        goals.arr.quarter_goal,
        snapshot.week_start,
      ),
    [arrTrend, goals.arr.quarter_goal, snapshot.week_start],
  );
  const pipelineTrendPoints = useMemo(
    () =>
      quarterlySnapshotTrend(
        trendBaseSnapshots,
        "pipeline_amount",
        goals.total_active_pipeline.quarter_goal,
      ),
    [trendBaseSnapshots, goals.total_active_pipeline.quarter_goal],
  );
  const nrrCustomerTrendPoints = useMemo(
    () =>
      quarterlySnapshotTrend(
        trendBaseSnapshots,
        "nrr_by_customer_pct",
        goals.nrr_customer_pct.quarter_goal,
      ),
    [trendBaseSnapshots, goals.nrr_customer_pct.quarter_goal],
  );
  const nrrDollarTrendPoints = useMemo(
    () =>
      quarterlySnapshotTrend(
        trendBaseSnapshots,
        "nrr_by_dollar_pct",
        goals.nrr_dollar_pct.quarter_goal,
      ),
    [trendBaseSnapshots, goals.nrr_dollar_pct.quarter_goal],
  );

  /**
   * Cumulative goal at the snapshot's month-of-quarter, matching the
   * progress-bar logic on the live dashboard. Used for QTD-style metrics
   * (new sales, renewals, etc.). For point-in-time metrics (ARR,
   * pipeline, NRR%) we use the quarter goal directly.
   */
  const cumulativeGoalAt = (key: MetricKey): number => {
    const g = goals[key];
    const filled = fillMonthGoals(g);
    if (monthIdx == null) return g.quarter_goal;
    return filled[monthIdx];
  };

  const sm = snapshot.metrics;
  const noop = () => {};

  // Per-metric resolved goal numbers, mirroring the live dashboard.
  const arrGoal = goals.arr.quarter_goal;
  const pipelineGoal = goals.total_active_pipeline.quarter_goal;
  const nrrCustGoal = goals.nrr_customer_pct.quarter_goal;
  const nrrDollarGoal = goals.nrr_dollar_pct.quarter_goal;
  const newCustomersGoal = cumulativeGoalAt("new_customers");
  const newSalesGoal = cumulativeGoalAt("new_sales");
  const renewalsGoal = cumulativeGoalAt("renewals_number");
  const sqlGoal = cumulativeGoalAt("sql");
  const mqlGoal = cumulativeGoalAt("mql");
  const qtdBillingGoal = cumulativeGoalAt("qtd_billing_progress");

  return (
    <div className="space-y-6">
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
            {snapshot.quarter} · captured {snapshot.snapshot_date} · frozen
            view from that Monday — not live data. Quarterly trend lines
            show only the snapshots captured on or before this date.
          </p>
        </div>
      </div>

      {/* ----- Sales ----- */}
      <SectionWrap
        title="Sales"
        tone="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/40 dark:to-blue-900/20"
        accent="bg-blue-500"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <div className="space-y-2">
            <KpiCard
              label="ARR (rolling 365)"
              value={formatCurrency(sm.arr)}
              progress={pct(sm.arr, arrGoal)}
              goal={arrGoal}
              formatGoal={formatCurrency}
              onGoalChange={noop}
              editable={false}
              showGoal={false}
            />
            {arrTrendPoints.length > 0 && (
              <ChartCard title="ARR by Quarter">
                <ChartLegend showGoal={false} />
                <SegmentedLineChart
                  data={arrTrendPoints}
                  yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tooltipFormatter={(v) => formatCurrency(v)}
                  height={140}
                  showGoal={false}
                  lineColor="#3b82f6"
                />
              </ChartCard>
            )}
          </div>
          <KpiCard
            label="New Customers QTD"
            value={String(sm.new_customers_qtd)}
            progress={pct(sm.new_customers_qtd, newCustomersGoal)}
            goal={newCustomersGoal}
            formatGoal={(v) => String(v)}
            onGoalChange={noop}
            editable={false}
          />
          <KpiCard
            label="New Sales $ QTD"
            value={formatCurrency(sm.new_customer_amount_qtd)}
            progress={pct(sm.new_customer_amount_qtd, newSalesGoal)}
            goal={newSalesGoal}
            formatGoal={formatCurrency}
            onGoalChange={noop}
            editable={false}
          />
          <div className="space-y-2">
            <KpiCard
              label="Active Pipeline"
              value={formatCurrency(sm.pipeline_amount)}
              progress={pct(sm.pipeline_amount, pipelineGoal)}
              goal={pipelineGoal}
              formatGoal={formatCurrency}
              onGoalChange={noop}
              editable={false}
            />
            {pipelineTrendPoints.length > 0 && (
              <ChartCard
                title={`Active Pipeline by Quarter — goal ${formatCurrency(pipelineGoal)}`}
              >
                <ChartLegend />
                <SegmentedLineChart
                  data={pipelineTrendPoints}
                  yFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  tooltipFormatter={(v) => formatCurrency(v)}
                  height={140}
                />
              </ChartCard>
            )}
          </div>
        </div>
      </SectionWrap>

      {/* ----- Marketing ----- */}
      <SectionWrap
        title="Marketing"
        tone="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/40 dark:to-purple-900/20"
        accent="bg-purple-500"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <KpiCard
            label="SQL QTD"
            value={String(sm.sql_qtd)}
            progress={pct(sm.sql_qtd, sqlGoal)}
            goal={sqlGoal}
            formatGoal={(v) => String(v)}
            onGoalChange={noop}
            editable={false}
          />
          <KpiCard
            label="MQL QTD (unique)"
            value={String(sm.mql_unique_qtd)}
            progress={pct(sm.mql_unique_qtd, mqlGoal)}
            goal={mqlGoal}
            formatGoal={(v) => String(v)}
            onGoalChange={noop}
            editable={false}
          />
        </div>
      </SectionWrap>

      {/* ----- Customer Success ----- */}
      <SectionWrap
        title="Customer Success"
        tone="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20"
        accent="bg-emerald-500"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          <KpiCard
            label="Renewals Closed QTD"
            value={formatCurrency(sm.renewals_amount_qtd)}
            progress={pct(sm.renewals_amount_qtd, renewalsGoal)}
            goal={renewalsGoal}
            formatGoal={formatCurrency}
            onGoalChange={noop}
            editable={false}
          />
          <div className="space-y-2">
            <KpiCard
              label="QTD Billing Goal"
              value={formatCurrency(sm.qtd_billing)}
              progress={pct(sm.qtd_billing, qtdBillingGoal)}
              goal={qtdBillingGoal}
              formatGoal={formatCurrency}
              onGoalChange={noop}
              editable={false}
            />
            <KpiCard
              label="NRR by Customer"
              value={fmtPct(sm.nrr_by_customer_pct)}
              progress={Math.min(100, (sm.nrr_by_customer_pct / nrrCustGoal) * 100)}
              goal={nrrCustGoal}
              formatGoal={(v) => `${v}%`}
              onGoalChange={noop}
              editable={false}
            />
            {nrrCustomerTrendPoints.length > 0 && (
              <ChartCard
                title={`NRR by Customer — quarterly (goal ${nrrCustGoal}%)`}
              >
                <ChartLegend />
                <SegmentedLineChart
                  data={nrrCustomerTrendPoints}
                  yFormatter={(v) => `${v.toFixed(0)}%`}
                  tooltipFormatter={(v) => `${v.toFixed(1)}%`}
                  height={135}
                />
              </ChartCard>
            )}
            <KpiCard
              label="NRR by Dollar"
              value={fmtPct(sm.nrr_by_dollar_pct)}
              progress={Math.min(100, (sm.nrr_by_dollar_pct / nrrDollarGoal) * 100)}
              goal={nrrDollarGoal}
              formatGoal={(v) => `${v}%`}
              onGoalChange={noop}
              editable={false}
            />
            {nrrDollarTrendPoints.length > 0 && (
              <ChartCard
                title={`NRR by Dollar — quarterly (goal ${nrrDollarGoal}%)`}
              >
                <ChartLegend />
                <SegmentedLineChart
                  data={nrrDollarTrendPoints}
                  yFormatter={(v) => `${v.toFixed(0)}%`}
                  tooltipFormatter={(v) => `${v.toFixed(1)}%`}
                  height={135}
                />
              </ChartCard>
            )}
          </div>
        </div>
      </SectionWrap>

      {/* ----- Quote (Most Recent Quote at the time) ----- */}
      {(snapshot.quote_text || snapshot.quote_author) && (
        <Card>
          <CardContent className="p-4 space-y-1">
            <h4 className="text-sm font-medium text-muted-foreground">
              Most Recent Quote
            </h4>
            {snapshot.quote_text && (
              <p className="text-sm italic">"{snapshot.quote_text}"</p>
            )}
            {snapshot.quote_author && (
              <p className="text-[11px] text-muted-foreground">
                — {snapshot.quote_author}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ----- Development (Milestones at the time) ----- */}
      {snapshot.milestones.length > 0 && (
        <SectionWrap
          title="Development"
          tone="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-900/40 dark:to-slate-800/20"
          accent="bg-slate-400"
        >
          <div className="rounded-md border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Completion date</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.milestones.map((mi) => {
                  const status = deriveStatus(mi);
                  const tone =
                    STATUS_TONES[status] ?? "bg-slate-100 text-slate-700";
                  return (
                    <tr key={mi.id} className="border-t">
                      <td className="px-3 py-2">{mi.project || "—"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {mi.completion_date || "—"}
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
        </SectionWrap>
      )}
    </div>
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
