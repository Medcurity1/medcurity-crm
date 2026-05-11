/**
 * Weekly snapshots of the team dashboard. Mirrors Codex's Python
 * dashboard `HISTORY_DATA` shape so the Historical tab can show
 * week-over-week deltas. Stored in localStorage under
 * `dashboard_snapshots_v1`; capture is triggered once per ISO week
 * the first time an owner loads the dashboard during that week.
 *
 * To migrate to a server-side store later (Supabase table + cron),
 * swap `loadAll` / `saveAll` for HTTP calls — the rest is pure data.
 */

import { quarterLabelFromDate, type QuarterGoals } from "./dashboardGoalsByQuarter";
import type { Milestone } from "./dashboardMilestones";

export const SNAPSHOTS_LS_KEY = "dashboard_snapshots_v1";

/** The numeric metrics worth tracking week-over-week. */
export interface SnapshotMetrics {
  arr: number;
  new_customers_qtd: number;
  new_customer_amount_qtd: number;
  pipeline_amount: number;
  renewals_amount_qtd: number;
  nrr_by_customer_pct: number;
  nrr_by_dollar_pct: number;
  sql_qtd: number;
  mql_unique_qtd: number;
  qtd_billing: number;
}

export interface DashboardSnapshot {
  /** ISO date YYYY-MM-DD; the Monday of the captured ISO week. */
  week_start: string;
  /** ISO date the snapshot was actually written. */
  snapshot_date: string;
  /** ISO timestamp of capture for tie-breaking and audit. */
  generated_at_utc: string;
  /** Quarter label like Q2-2026 for grouping in the UI. */
  quarter: string;
  metrics: SnapshotMetrics;
  /** Milestones snapshot (frozen copy at capture time). */
  milestones: Milestone[];
  /** Free-text quote at capture time, for context. */
  quote_text: string;
  quote_author: string;
  /**
   * Frozen copy of the per-metric goals for `quarter` at capture time.
   * Optional for backwards-compat with snapshots captured before this
   * field existed — those fall back to the current `getQuarterGoals()`
   * value (the prior, slightly drift-prone behavior).
   */
  goals?: QuarterGoals;
}

/** ISO-week start (Monday) for a given date, formatted YYYY-MM-DD. */
export function isoWeekStart(d: Date = new Date()): string {
  // Monday-anchored week. JS getDay(): Sun=0, Mon=1, ..., Sat=6.
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay();
  // Treat Sunday (0) as the 7th day of the previous week.
  const offset = day === 0 ? 6 : day - 1;
  copy.setDate(copy.getDate() - offset);
  return copy.toISOString().slice(0, 10);
}

function loadAll(): DashboardSnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SNAPSHOTS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DashboardSnapshot[];
  } catch {
    return [];
  }
}

function saveAll(items: DashboardSnapshot[]) {
  try {
    window.localStorage.setItem(SNAPSHOTS_LS_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota errors */
  }
}

/** All snapshots, newest first. */
export function loadSnapshots(): DashboardSnapshot[] {
  return [...loadAll()].sort((a, b) =>
    b.week_start.localeCompare(a.week_start),
  );
}

/** True if a snapshot already exists for the given ISO week. */
export function hasSnapshotForWeek(weekStart: string): boolean {
  return loadAll().some((s) => s.week_start === weekStart);
}

/**
 * Idempotent capture: if no snapshot exists yet for the current ISO
 * week, insert one. Otherwise no-op. Returns the newly-written
 * snapshot, or null if nothing was written.
 */
export function captureWeeklySnapshotIfNeeded(input: {
  metrics: SnapshotMetrics;
  milestones: Milestone[];
  quote_text: string;
  quote_author: string;
  /** Frozen goals copy. Caller passes `getQuarterGoals(quarter)` so the
   *  historical view shows the goals that were live at capture time. */
  goals?: QuarterGoals;
  now?: Date;
}): DashboardSnapshot | null {
  const now = input.now ?? new Date();
  const week_start = isoWeekStart(now);
  if (hasSnapshotForWeek(week_start)) return null;
  const snap: DashboardSnapshot = {
    week_start,
    snapshot_date: now.toISOString().slice(0, 10),
    generated_at_utc: now.toISOString(),
    quarter: quarterLabelFromDate(now),
    metrics: { ...input.metrics },
    milestones: input.milestones.map((m) => ({ ...m })),
    quote_text: input.quote_text,
    quote_author: input.quote_author,
    goals: input.goals,
  };
  const all = loadAll();
  all.push(snap);
  saveAll(all);
  return snap;
}

/** Remove a snapshot by week_start. */
export function deleteSnapshot(weekStart: string) {
  saveAll(loadAll().filter((s) => s.week_start !== weekStart));
}

/** Wipe all snapshots — owner-only escape hatch on the Historical tab. */
export function clearSnapshots() {
  saveAll([]);
}

/** The metric keys exposed in the Historical tab table, in display order. */
export const SNAPSHOT_METRIC_LABELS: Array<{
  key: keyof SnapshotMetrics;
  label: string;
  format: "currency" | "count" | "percent";
}> = [
  { key: "arr", label: "ARR", format: "currency" },
  { key: "new_customers_qtd", label: "New Customers QTD", format: "count" },
  {
    key: "new_customer_amount_qtd",
    label: "New Sales $ QTD",
    format: "currency",
  },
  { key: "pipeline_amount", label: "Active Pipeline", format: "currency" },
  {
    key: "renewals_amount_qtd",
    label: "Renewals Closed $ QTD",
    format: "currency",
  },
  { key: "nrr_by_customer_pct", label: "NRR by Customer", format: "percent" },
  { key: "nrr_by_dollar_pct", label: "NRR by Dollar", format: "percent" },
  { key: "sql_qtd", label: "SQL QTD", format: "count" },
  { key: "mql_unique_qtd", label: "MQL QTD (unique)", format: "count" },
  { key: "qtd_billing", label: "QTD Billing", format: "currency" },
];
