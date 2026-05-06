/**
 * Shared dashboard-goal model. Used by both the Team Dashboard (read +
 * inline-edit) and the Admin → Dashboard Goals tab (centralized edit).
 *
 * Stored in localStorage today under `team_dashboard_goals_v1`. When we
 * move to DB-backed goals (per-quarter history), this module becomes the
 * single place to swap the load/save implementation.
 */

export const GOALS_LS_KEY = "team_dashboard_goals_v1";

export interface Goals {
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

export const DEFAULT_GOALS: Goals = {
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

export interface GoalFieldMeta {
  key: keyof Goals;
  label: string;
  group: "Sales" | "Marketing" | "Customer Success" | "Development";
  format: "currency" | "count" | "percent";
  hint: string;
}

/** Display order matches the Team Dashboard layout. */
export const GOAL_FIELDS: GoalFieldMeta[] = [
  { key: "arr",                   label: "ARR (rolling 365)",      group: "Sales",            format: "currency", hint: "Trailing-365 closed-won total." },
  { key: "new_customers",         label: "New Customers QTD",      group: "Sales",            format: "count",    hint: "Closed-won new-business deals this quarter." },
  { key: "new_sales",             label: "New Sales $ QTD",        group: "Sales",            format: "currency", hint: "Closed-won new-business amount this quarter." },
  { key: "total_active_pipeline", label: "Active Pipeline",        group: "Sales",            format: "currency", hint: "Open-stage opportunity amount." },
  { key: "sql",                   label: "SQL QTD",                group: "Marketing",        format: "count",    hint: "Sales-qualified accounts this quarter." },
  { key: "mql",                   label: "MQL QTD (unique)",       group: "Marketing",        format: "count",    hint: "Deduped marketing-qualified leads + contacts." },
  { key: "renewals_amount",       label: "Renewals Closed $ QTD",  group: "Customer Success", format: "currency", hint: "Closed-won renewal amount this quarter." },
  { key: "nrr_customer_pct",      label: "NRR % (by customer)",    group: "Customer Success", format: "percent",  hint: "Net retention by customer count." },
  { key: "nrr_dollar_pct",        label: "NRR % (by dollar)",      group: "Customer Success", format: "percent",  hint: "Net retention by ARR dollars." },
  { key: "qtd_billing",           label: "QTD Billing Goal",       group: "Customer Success", format: "currency", hint: "Sum of new sales + renewals closed this quarter." },
];

export function loadGoals(): Goals {
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

export function saveGoals(g: Goals) {
  try {
    window.localStorage.setItem(GOALS_LS_KEY, JSON.stringify(g));
  } catch {
    /* ignore */
  }
}

/**
 * Goal status used to color KPI dots and chart segment colors.
 *  red    = below 50% of goal
 *  yellow = 50% – 99% of goal (below the goal line)
 *  green  = 100%+ of goal (at or above the goal line)
 *
 * Green means "hit the goal." Anything below the dashed goal line
 * on a chart is yellow (or red if far below). The previous ≥90%
 * green threshold caused points sitting visually below the goal
 * line to render green, which read as misleading once charts
 * zoomed in (e.g. NRR Y-axis [60, 100]).
 */
export type GoalStatus = "red" | "yellow" | "green" | "neutral";

export function goalStatus(actual: number, goal: number): GoalStatus {
  if (!goal || goal <= 0) return "neutral";
  const pct = (actual / goal) * 100;
  if (pct >= 100) return "green";
  if (pct >= 50) return "yellow";
  return "red";
}

export const STATUS_HEX: Record<GoalStatus, string> = {
  red: "#ef4444",
  yellow: "#f59e0b",
  green: "#10b981",
  neutral: "#94a3b8",
};

export const STATUS_BG: Record<GoalStatus, string> = {
  red: "bg-red-500",
  yellow: "bg-amber-500",
  green: "bg-emerald-500",
  neutral: "bg-slate-400",
};
