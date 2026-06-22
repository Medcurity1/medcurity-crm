// Task-recurrence UI <-> DB mapping (V2-A3). The four supported cadences:
//   Daily · Every N days · Weekly (on the due date's weekday) · Monthly
//   (on the due date's day-of-month).
// The weekday / day-of-month are DERIVED from the due date the user picked,
// so the form only needs a frequency (+ an interval for "every N days").

import type { TaskRecurrenceFreq } from "@/types/crm";

export type RecurrenceMode =
  | "none"
  | "daily"
  | "everyNDays"
  | "weekly"
  | "monthly";

export interface RecurrenceUI {
  mode: RecurrenceMode;
  /** Only used when mode === "everyNDays". */
  interval: number;
  /** Optional "stop repeating after" date, "YYYY-MM-DD" or "". */
  until: string;
}

export const EMPTY_RECURRENCE: RecurrenceUI = {
  mode: "none",
  interval: 2,
  until: "",
};

export interface RecurrenceFields {
  recur_freq: TaskRecurrenceFreq | null;
  recur_interval: number;
  recur_weekday: number | null;
  recur_monthday: number | null;
  recur_until: string | null;
}

export const NO_RECURRENCE: RecurrenceFields = {
  recur_freq: null,
  recur_interval: 1,
  recur_weekday: null,
  recur_monthday: null,
  recur_until: null,
};

/**
 * Convert the UI selection into the recur_* columns. `dueLocal` is the
 * datetime-local string the user entered ("YYYY-MM-DDTHH:mm"); weekday /
 * day-of-month are read from it so they reflect exactly what the user
 * picked (no timezone surprises from converting to UTC first).
 */
export function buildRecurrenceFields(
  ui: RecurrenceUI,
  dueLocal: string,
): RecurrenceFields {
  if (ui.mode === "none") return { ...NO_RECURRENCE };
  const d = dueLocal ? new Date(dueLocal) : null;
  const until = ui.until || null;

  switch (ui.mode) {
    case "daily":
      return { recur_freq: "daily", recur_interval: 1, recur_weekday: null, recur_monthday: null, recur_until: until };
    case "everyNDays":
      return {
        recur_freq: "daily",
        recur_interval: Math.max(1, Math.round(ui.interval) || 1),
        recur_weekday: null,
        recur_monthday: null,
        recur_until: until,
      };
    case "weekly":
      // Weekly just adds N*7 days to the stored instant, which preserves the
      // weekday in any fixed zone, so recur_weekday is informational only.
      return { recur_freq: "weekly", recur_interval: 1, recur_weekday: d ? d.getUTCDay() : null, recur_monthday: null, recur_until: until };
    case "monthly":
      // IMPORTANT: derive day-of-month from the UTC representation, because
      // due_at is stored as UTC and the DB's next_task_due() truncates the
      // month in UTC (pg_cron/PostgREST sessions run in UTC). Using the
      // browser-local day would land evening due times a day early for
      // negative-UTC users (the whole US team).
      return { recur_freq: "monthly", recur_interval: 1, recur_weekday: null, recur_monthday: d ? d.getUTCDate() : null, recur_until: until };
    default:
      return { ...NO_RECURRENCE };
  }
}

/** Rebuild the UI state from a saved activity (for the edit dialog). */
export function recurrenceToUI(a: {
  recur_freq?: TaskRecurrenceFreq | null;
  recur_interval?: number | null;
  recur_until?: string | null;
}): RecurrenceUI {
  const until = a.recur_until ?? "";
  if (!a.recur_freq) return { ...EMPTY_RECURRENCE };
  if (a.recur_freq === "daily") {
    const iv = a.recur_interval ?? 1;
    return { mode: iv > 1 ? "everyNDays" : "daily", interval: iv > 1 ? iv : 2, until };
  }
  if (a.recur_freq === "weekly") return { mode: "weekly", interval: 2, until };
  return { mode: "monthly", interval: 2, until };
}

/** Short label for the recurrence badge ("Daily", "Every 3 days", …). */
export function describeRecurrence(a: {
  recur_freq?: TaskRecurrenceFreq | null;
  recur_interval?: number | null;
}): string | null {
  if (!a.recur_freq) return null;
  if (a.recur_freq === "daily") {
    const iv = a.recur_interval ?? 1;
    return iv > 1 ? `Every ${iv} days` : "Daily";
  }
  if (a.recur_freq === "weekly") return "Weekly";
  return "Monthly";
}

/** True when a recurring mode requires a due date to derive its schedule. */
export function recurrenceNeedsDue(mode: RecurrenceMode): boolean {
  return mode !== "none";
}
