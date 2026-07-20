// Nexus Metrics registry (jordan-v4-spec §7). Modeled on
// src/features/dashboard/kpi-registry.ts — same query idioms (count
// head:true, paginated amount sums, local-date close_date boundaries) —
// but each metric also computes the PREVIOUS equivalent period for the
// optional ↑/↓ comparison, and trend metrics return per-day buckets for
// the mini axis-free chart.
//
// Scope: "personal" filters owner_user_id to the WIDGET OWNER (not the
// signed-in viewer) so admin configure-for-user previews the right data.
// "team" applies no owner filter.

import { supabase } from "@/lib/supabase";
import { loadGoals } from "@/features/reports/dashboardGoals";
import type {
  NexusMetricKey,
  NexusMetricPeriod,
  NexusMetricScope,
} from "./types";

// ── Result / definition shapes ───────────────────────────────────────

export interface NexusMetricData {
  current: number;
  /** Previous equivalent period; null when comparison doesn't apply. */
  previous: number | null;
  /** Per-day buckets for trend metrics; null for single-number stats. */
  trend: { label: string; value: number }[] | null;
  /** Target for goal-style metrics (revenue_vs_goal); null otherwise. */
  goal: number | null;
}

export interface NexusMetricQueryOpts {
  scope: NexusMetricScope;
  period: NexusMetricPeriod;
  /** The widget owner's user id (personal scope). */
  userId: string;
}

export interface NexusMetricDef {
  key: NexusMetricKey;
  label: string;
  /** Builder groups the metric picker by this. */
  group: "Activity" | "Tasks" | "Pipeline" | "Revenue" | "Growth";
  format: "count" | "currency";
  /** number = big callout; trend = mini bar chart; goal = progress bar. */
  display: "number" | "trend" | "goal";
  supportsScope: boolean;
  supportsPeriod: boolean;
  supportsCompare: boolean;
  /** false = an increase is bad (e.g. overdue tasks) — flips arrow color. */
  positiveIsGood: boolean;
  /** Shown under the stat when the metric has a fixed window. */
  periodNote?: string;
  query: (opts: NexusMetricQueryOpts) => Promise<NexusMetricData>;
}

// ── Period math ──────────────────────────────────────────────────────

/** [start, end) local-time range for the period, offset periods back. */
export function periodRange(
  period: NexusMetricPeriod,
  offset = 0,
): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "today": {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      return { start, end };
    }
    case "week": {
      // Monday-anchored (house convention — see dashboardSnapshots.ts).
      const day = now.getDay(); // Sun=0
      const mondayDelta = day === 0 ? -6 : 1 - day;
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + mondayDelta + offset * 7,
      );
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      return { start, end };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
      return { start, end };
    }
    case "quarter": {
      const qStart = now.getMonth() - (now.getMonth() % 3);
      const start = new Date(now.getFullYear(), qStart + offset * 3, 1);
      const end = new Date(start.getFullYear(), start.getMonth() + 3, 1);
      return { start, end };
    }
  }
}

export const PERIOD_LABELS: Record<NexusMetricPeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  quarter: "This quarter",
};

export const PREVIOUS_PERIOD_LABELS: Record<NexusMetricPeriod, string> = {
  today: "yesterday",
  week: "last week",
  month: "last month",
  quarter: "last quarter",
};

/** Local-timezone YYYY-MM-DD (DATE-column boundaries — kpi-registry note). */
function localISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Query helpers ────────────────────────────────────────────────────

type ActivityKind = "call" | "email" | "meeting";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function activityBase(type: ActivityKind, ownerId: string | null, select: string, head: boolean): any {
  let q = supabase
    .from("activities")
    .select(select, head ? { count: "exact", head: true } : undefined)
    .eq("activity_type", type)
    .is("archived_at", null);
  if (ownerId) q = q.eq("owner_user_id", ownerId);
  // "Emails Sent": logged emails that aren't inbound. Manual logs have a
  // null direction — .neq alone would drop them (SQL null semantics).
  if (type === "email") q = q.or("email_direction.is.null,email_direction.eq.sent");
  return q;
}

async function countActivities(
  type: ActivityKind,
  range: { start: Date; end: Date },
  ownerId: string | null,
): Promise<number> {
  const { count, error } = await activityBase(type, ownerId, "*", true)
    .gte("effective_at", range.start.toISOString())
    .lt("effective_at", range.end.toISOString());
  if (error) throw error;
  return count ?? 0;
}

// ── Email fan-out dedupe ─────────────────────────────────────────────
//
// dce9b1f made sync-emails log one synced email to EVERY matched contact
// under an account (was: one arbitrary contact), so a single email now
// produces N activity rows sharing the same external_message_id. Counting
// rows would inflate "Emails Sent" by however many contacts a message
// happened to match. These two helpers are pure (exported for unit tests)
// and used by activityTrend / countDistinctEmailActivities below.

interface EmailIdentityRow {
  id: string;
  external_message_id: string | null;
}

/**
 * Identity for "one real email, once." Synced emails key off
 * external_message_id (shared across every fan-out row for the same
 * message). Manually-logged emails have no external_message_id, so each
 * row is its own message — falls back to the row id so it's never
 * accidentally merged with another manual log.
 */
export function emailActivityIdentity(row: EmailIdentityRow): string {
  return row.external_message_id ?? `row:${row.id}`;
}

interface ActivityTrendRow extends EmailIdentityRow {
  effective_at: string;
}

/**
 * Bucket rows into per-local-day counts across [range.start, range.end),
 * deduping each bucket by emailActivityIdentity. This is a no-op for
 * call/meeting rows (every row has a unique id and no external_message_id
 * fan-out); for email rows it collapses same-message fan-out copies that
 * land in the same day (they always do — fan-out copies share
 * effective_at) down to one count. Pure — exported for unit tests.
 */
export function bucketActivityRowsByDay(
  rows: ActivityTrendRow[],
  range: { start: Date; end: Date },
): { label: string; value: number }[] {
  const buckets = new Map<string, number>();
  const cursor = new Date(range.start);
  while (cursor < range.end && buckets.size < 92) {
    buckets.set(localISODate(cursor), 0);
    cursor.setDate(cursor.getDate() + 1);
  }
  const seenPerBucket = new Map<string, Set<string>>();
  for (const r of rows) {
    const key = localISODate(new Date(r.effective_at));
    if (!buckets.has(key)) continue;
    let seen = seenPerBucket.get(key);
    if (!seen) {
      seen = new Set<string>();
      seenPerBucket.set(key, seen);
    }
    const identity = emailActivityIdentity(r);
    if (seen.has(identity)) continue;
    seen.add(identity);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return Array.from(buckets.entries()).map(([date, value]) => ({
    label: new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    value,
  }));
}

/** Per-local-day buckets for a trend metric (bounded fetch, deduped). */
async function activityTrend(
  type: ActivityKind,
  range: { start: Date; end: Date },
  ownerId: string | null,
): Promise<{ label: string; value: number }[]> {
  const rows: ActivityTrendRow[] = [];
  const PAGE = 1000;
  let from = 0;
  while (rows.length < 5000) {
    const { data, error } = await activityBase(
      type,
      ownerId,
      "id, effective_at, external_message_id",
      false,
    )
      .gte("effective_at", range.start.toISOString())
      .lt("effective_at", range.end.toISOString())
      .order("effective_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as ActivityTrendRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return bucketActivityRowsByDay(rows, range);
}

/**
 * Distinct-email count over a period (no trend buckets — used for the
 * "Emails Sent" previous-period comparison). Bounded fetch, same 5000-row
 * cap as activityTrend: this metric already fetches full email rows (not
 * a head:true count) for the trend chart, so a client-side dedupe over
 * that same volume-tested pattern is the natural fit here rather than
 * adding a SQL RPC just for the comparison number.
 */
async function countDistinctEmailActivities(
  range: { start: Date; end: Date },
  ownerId: string | null,
): Promise<number> {
  const ids = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  let fetched = 0;
  while (fetched < 5000) {
    const { data, error } = await activityBase(
      "email",
      ownerId,
      "id, external_message_id",
      false,
    )
      .gte("effective_at", range.start.toISOString())
      .lt("effective_at", range.end.toISOString())
      .order("effective_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as EmailIdentityRow[];
    for (const r of page) ids.add(emailActivityIdentity(r));
    fetched += page.length;
    if (page.length < PAGE) break;
    from += PAGE;
  }
  return ids.size;
}

/**
 * Paginated amount sum over opportunities (never truncates at PostgREST's
 * 1000-row cap — same guard as kpi-registry's fetchAllOppAmounts).
 */
async function sumOppAmounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyFilters: (q: any) => any,
): Promise<{ sum: number; count: number }> {
  let sum = 0;
  let count = 0;
  const PAGE = 1000;
  let from = 0;
  while (count < 50_000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: any = supabase
      .from("opportunities")
      .select("amount")
      .is("archived_at", null);
    const { data, error } = await applyFilters(base).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as { amount: number | string | null }[];
    for (const r of rows) {
      sum += Number(r.amount ?? 0);
      count += 1;
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return { sum, count };
}

async function closedWonSum(
  range: { start: Date; end: Date },
  ownerId: string | null,
): Promise<{ sum: number; count: number }> {
  return sumOppAmounts((q) => {
    q = q
      .eq("stage", "closed_won")
      .gte("close_date", localISODate(range.start))
      .lt("close_date", localISODate(range.end));
    if (ownerId) q = q.eq("owner_user_id", ownerId);
    return q;
  });
}

function ownerFor(opts: NexusMetricQueryOpts, supportsScope: boolean): string | null {
  return supportsScope && opts.scope === "personal" ? opts.userId : null;
}

function num(current: number, previous: number | null = null): NexusMetricData {
  return { current, previous, trend: null, goal: null };
}

// ── Registry ─────────────────────────────────────────────────────────

export const NEXUS_METRICS: NexusMetricDef[] = [
  // ── Activity ─────────────────────────────────────────────────────
  {
    key: "calls_made",
    label: "Calls Made",
    group: "Activity",
    format: "count",
    display: "trend",
    supportsScope: true,
    supportsPeriod: true,
    supportsCompare: true,
    positiveIsGood: true,
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const range = periodRange(opts.period);
      const prev = periodRange(opts.period, -1);
      const [trend, previous] = await Promise.all([
        activityTrend("call", range, owner),
        countActivities("call", prev, owner),
      ]);
      const current = trend.reduce((s, b) => s + b.value, 0);
      return { current, previous, trend, goal: null };
    },
  },
  {
    key: "emails_sent",
    label: "Emails Sent",
    group: "Activity",
    format: "count",
    display: "trend",
    supportsScope: true,
    supportsPeriod: true,
    supportsCompare: true,
    positiveIsGood: true,
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const range = periodRange(opts.period);
      const prev = periodRange(opts.period, -1);
      // "current" comes from the (deduped) trend buckets; "previous" uses
      // the matching distinct-email count so both sides of the ↑/↓
      // comparison count real emails, not fan-out rows.
      const [trend, previous] = await Promise.all([
        activityTrend("email", range, owner),
        countDistinctEmailActivities(prev, owner),
      ]);
      const current = trend.reduce((s, b) => s + b.value, 0);
      return { current, previous, trend, goal: null };
    },
  },
  {
    // Spec's "Demos Scheduled" — labeled honestly: it counts logged
    // meeting activities (activity_type='meeting').
    key: "meetings_scheduled",
    label: "Meetings Scheduled",
    group: "Activity",
    format: "count",
    display: "number",
    supportsScope: true,
    supportsPeriod: true,
    supportsCompare: true,
    positiveIsGood: true,
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const [current, previous] = await Promise.all([
        countActivities("meeting", periodRange(opts.period), owner),
        countActivities("meeting", periodRange(opts.period, -1), owner),
      ]);
      return num(current, previous);
    },
  },

  // ── Tasks ────────────────────────────────────────────────────────
  {
    key: "tasks_completed",
    label: "Tasks Completed",
    group: "Tasks",
    format: "count",
    display: "number",
    supportsScope: true,
    supportsPeriod: true,
    supportsCompare: true,
    positiveIsGood: true,
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const count = async (range: { start: Date; end: Date }) => {
        let q = supabase
          .from("activities")
          .select("*", { count: "exact", head: true })
          .eq("activity_type", "task")
          .is("archived_at", null)
          .gte("completed_at", range.start.toISOString())
          .lt("completed_at", range.end.toISOString());
        if (owner) q = q.eq("owner_user_id", owner);
        const { count: c, error } = await q;
        if (error) throw error;
        return c ?? 0;
      };
      const [current, previous] = await Promise.all([
        count(periodRange(opts.period)),
        count(periodRange(opts.period, -1)),
      ]);
      return num(current, previous);
    },
  },
  {
    key: "tasks_overdue",
    label: "Tasks Overdue",
    group: "Tasks",
    format: "count",
    display: "number",
    supportsScope: true,
    supportsPeriod: false,
    supportsCompare: false,
    positiveIsGood: false,
    periodNote: "Open tasks past their due date",
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      let q = supabase
        .from("activities")
        .select("*", { count: "exact", head: true })
        .eq("activity_type", "task")
        .is("archived_at", null)
        .is("completed_at", null)
        .lt("due_at", new Date().toISOString());
      if (owner) q = q.eq("owner_user_id", owner);
      const { count, error } = await q;
      if (error) throw error;
      return num(count ?? 0);
    },
  },

  // ── Pipeline ─────────────────────────────────────────────────────
  {
    key: "open_opportunities",
    label: "Open Opportunities",
    group: "Pipeline",
    format: "count",
    display: "number",
    supportsScope: true,
    supportsPeriod: false,
    supportsCompare: false,
    positiveIsGood: true,
    periodNote: "Current count",
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      let q = supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null)
        .not("stage", "in", '("closed_won","closed_lost")');
      if (owner) q = q.eq("owner_user_id", owner);
      const { count, error } = await q;
      if (error) throw error;
      return num(count ?? 0);
    },
  },
  {
    key: "pipeline_value",
    label: "Pipeline Value",
    group: "Pipeline",
    format: "currency",
    display: "number",
    supportsScope: true,
    supportsPeriod: false,
    supportsCompare: false,
    positiveIsGood: true,
    periodNote: "Total open opportunity value",
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const { sum } = await sumOppAmounts((q) => {
        q = q.not("stage", "in", '("closed_won","closed_lost")');
        if (owner) q = q.eq("owner_user_id", owner);
        return q;
      });
      return num(sum);
    },
  },
  {
    key: "avg_deal_size",
    label: "Average Deal Size",
    group: "Pipeline",
    format: "currency",
    display: "number",
    supportsScope: true,
    supportsPeriod: false,
    supportsCompare: true,
    positiveIsGood: true,
    periodNote: "Closed won, rolling 30 days",
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const today = new Date();
      const back = (days: number) =>
        new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
      const avg = async (start: Date, end: Date) => {
        const { sum, count } = await sumOppAmounts((q) => {
          q = q
            .eq("stage", "closed_won")
            .gte("close_date", localISODate(start))
            .lt("close_date", localISODate(end));
          if (owner) q = q.eq("owner_user_id", owner);
          return q;
        });
        return count === 0 ? 0 : Math.round(sum / count);
      };
      const endToday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      const [current, previous] = await Promise.all([
        avg(back(30), endToday),
        avg(back(60), back(30)),
      ]);
      return num(current, previous);
    },
  },

  // ── Revenue ──────────────────────────────────────────────────────
  {
    key: "deals_closed",
    label: "Deals Closed",
    group: "Revenue",
    format: "count",
    display: "number",
    supportsScope: true,
    supportsPeriod: true,
    supportsCompare: true,
    positiveIsGood: true,
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const count = async (range: { start: Date; end: Date }) => {
        let q = supabase
          .from("opportunities")
          .select("*", { count: "exact", head: true })
          .eq("stage", "closed_won")
          .is("archived_at", null)
          .gte("close_date", localISODate(range.start))
          .lt("close_date", localISODate(range.end));
        if (owner) q = q.eq("owner_user_id", owner);
        const { count: c, error } = await q;
        if (error) throw error;
        return c ?? 0;
      };
      const [current, previous] = await Promise.all([
        count(periodRange(opts.period)),
        count(periodRange(opts.period, -1)),
      ]);
      return num(current, previous);
    },
  },
  {
    key: "revenue_closed",
    label: "Revenue Closed",
    group: "Revenue",
    format: "currency",
    display: "number",
    supportsScope: true,
    supportsPeriod: true,
    supportsCompare: true,
    positiveIsGood: true,
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const [cur, prev] = await Promise.all([
        closedWonSum(periodRange(opts.period), owner),
        closedWonSum(periodRange(opts.period, -1), owner),
      ]);
      return num(cur.sum, prev.sum);
    },
  },
  {
    // The house goals model is per-quarter (dashboardGoals.ts), so this
    // reads QTD closed revenue against the QTD Billing goal — the
    // closest equivalent of the spec's "Revenue vs Goal".
    key: "revenue_vs_goal",
    label: "Revenue vs Goal",
    group: "Revenue",
    format: "currency",
    display: "goal",
    supportsScope: false,
    supportsPeriod: false,
    supportsCompare: false,
    positiveIsGood: true,
    periodNote: "Quarter to date vs QTD billing goal",
    query: async () => {
      const goals = loadGoals();
      const goal = Number(goals.qtd_billing ?? 0);
      const { sum } = await closedWonSum(periodRange("quarter"), null);
      return { current: sum, previous: null, trend: null, goal: goal > 0 ? goal : null };
    },
  },

  // ── Growth ───────────────────────────────────────────────────────
  {
    key: "new_contacts",
    label: "New Contacts Added",
    group: "Growth",
    format: "count",
    display: "number",
    supportsScope: true,
    supportsPeriod: true,
    supportsCompare: true,
    positiveIsGood: true,
    query: async (opts) => {
      const owner = ownerFor(opts, true);
      const count = async (range: { start: Date; end: Date }) => {
        let q = supabase
          .from("contacts")
          .select("*", { count: "exact", head: true })
          .is("archived_at", null)
          // A bulk import day isn't a real new-contacts spike — pen rows
          // count once promoted (lead-type retirement, 2026-07-20).
          .is("import_status", null)
          .gte("created_at", range.start.toISOString())
          .lt("created_at", range.end.toISOString());
        if (owner) q = q.eq("owner_user_id", owner);
        const { count: c, error } = await q;
        if (error) throw error;
        return c ?? 0;
      };
      const [current, previous] = await Promise.all([
        count(periodRange(opts.period)),
        count(periodRange(opts.period, -1)),
      ]);
      return num(current, previous);
    },
  },
];

export function getMetricDef(key: string | undefined): NexusMetricDef | undefined {
  return NEXUS_METRICS.find((m) => m.key === key);
}

/** Builder picker groups, in display order. */
export const METRIC_GROUPS: NexusMetricDef["group"][] = [
  "Activity",
  "Tasks",
  "Pipeline",
  "Revenue",
  "Growth",
];
