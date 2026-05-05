/**
 * Manually-entered Team Dashboard widgets (Most Recent Quote, QTD Billing
 * actual override, Development project line items). These are the ones
 * that don't have a CRM data source yet — admins type the values in
 * directly on the dashboard.
 *
 * Persisted to localStorage today; can be DB-backed later without
 * changing callers.
 */

export const WIDGETS_LS_KEY = "team_dashboard_widgets_v1";

export interface DevItem {
  id: string;
  project: string;
  completion_date: string; // YYYY-MM-DD
  complete: boolean;
  status: string; // "Past Due" | "Complete" | "On Track" | etc. — free text
}

export interface DashboardWidgets {
  /** Most Recent Quote — free text + attribution */
  quote_text: string;
  quote_author: string;
  /** Quote rating shown next to title, e.g. "10/10" */
  quote_rating: string;

  /**
   * QTD Billing — manual override. Empty/null means "use computed
   * value (new sales + renewals closed)".
   */
  qtd_billing_actual: number | null;

  /** Development project line items */
  dev_items: DevItem[];
}

export const DEFAULT_WIDGETS: DashboardWidgets = {
  quote_text: "",
  quote_author: "",
  quote_rating: "",
  qtd_billing_actual: null,
  dev_items: [],
};

export function loadWidgets(): DashboardWidgets {
  if (typeof window === "undefined") return DEFAULT_WIDGETS;
  try {
    const raw = window.localStorage.getItem(WIDGETS_LS_KEY);
    if (!raw) return DEFAULT_WIDGETS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_WIDGETS,
      ...parsed,
      dev_items: Array.isArray(parsed?.dev_items) ? parsed.dev_items : [],
    };
  } catch {
    return DEFAULT_WIDGETS;
  }
}

export function saveWidgets(w: DashboardWidgets) {
  try {
    window.localStorage.setItem(WIDGETS_LS_KEY, JSON.stringify(w));
  } catch {
    /* ignore */
  }
}

export function newDevItem(): DevItem {
  return {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : String(Math.random()).slice(2),
    project: "",
    completion_date: new Date().toISOString().slice(0, 10),
    complete: false,
    status: "On Track",
  };
}

/** Auto-derive a status from date+complete; user can still override. */
export function autoStatus(item: DevItem): string {
  if (item.complete) return "Complete";
  const due = new Date(item.completion_date);
  if (Number.isNaN(due.getTime())) return "—";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  if (due < today) return "Past Due";
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays <= 7) return "Due Soon";
  return "On Track";
}

export const STATUS_TONES: Record<string, string> = {
  Complete:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  "Past Due":
    "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  "Due Soon":
    "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  "On Track":
    "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
};
