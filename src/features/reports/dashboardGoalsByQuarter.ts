/**
 * Per-quarter dashboard goals. Mirrors Codex's Python dashboard
 * (`dashboard_goals_by_quarter_v1` in localStorage), so the React
 * dashboard and the Python one can interchange goal data and the
 * Goals admin page works the way Brayden's other dashboard does.
 *
 * Shape per metric:
 *   { quarter_goal: number, month_goals: [m1, m2, m3] }
 * where each month_goal is the **cumulative target through end-of-month-N**.
 * M3 is always forced to equal `quarter_goal`. M1/M2 may be null →
 * auto-fill at read time (even thirds for incrementing metrics, flat
 * quarter_goal for locked metrics like NRR % and active pipeline).
 *
 * Storage is keyed by quarter label (`Q1-2026`, `Q2-2026`, ...) so
 * historical quarters are preserved when the dashboard rolls forward.
 *
 * To migrate to DB-backed goals later, swap `loadStore`/`saveStore`
 * for Supabase calls — the rest of this module is presentation-agnostic.
 */

export const STORE_KEY = "dashboard_goals_by_quarter_v1";
export const LOCK_STORE_KEY = "dashboard_goals_lock_by_quarter_v1";

/** All metrics tracked in the per-quarter goal store. Order is the
 *  same as the Goals admin page rows. */
export const METRIC_KEYS = [
  "new_sales",
  "total_active_pipeline",
  "new_customers",
  "arr",
  "sql",
  "mql",
  "renewals_number",
  "nrr_customer_pct",
  "nrr_dollar_pct",
  "qtd_billing_progress",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];

/** Display metadata for the Goals admin page. */
export interface MetricMeta {
  key: MetricKey;
  label: string;
  group: "Sales" | "Marketing" | "Customer Success";
  format: "currency" | "count" | "percent";
  /**
   * Locked metrics use `quarter_goal` for every month — admin can edit
   * the quarter goal but the M1/M2/M3 fields aren't independently
   * settable. Codex parity: NRR % and total_active_pipeline.
   */
  locked: boolean;
  hint: string;
}

export const METRICS: MetricMeta[] = [
  { key: "new_sales",             label: "New Sales $",          group: "Sales",            format: "currency", locked: false, hint: "Closed-won new business amount this quarter." },
  { key: "total_active_pipeline", label: "Active Pipeline",      group: "Sales",            format: "currency", locked: true,  hint: "Open pipeline target — locked flat across the quarter." },
  { key: "new_customers",         label: "New Customers",        group: "Sales",            format: "count",    locked: false, hint: "Closed-won new-business deal count." },
  { key: "arr",                   label: "ARR (rolling 365)",    group: "Sales",            format: "currency", locked: false, hint: "Trailing-365 closed-won total." },
  { key: "sql",                   label: "SQL",                  group: "Marketing",        format: "count",    locked: false, hint: "Sales-qualified accounts this quarter." },
  { key: "mql",                   label: "MQL (unique)",         group: "Marketing",        format: "count",    locked: false, hint: "Deduped MQL across leads + contacts." },
  { key: "renewals_number",       label: "Renewals Closed $",    group: "Customer Success", format: "currency", locked: false, hint: "Closed-won renewal amount this quarter." },
  { key: "nrr_customer_pct",      label: "NRR % (by customer)",  group: "Customer Success", format: "percent",  locked: true,  hint: "Locked flat — same target every month." },
  { key: "nrr_dollar_pct",        label: "NRR % (by dollar)",    group: "Customer Success", format: "percent",  locked: true,  hint: "Locked flat — same target every month." },
  { key: "qtd_billing_progress",  label: "QTD Billing",          group: "Customer Success", format: "currency", locked: false, hint: "New sales + renewals closed this quarter." },
];

export interface MetricGoal {
  quarter_goal: number;
  /** Cumulative targets at end of M1/M2/M3. null → auto-fill. */
  month_goals: [number | null, number | null, number | null];
}

export type QuarterGoals = Record<MetricKey, MetricGoal>;

/** Codex defaults from dashboard_goals.json, preserved verbatim so
 *  the React dashboard's defaults match the Python one's. */
export const DEFAULT_GOALS: QuarterGoals = {
  new_sales:             { quarter_goal: 36_000,     month_goals: [null, null, null] },
  total_active_pipeline: { quarter_goal: 800_000,    month_goals: [800_000, 800_000, 800_000] },
  new_customers:         { quarter_goal: 24,         month_goals: [null, null, null] },
  arr:                   { quarter_goal: 1_100_000,  month_goals: [null, null, null] },
  sql:                   { quarter_goal: 15,         month_goals: [null, null, null] },
  mql:                   { quarter_goal: 75,         month_goals: [null, null, null] },
  renewals_number:       { quarter_goal: 150_000,    month_goals: [null, null, null] },
  // NRR % stored as 0-100 here (admin edits whole-number percents).
  // Codex stores 0-1; we convert at the boundary.
  nrr_customer_pct:      { quarter_goal: 90, month_goals: [90, 90, 90] },
  nrr_dollar_pct:        { quarter_goal: 90, month_goals: [90, 90, 90] },
  qtd_billing_progress:  { quarter_goal: 350_000,    month_goals: [null, null, null] },
};

// ---------------------------------------------------------------------------
// Quarter label helpers
// ---------------------------------------------------------------------------

/** Calendar-quarter label like "Q2-2026" for a given date. */
export function quarterLabelFromDate(d: Date = new Date()): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q}-${d.getFullYear()}`;
}

/** Inverse: parse "Q2-2026" → { year, q } or null. */
export function parseQuarterLabel(
  label: string,
): { year: number; quarter: 1 | 2 | 3 | 4 } | null {
  const m = /^Q([1-4])-(\d{4})$/.exec(label);
  if (!m) return null;
  return { quarter: Number(m[1]) as 1 | 2 | 3 | 4, year: Number(m[2]) };
}

/** Short month names for the 3 months in a quarter (M1, M2, M3). */
export function quarterMonths(label: string): [string, string, string] {
  const parsed = parseQuarterLabel(label);
  if (!parsed) return ["M1", "M2", "M3"];
  const startMonth = (parsed.quarter - 1) * 3;
  return [0, 1, 2].map((i) => {
    const d = new Date(parsed.year, startMonth + i, 1);
    return d.toLocaleString("en-US", { month: "short" });
  }) as [string, string, string];
}

/**
 * 0-indexed: which of M1/M2/M3 is "today" for the given quarter? Returns
 * null if today falls outside the quarter (so we don't display a bogus
 * "current month goal" for past quarters).
 */
export function currentMonthIndex(
  quarterLabel: string,
  today: Date = new Date(),
): 0 | 1 | 2 | null {
  const parsed = parseQuarterLabel(quarterLabel);
  if (!parsed) return null;
  if (today.getFullYear() !== parsed.year) return null;
  const startMonth = (parsed.quarter - 1) * 3;
  const offset = today.getMonth() - startMonth;
  if (offset < 0 || offset > 2) return null;
  return offset as 0 | 1 | 2;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

type Store = Record<string, Partial<QuarterGoals>>;

function loadStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveStore(store: Store) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

type LockStore = Record<string, boolean>;

function loadLockStore(): LockStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCK_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveLockStore(store: LockStore) {
  try {
    window.localStorage.setItem(LOCK_STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/** Merge raw stored partial entry with defaults and normalize. */
function normalizeMetricGoal(
  metric: MetricKey,
  raw: Partial<MetricGoal> | undefined,
): MetricGoal {
  const fallback = DEFAULT_GOALS[metric];
  const meta = METRICS.find((m) => m.key === metric)!;
  const quarter_goal =
    typeof raw?.quarter_goal === "number" && Number.isFinite(raw.quarter_goal)
      ? raw.quarter_goal
      : fallback.quarter_goal;

  // Locked metrics: M1=M2=M3=quarter_goal (flat target every month).
  if (meta.locked) {
    return {
      quarter_goal,
      month_goals: [quarter_goal, quarter_goal, quarter_goal],
    };
  }

  const m1raw = raw?.month_goals?.[0];
  const m2raw = raw?.month_goals?.[1];
  // M3 is forced to quarter_goal (cumulative end-of-quarter target).
  const m1 = typeof m1raw === "number" && Number.isFinite(m1raw) ? m1raw : null;
  const m2 = typeof m2raw === "number" && Number.isFinite(m2raw) ? m2raw : null;
  return { quarter_goal, month_goals: [m1, m2, quarter_goal] };
}

/** Returns the per-metric goals for a quarter, normalized. Always returns
 *  a complete object — missing entries fall back to DEFAULT_GOALS. */
export function getQuarterGoals(quarterLabel: string): QuarterGoals {
  const store = loadStore();
  const raw = store[quarterLabel] ?? {};
  const out = {} as QuarterGoals;
  for (const meta of METRICS) {
    out[meta.key] = normalizeMetricGoal(meta.key, raw[meta.key]);
  }
  return out;
}

export function saveQuarterGoals(quarterLabel: string, goals: QuarterGoals) {
  const store = loadStore();
  store[quarterLabel] = goals;
  saveStore(store);
}

export function isQuarterLocked(quarterLabel: string): boolean {
  return loadLockStore()[quarterLabel] === true;
}

export function setQuarterLocked(quarterLabel: string, locked: boolean) {
  const store = loadLockStore();
  if (locked) {
    store[quarterLabel] = true;
  } else {
    delete store[quarterLabel];
  }
  saveLockStore(store);
}

/** Reset a quarter to defaults (drops the saved entry). */
export function resetQuarterToDefaults(quarterLabel: string) {
  const store = loadStore();
  delete store[quarterLabel];
  saveStore(store);
}

/** All quarters that have any saved goal data — for the quarter
 *  selector dropdown on the admin page. */
export function listSavedQuarters(): string[] {
  return Object.keys(loadStore()).sort();
}

// ---------------------------------------------------------------------------
// Convenience: pick the cumulative goal value at a given month index
// ---------------------------------------------------------------------------

/** Cumulative goal target at end-of-month-N (0/1/2). Auto-fills nulls
 *  with even thirds for non-locked metrics. */
export function cumulativeGoalAt(
  goal: MetricGoal,
  monthIdx: 0 | 1 | 2,
): number {
  const filled = fillMonthGoals(goal);
  return filled[monthIdx];
}

/** Auto-fills null M1/M2 with even thirds; leaves M3 = quarter_goal. */
export function fillMonthGoals(
  goal: MetricGoal,
): [number, number, number] {
  const q = goal.quarter_goal;
  const m1 = goal.month_goals[0] ?? q / 3;
  const m2 = goal.month_goals[1] ?? (2 * q) / 3;
  const m3 = goal.month_goals[2] ?? q;
  return [m1, m2, m3];
}
