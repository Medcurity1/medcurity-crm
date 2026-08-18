import {
  DollarSign,
  TrendingUp,
  Trophy,
  CalendarClock,
  RefreshCw,
  AlertTriangle,
  Building2,
  Users,
  BarChart3,
  Target,
  UserPlus,
  Percent,
  Phone,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole } from "@/types/crm";

// ---------------------------------------------------------------------------
// KPI Definition
// ---------------------------------------------------------------------------

export interface KpiDefinition {
  id: string;
  label: string;
  category: "sales" | "renewals" | "team";
  icon: LucideIcon;
  query: (supabase: SupabaseClient, userId: string) => Promise<string | number>;
  format: "number" | "currency" | "percent";
  requiredRole?: AppRole[];
  /** Optional URL the KPI card links to. May be a function so the link
   *  can include the current user's id (e.g. owner-filtered list views). */
  link?: string | ((userId: string) => string);
}

/**
 * Pull a column from `opportunities` paginated past PostgREST's 1000-row
 * cap. Returns ALL matching rows. Used by KPI sums so totals don't
 * silently truncate when the result set exceeds 1000 records.
 *
 * Typed loosely (any) because Supabase's generic builder types are
 * intentionally narrow and don't compose well with caller-supplied
 * filter chains.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Sum opportunity amounts SERVER-side (migration 20260727210000).
 *
 * This used to page every matching row's `amount` to the browser (1,000 at a
 * time, up to 50,000) just to add them up here — the whole opportunities
 * table crossing the wire on every Home load, for every user, growing with
 * the pipeline (docket 2026-07-22, prod RAM/perf follow-up (d)).
 *
 * The RPC is SECURITY INVOKER, so caller RLS still applies and each user
 * sums exactly the rows they could see before — same numbers, one request.
 */
async function sumOppAmounts(
  supabase: SupabaseClient,
  args: {
    ownerUserId?: string | null;
    openOnly?: boolean;
    stage?: string | null;
    contractStartFrom?: string | null;
    contractStartTo?: string | null;
  },
): Promise<number> {
  const { data, error } = await supabase.rpc("sum_opportunity_amounts", {
    p_owner_user_id: args.ownerUserId ?? null,
    p_open_only: args.openOnly ?? false,
    p_stage: args.stage ?? null,
    p_contract_start_from: args.contractStartFrom ?? null,
    p_contract_start_to: args.contractStartTo ?? null,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

/**
 * SUM + COUNT + AVG over opportunities, server-side
 * (migration 20260817130000 — the generalized sibling of
 * `sum_opportunity_amounts` above).
 *
 * Needed wherever a KPI wants a COUNT or an AVERAGE alongside the sum:
 * an average taken over a row set PostgREST truncated at 1000 is wrong
 * even when the truncation is small, so it has to be computed in SQL.
 * SECURITY INVOKER, so caller RLS applies exactly as before.
 */
async function oppStats(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
): Promise<{ total: number; count: number; avg: number }> {
  const { data, error } = await supabase.rpc("opportunity_amount_stats", args);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return {
    total: Number(row?.total ?? 0),
    count: Number(row?.row_count ?? 0),
    avg: Number(row?.avg_amount ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// "Open" = anything not closed. The opportunities list filter is
// per-stage (no "open" pseudo-value), so KPI links must enumerate the
// real open stages or the page parses `stage=open` as a literal value
// that matches zero rows (the source of the "Team Total Pipeline goes
// to a blank page" bug).
const OPEN_STAGES = [
  "details_analysis",
  "demo",
  "proposal_and_price_quote",
  "proposal_conversation",
  "verbal_commit",
].join(",");

function getQuarterStart(date: Date): Date {
  const month = date.getMonth();
  const quarterStartMonth = month - (month % 3);
  return new Date(date.getFullYear(), quarterStartMonth, 1);
}

// Start of the NEXT quarter — the exclusive upper bound for "this quarter"
// windows (so a deal closing in a later quarter doesn't leak into the count).
function getQuarterEnd(date: Date): Date {
  const start = getQuarterStart(date);
  return new Date(start.getFullYear(), start.getMonth() + 3, 1);
}

// Last day OF this quarter (inclusive). The list-view date filters use `<=`,
// so deep-link "…_before" params want this, not the next quarter's first day.
function getQuarterLastDay(date: Date): Date {
  const end = getQuarterEnd(date);
  return new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// Monday-start week. getDay() is 0=Sun..6=Sat; (day + 6) % 7 = days since the
// most recent Monday (Mon→0, Sun→6). Returns local midnight so the deep-link
// date string and the effective_at bound land on the same day.
function getWeekStartMonday(date: Date): Date {
  const offset = (date.getDay() + 6) % 7;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - offset);
}

// Local-timezone YYYY-MM-DD. Used for KPI deep-link URLs so the
// list-page filter ("Closed on/after …") matches the user's local
// month/quarter boundary instead of UTC's. Naive `.toISOString()`
// would shift west-of-UTC users back a day.
function localISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// (The 45s memoized fetchRenewalQueue that renewals_30 / renewals_60 /
// arr_at_risk shared is gone: all three now hit renewal_queue_arr_stats —
// one aggregate row over the wire each instead of the whole view, which
// PostgREST silently capped at 1,000 rows anyway.)

/**
 * Server-side SUM(current_arr) + COUNT over renewal_queue
 * (migration 20260817131000).
 *
 * `arr_at_risk` used to reduce fetchRenewalQueue()'s rows in the browser.
 * That fetch has no .range() paging, so PostgREST capped it at 1,000 rows
 * and the tile summed an arbitrary subset once the queue grew past that —
 * the view has no ORDER BY, so it wasn't even a stable subset run to run.
 *
 * Omitting both bounds sums the WHOLE view, which is exactly what that KPI
 * did (its 0-120 day window lives inside renewal_queue itself). The bounds
 * serve renewals_30 / renewals_60, whose counts had the same 1,000-row
 * exposure and now read row_count from this RPC with (0, 30) / (0, 60).
 *
 * SECURITY INVOKER, and renewal_queue is a security_invoker view, so the
 * caller's RLS still scopes the sum exactly as the client-side version.
 */
async function renewalQueueArrStats(
  supabase: SupabaseClient,
  args: { daysUntilFrom?: number | null; daysUntilTo?: number | null } = {},
): Promise<{ total: number; count: number }> {
  const { data, error } = await supabase.rpc("renewal_queue_arr_stats", {
    p_days_until_from: args.daysUntilFrom ?? null,
    p_days_until_to: args.daysUntilTo ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  return { total: Number(row?.total ?? 0), count: Number(row?.row_count ?? 0) };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const KPI_REGISTRY: KpiDefinition[] = [
  // ── Sales ────────────────────────────────────────────────────────────────
  {
    id: "my_open_pipeline",
    label: "My Open Pipeline",
    category: "sales",
    icon: DollarSign,
    format: "currency",
    link: () => `/opportunities?owner=mine&stage=${OPEN_STAGES}`,
    query: async (supabase, userId) => {
      return sumOppAmounts(supabase, { ownerUserId: userId, openOnly: true });
    },
  },
  {
    id: "my_deals_in_progress",
    label: "My Deals in Progress",
    category: "sales",
    icon: TrendingUp,
    format: "number",
    link: () => `/opportunities?owner=mine&stage=${OPEN_STAGES}`,
    query: async (supabase, userId) => {
      const { count, error } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .not("stage", "in", '("closed_won","closed_lost")')
        .is("archived_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    id: "closed_won_quarter",
    label: "Closed Won This Quarter",
    category: "sales",
    icon: Trophy,
    format: "number",
    link: () =>
      `/opportunities?owner=mine&stage=closed_won&closed_after=${localISODate(getQuarterStart(new Date()))}&closed_before=${localISODate(getQuarterLastDay(new Date()))}`,
    query: async (supabase, userId) => {
      const quarterStart = getQuarterStart(new Date());
      const quarterEnd = getQuarterEnd(new Date());
      const { count, error } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .eq("stage", "closed_won")
        .is("archived_at", null)
        // close_date is a DATE — compare to LOCAL quarter-boundary date strings,
        // not toISOString() (whose UTC time component drops deals closed ON the
        // boundary day for negative-UTC zones). Matches the deep-link above.
        // Bounded to [quarterStart, quarterEnd) so deals closing in a LATER
        // quarter (e.g. a Nov 1 close viewed in Q3) don't inflate the count.
        .gte("close_date", localISODate(quarterStart))
        .lt("close_date", localISODate(quarterEnd));
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    // Summer's ask: a deal can close one quarter but the project (and the
    // money) starts in another. This tracks won $ whose CONTRACT START DATE
    // lands in the current quarter — closer to "revenue arriving this quarter"
    // than close-date does. Separate from "Closed Won This Quarter" (count by
    // close date) so neither redefines the other.
    id: "revenue_starting_quarter",
    label: "Revenue Starting This Quarter",
    category: "sales",
    icon: CalendarClock,
    format: "currency",
    link: () =>
      `/opportunities?owner=mine&stage=closed_won&started_after=${localISODate(getQuarterStart(new Date()))}&started_before=${localISODate(getQuarterLastDay(new Date()))}`,
    query: async (supabase, userId) => {
      const quarterStart = getQuarterStart(new Date());
      const quarterEnd = getQuarterEnd(new Date());
      return sumOppAmounts(supabase, {
        ownerUserId: userId,
        stage: "closed_won",
        contractStartFrom: localISODate(quarterStart),
        contractStartTo: localISODate(quarterEnd),
      });
    },
  },
  {
    // Summer: a running count of calls she's logged this week (Monday-start).
    id: "calls_this_week",
    label: "Calls This Week",
    category: "sales",
    icon: Phone,
    format: "number",
    link: () => {
      const s = getWeekStartMonday(new Date());
      const end = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6); // Sunday
      return `/activities?type=call&start=${localISODate(s)}&end=${localISODate(end)}`;
    },
    query: async (supabase, userId) => {
      const weekStart = getWeekStartMonday(new Date());
      const nextWeek = new Date(
        weekStart.getFullYear(),
        weekStart.getMonth(),
        weekStart.getDate() + 7,
      );
      const { count, error } = await supabase
        .from("activities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .eq("activity_type", "call")
        .is("archived_at", null)
        .gte("effective_at", weekStart.toISOString())
        .lt("effective_at", nextWeek.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    id: "upcoming_close",
    label: "Upcoming Close Dates",
    category: "sales",
    icon: CalendarClock,
    format: "number",
    // Land on my open opps with expected_close_date in the same
    // 30-day forward window the card counts. Without expected_after/
    // expected_before, the list looked identical to "My Open Pipeline"
    // and showed all open opps regardless of expected close.
    link: () => {
      const today = new Date();
      const thirty = new Date(today);
      thirty.setDate(thirty.getDate() + 30);
      return `/opportunities?owner=mine&stage=${OPEN_STAGES}&expected_after=${localISODate(today)}&expected_before=${localISODate(thirty)}`;
    },
    query: async (supabase, userId) => {
      // Count the 30-day forward window server-side (head:true) instead of
      // downloading every open opp and filtering in JS. The window mirrors
      // the deep-link above exactly (today → today+30, inclusive both ends),
      // so the card and the list it links to agree. expected_close_date is a
      // DATE column, compared to LOCAL YYYY-MM-DD strings via localISODate.
      const today = new Date();
      const thirty = new Date(today);
      thirty.setDate(thirty.getDate() + 30);
      const { count, error } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .not("stage", "in", '("closed_won","closed_lost")')
        .is("archived_at", null)
        .not("expected_close_date", "is", null)
        .gte("expected_close_date", localISODate(today))
        .lte("expected_close_date", localISODate(thirty));
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    id: "my_win_rate",
    label: "My Win Rate",
    category: "sales",
    icon: Percent,
    format: "percent",
    query: async (supabase, userId) => {
      // Independent count queries — run them concurrently instead of
      // awaiting won before starting lost (halves latency). The win-rate
      // formula below is unchanged.
      const [
        { count: wonCount, error: wonError },
        { count: lostCount, error: lostError },
      ] = await Promise.all([
        supabase
          .from("opportunities")
          .select("*", { count: "exact", head: true })
          .eq("owner_user_id", userId)
          .eq("stage", "closed_won")
          .is("archived_at", null),
        supabase
          .from("opportunities")
          .select("*", { count: "exact", head: true })
          .eq("owner_user_id", userId)
          .eq("stage", "closed_lost")
          .is("archived_at", null),
      ]);
      if (wonError) throw wonError;
      if (lostError) throw lostError;
      const won = wonCount ?? 0;
      const lost = lostCount ?? 0;
      const total = won + lost;
      if (total === 0) return 0;
      return Math.round((won / total) * 100);
    },
  },
  {
    id: "my_avg_deal_size",
    label: "My Average Deal Size",
    category: "sales",
    icon: BarChart3,
    format: "currency",
    query: async (supabase, userId) => {
      // Averaged in SQL. The client version paged nothing — it took
      // whatever ≤1000 closed-won rows PostgREST returned and divided by
      // that truncated length, so a rep past 1000 wins saw an average of
      // an arbitrary subset. The RPC's avg is sum/count(*), the same
      // maths (null amounts stay in the denominator).
      const { avg } = await oppStats(supabase, {
        p_owner_user_id: userId,
        p_stage: "closed_won",
      });
      return Math.round(avg);
    },
  },

  // ── Renewals ─────────────────────────────────────────────────────────────
  {
    id: "renewals_30",
    label: "Renewals Due in 30 Days",
    category: "renewals",
    icon: RefreshCw,
    format: "number",
    // Forward-looking renewals queue. Uses the renewals page's own
    // preset param so the page lands on "Next 30 days" (matching this
    // count). `fresh=1` tells the page to ignore the rep's saved
    // owner/exclude filters from localStorage so the count and the
    // filtered table match — and so it doesn't ruin the rep's saved
    // filters on the actual /renewals tab.
    link: "/renewals?preset=30&fresh=1",
    query: async (supabase) => {
      // Counted in SQL (same RPC as arr_at_risk): fetchRenewalQueue has no
      // paging, so past 1,000 queue rows the client filter counted an
      // arbitrary subset. The 0-30 window matches the page's preset=30
      // (forward-looking only — past-due excluded, per the earlier fix).
      const { count } = await renewalQueueArrStats(supabase, {
        daysUntilFrom: 0,
        daysUntilTo: 30,
      });
      return count;
    },
  },
  {
    id: "renewals_60",
    label: "Renewals Due in 60 Days",
    category: "renewals",
    icon: CalendarClock,
    format: "number",
    link: "/renewals?preset=60&fresh=1",
    query: async (supabase) => {
      // Counted in SQL — see renewals_30's note.
      const { count } = await renewalQueueArrStats(supabase, {
        daysUntilFrom: 0,
        daysUntilTo: 60,
      });
      return count;
    },
  },
  {
    id: "arr_at_risk",
    label: "Total ARR at Risk",
    category: "renewals",
    icon: AlertTriangle,
    format: "currency",
    link: "/renewals?fresh=1",
    query: async (supabase) => {
      // Summed in SQL (migration 20260817131000). This used to reduce
      // fetchRenewalQueue()'s rows in the browser — but that fetch has no
      // .range() paging, so PostgREST capped it at 1,000 rows and the tile
      // reported the ARR of an arbitrary subset (renewal_queue has no
      // ORDER BY, so not even a stable one) once the queue passed 1,000.
      //
      // No arguments: this KPI applies no filter of its own, so the RPC
      // sums the whole view — the 0-120 day window already lives inside
      // renewal_queue. Same number, one row over the wire.
      const { total } = await renewalQueueArrStats(supabase);
      return total;
    },
  },
  {
    id: "my_renewals",
    label: "My Renewals in Progress",
    category: "renewals",
    icon: RefreshCw,
    format: "number",
    link: () =>
      `/opportunities?owner=mine&kind=renewal&stage=${OPEN_STAGES}`,
    query: async (supabase, userId) => {
      const { count, error } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .eq("kind", "renewal")
        .is("archived_at", null)
        .not("stage", "in", '("closed_won","closed_lost")');
      if (error) throw error;
      return count ?? 0;
    },
  },

  // ── Team / Admin ─────────────────────────────────────────────────────────
  {
    id: "team_pipeline",
    label: "Team Total Pipeline",
    category: "team",
    icon: DollarSign,
    format: "currency",
    requiredRole: ["admin"],
    link: `/opportunities?stage=${OPEN_STAGES}`,
    query: async (supabase) => {
      return sumOppAmounts(supabase, { openOnly: true });
    },
  },
  {
    id: "active_accounts",
    // Was "Total Active Accounts" but counted EVERY non-archived account with
    // no status filter — misleading next to the new Account Status. Now counts
    // actual customers (customer_status='client'). (Account restructure Step 2.)
    label: "Active Customers",
    category: "team",
    icon: Building2,
    format: "number",
    requiredRole: ["admin"],
    link: "/accounts?customer=client",
    query: async (supabase) => {
      const { count, error } = await supabase
        .from("accounts")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null)
        .eq("customer_status", "client");
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    id: "total_contacts",
    label: "Total Contacts",
    category: "team",
    icon: Users,
    format: "number",
    requiredRole: ["admin"],
    link: "/contacts",
    query: async (supabase) => {
      const { count, error } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null)
        // Pending imports aren't contacts yet.
        .is("import_status", null);
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    id: "team_closed_month",
    label: "Team Closed Won This Month",
    category: "team",
    icon: Trophy,
    format: "currency",
    requiredRole: ["admin"],
    // Filter the list to closed-won AND close_date >= start of this
    // calendar month, so the totals strip on the opp list matches the
    // count on the card. Without `closed_after`, the link landed on
    // every closed-won opp ever and showed e.g. $4M vs the card's
    // $3,600.
    link: () =>
      `/opportunities?stage=closed_won&closed_after=${localISODate(getMonthStart(new Date()))}`,
    query: async (supabase) => {
      const monthStart = getMonthStart(new Date());
      // Summed in SQL — the client reduce silently truncated at PostgREST's
      // 1000-row cap. close_date is a DATE, so the bound stays the LOCAL
      // month-start date (see the quarter KPI note); toISOString() drops
      // deals closed on the 1st for US zones.
      const { total } = await oppStats(supabase, {
        p_stage: "closed_won",
        p_close_date_from: localISODate(monthStart),
      });
      return total;
    },
  },
  {
    // Key kept as total_leads so saved dashboard configs don't break —
    // the lead type is retired; this now counts the Imports pen.
    id: "total_leads",
    label: "Pending Imports",
    category: "team",
    icon: UserPlus,
    format: "number",
    requiredRole: ["admin"],
    link: "/imports",
    query: async (supabase) => {
      const { count, error } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .eq("import_status", "pending")
        .is("archived_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    id: "mql_count",
    label: "MQL Count",
    category: "team",
    icon: Target,
    format: "number",
    requiredRole: ["admin"],
    query: async (supabase) => {
      // MQL lives on contacts since the lead-type retirement (2026-07-20).
      const { count, error } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .not("mql_date", "is", null)
        .is("archived_at", null)
        .is("import_status", null);
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    id: "sql_count",
    label: "SQL Count",
    category: "team",
    icon: Target,
    format: "number",
    requiredRole: ["admin"],
    query: async (supabase) => {
      // SQL lives on contacts since the lead-type retirement (2026-07-20).
      const { count, error } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .not("sql_date", "is", null)
        .is("archived_at", null)
        .is("import_status", null);
      if (error) throw error;
      return count ?? 0;
    },
  },
  {
    // Key kept as new_leads_month for saved dashboards; counts contacts
    // that arrived through the pen or website this month.
    id: "new_leads_month",
    label: "New Imports This Month",
    category: "team",
    icon: UserPlus,
    format: "number",
    requiredRole: ["admin"],
    link: "/imports",
    query: async (supabase) => {
      const monthStart = getMonthStart(new Date());
      const { count, error } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .or("import_status.eq.pending,import_company.not.is.null")
        .is("archived_at", null)
        .gte("created_at", monthStart.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  },
];

// ---------------------------------------------------------------------------
// Defaults per role
// ---------------------------------------------------------------------------

export const DEFAULT_KPIS: Record<AppRole, string[]> = {
  sales: [
    "my_open_pipeline",
    "my_deals_in_progress",
    "closed_won_quarter",
    "upcoming_close",
  ],
  renewals: ["renewals_30", "renewals_60", "arr_at_risk", "my_renewals"],
  // read_only sees the same default KPI set as sales — they can SELECT
  // anything but can't act on it. UI gating handles the rest.
  read_only: [
    "my_open_pipeline",
    "my_deals_in_progress",
    "closed_won_quarter",
    "upcoming_close",
  ],
  admin: [
    "my_open_pipeline",
    "my_deals_in_progress",
    "closed_won_quarter",
    "upcoming_close",
    "renewals_30",
    "renewals_60",
    "arr_at_risk",
    "my_renewals",
    "team_pipeline",
    "active_accounts",
    "total_contacts",
    "team_closed_month",
  ],
  super_admin: [
    "my_open_pipeline",
    "my_deals_in_progress",
    "closed_won_quarter",
    "upcoming_close",
    "renewals_30",
    "renewals_60",
    "arr_at_risk",
    "my_renewals",
    "team_pipeline",
    "active_accounts",
    "total_contacts",
    "team_closed_month",
  ],
};

// ---------------------------------------------------------------------------
// LocalStorage helpers
// ---------------------------------------------------------------------------

const KPI_CONFIG_KEY = "crm_kpi_config";

// Renamed KPI ids: keep anyone who pinned the old id from losing their tile.
// Old localStorage entries are remapped on load (and de-duped).
const KPI_ID_ALIASES: Record<string, string> = {
  calls_this_month: "calls_this_week",
};

export function loadKpiConfig(role: AppRole): string[] {
  try {
    const stored = localStorage.getItem(KPI_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const migrated = parsed.map((id) => KPI_ID_ALIASES[id] ?? id);
        return [...new Set(migrated)];
      }
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_KPIS[role];
}

export function saveKpiConfig(selectedIds: string[]): void {
  localStorage.setItem(KPI_CONFIG_KEY, JSON.stringify(selectedIds));
}

export function getKpiById(id: string): KpiDefinition | undefined {
  return KPI_REGISTRY.find((k) => k.id === id);
}

export function getAvailableKpis(role: AppRole): KpiDefinition[] {
  return KPI_REGISTRY.filter(
    (kpi) => !kpi.requiredRole || kpi.requiredRole.includes(role),
  );
}
