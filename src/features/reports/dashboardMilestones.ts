/**
 * Dashboard milestones (Development section line items). Mirrors
 * Codex's Python dashboard storage key `dashboard_milestones_v1` so
 * the same data renders in both UIs.
 *
 * Migration nuance: a previous round of the React dashboard kept dev
 * items inside `team_dashboard_widgets_v1.dev_items`. When this module
 * loads, it copies those over once into the new key so Brayden doesn't
 * lose the rows he typed in.
 */

export const MILESTONES_LS_KEY = "dashboard_milestones_v1";
const LEGACY_WIDGETS_KEY = "team_dashboard_widgets_v1";

export interface Milestone {
  id: string;
  project: string;
  completion_date: string; // YYYY-MM-DD
  complete: boolean;
  /**
   * Legacy free-text override field. Kept on the type for backwards
   * compat with existing localStorage records, but the UI no longer
   * exposes it — status is now purely auto-derived from the date +
   * complete checkbox per Codex's logic.
   */
  status?: string;
}

export function newMilestone(): Milestone {
  return {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Math.random()).slice(2),
    project: "",
    completion_date: new Date().toISOString().slice(0, 10),
    complete: false,
  };
}

function migrateFromLegacy(): Milestone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_WIDGETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.dev_items) ? parsed.dev_items : [];
    return items.map(
      (it: any): Milestone => ({
        id: String(it?.id ?? newMilestone().id),
        project: String(it?.project ?? ""),
        completion_date: String(it?.completion_date ?? ""),
        complete: Boolean(it?.complete),
      }),
    );
  } catch {
    return [];
  }
}

export function loadMilestones(): Milestone[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(MILESTONES_LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as Milestone[];
    }
    // Cold start — pull from legacy widgets store and persist forward.
    const legacy = migrateFromLegacy();
    if (legacy.length > 0) {
      saveMilestones(legacy);
    }
    return legacy;
  } catch {
    return [];
  }
}

export function saveMilestones(items: Milestone[]) {
  try {
    window.localStorage.setItem(MILESTONES_LS_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

/**
 * Auto-derive status from date + complete (Codex parity, no manual
 * override): Complete (checked) → Complete; due in the past and not
 * complete → Past Due; due within the next 7 days → Due Soon; further
 * out → On Track. Status is rendered as a colored badge using
 * STATUS_TONES below.
 */
export function deriveStatus(item: Milestone): string {
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
