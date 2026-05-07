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
async function fetchAllOppAmounts(
  supabase: SupabaseClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyFilters: (q: any) => any,
): Promise<number[]> {
  const all: number[] = [];
  let from = 0;
  const pageSize = 1000;
  while (all.length < 50_000) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: any = supabase.from("opportunities").select("amount");
    const { data, error } = await applyFilters(base).range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as { amount: number | string | null }[];
    for (const r of rows) all.push(Number(r.amount ?? 0));
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
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
].join(",");

function getQuarterStart(date: Date): Date {
  const month = date.getMonth();
  const quarterStartMonth = month - (month % 3);
  return new Date(date.getFullYear(), quarterStartMonth, 1);
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
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
      const amounts = await fetchAllOppAmounts(supabase, (q) =>
        q
          .eq("owner_user_id", userId)
          .not("stage", "in", '("closed_won","closed_lost")')
          .is("archived_at", null),
      );
      return amounts.reduce((s, n) => s + n, 0);
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
      const { count } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .not("stage", "in", '("closed_won","closed_lost")')
        .is("archived_at", null);
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
      `/opportunities?owner=mine&stage=closed_won&closed_after=${localISODate(getQuarterStart(new Date()))}`,
    query: async (supabase, userId) => {
      const quarterStart = getQuarterStart(new Date());
      const { count } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .gte("close_date", quarterStart.toISOString());
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
      const now = new Date();
      const thirtyDaysOut = new Date(now);
      thirtyDaysOut.setDate(thirtyDaysOut.getDate() + 30);
      const { data } = await supabase
        .from("opportunities")
        .select("expected_close_date")
        .eq("owner_user_id", userId)
        .not("stage", "in", '("closed_won","closed_lost")')
        .is("archived_at", null);
      return (
        data?.filter((o) => {
          if (!o.expected_close_date) return false;
          const d = new Date(o.expected_close_date);
          return d >= now && d <= thirtyDaysOut;
        }).length ?? 0
      );
    },
  },
  {
    id: "my_win_rate",
    label: "My Win Rate",
    category: "sales",
    icon: Percent,
    format: "percent",
    query: async (supabase, userId) => {
      const { count: wonCount } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .eq("stage", "closed_won")
        .is("archived_at", null);
      const { count: lostCount } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .eq("stage", "closed_lost")
        .is("archived_at", null);
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
      const { data } = await supabase
        .from("opportunities")
        .select("amount")
        .eq("owner_user_id", userId)
        .eq("stage", "closed_won")
        .is("archived_at", null);
      if (!data?.length) return 0;
      const total = data.reduce((sum, o) => sum + Number(o.amount), 0);
      return Math.round(total / data.length);
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
      const { data } = await supabase
        .from("renewal_queue")
        .select("days_until_renewal");
      // Forward-looking only: matches the page's preset=30 window
      // (today → today+30). Earlier this also included past-due
      // (negative days_until_renewal), which made the count exceed
      // what the renewals page showed.
      return (
        data?.filter(
          (r) =>
            r.days_until_renewal !== null &&
            r.days_until_renewal >= 0 &&
            r.days_until_renewal <= 30,
        ).length ?? 0
      );
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
      const { data } = await supabase
        .from("renewal_queue")
        .select("days_until_renewal");
      return (
        data?.filter(
          (r) =>
            r.days_until_renewal !== null &&
            r.days_until_renewal >= 0 &&
            r.days_until_renewal <= 60,
        ).length ?? 0
      );
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
      const { data } = await supabase
        .from("renewal_queue")
        .select("current_arr");
      return data?.reduce((sum, r) => sum + Number(r.current_arr), 0) ?? 0;
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
      const { count } = await supabase
        .from("opportunities")
        .select("*", { count: "exact", head: true })
        .eq("owner_user_id", userId)
        .eq("kind", "renewal")
        .is("archived_at", null)
        .not("stage", "in", '("closed_won","closed_lost")');
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
      const amounts = await fetchAllOppAmounts(supabase, (q) =>
        q
          .is("archived_at", null)
          .not("stage", "in", '("closed_won","closed_lost")'),
      );
      return amounts.reduce((s, n) => s + n, 0);
    },
  },
  {
    id: "active_accounts",
    label: "Total Active Accounts",
    category: "team",
    icon: Building2,
    format: "number",
    requiredRole: ["admin"],
    link: "/accounts",
    query: async (supabase) => {
      const { count } = await supabase
        .from("accounts")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null);
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
      const { count } = await supabase
        .from("contacts")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null);
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
      const { data } = await supabase
        .from("opportunities")
        .select("amount")
        .eq("stage", "closed_won")
        .is("archived_at", null)
        .gte("close_date", monthStart.toISOString());
      return data?.reduce((sum, o) => sum + Number(o.amount), 0) ?? 0;
    },
  },
  {
    id: "total_leads",
    label: "Total Leads",
    category: "team",
    icon: UserPlus,
    format: "number",
    requiredRole: ["admin"],
    query: async (supabase) => {
      const { count } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null);
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
      const { count } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("qualification", "mql")
        .is("archived_at", null);
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
      const { count } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("qualification", "sql")
        .is("archived_at", null);
      return count ?? 0;
    },
  },
  {
    id: "new_leads_month",
    label: "New Leads This Month",
    category: "team",
    icon: UserPlus,
    format: "number",
    requiredRole: ["admin"],
    query: async (supabase) => {
      const monthStart = getMonthStart(new Date());
      const { count } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .is("archived_at", null)
        .gte("created_at", monthStart.toISOString());
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

export function loadKpiConfig(role: AppRole): string[] {
  try {
    const stored = localStorage.getItem(KPI_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as string[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
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
