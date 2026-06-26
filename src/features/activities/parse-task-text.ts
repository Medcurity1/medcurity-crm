// Natural-language parsing of a task subject (Todoist-style smart entry).
// As the rep types "Call Dr. Lee tomorrow at 8am" or "Send report every Monday",
// we pull out the due date/time and any recurrence, and offer a cleaned title
// ("Call Dr. Lee"). chrono-node does the date heavy-lifting; recurrence is a
// small, deliberately CONSERVATIVE matcher ("every ..." only) so a one-off
// "weekly report" task isn't turned into a repeating task.

import * as chrono from "chrono-node";
import type { RecurrenceUI } from "./recurrence";

/** [start, end) character range into the parsed text. */
export type Range = [number, number];

export interface ParsedTaskText {
  /** Parsed due date/time (with a default 9am when no clock time was given). */
  date: Date | null;
  /** True when the text named an explicit clock time (vs a bare day). */
  hasTime: boolean;
  /** Range of the matched date phrase in the input. */
  dateRange: Range | null;
  recurrence: RecurrenceUI | null;
  /** Short label for the recurrence, e.g. "Weekly", "Every 3 days". */
  recurrenceLabel: string | null;
  /** Range of the matched recurrence phrase in the input. */
  recurrenceRange: Range | null;
  /** The subject with BOTH detected phrases stripped. */
  cleanedSubject: string;
  /** True if a date or recurrence was detected. */
  matched: boolean;
}

// Time-of-day for a date given with no clock time ("tomorrow" -> 9:00am).
const DEFAULT_HOUR = 9;

// Reject chrono matches that are bare numbers/years ("review 2024 numbers",
// "top 5 accounts") — only accept matches that read like a date: they contain a
// letter (tomorrow, 8am, next fri, June 30) or a slash/dash date (6/30, 7-1).
function isDateLike(s: string): boolean {
  return /[a-z]/i.test(s) || /\d{1,2}\s*[/-]\s*\d{1,2}/.test(s);
}

function detectRecurrence(
  text: string,
): { ui: RecurrenceUI; label: string; range: Range } | null {
  const everyN = /\bevery\s+(\d+)\s+days?\b/i.exec(text);
  if (everyN) {
    const n = Math.max(1, parseInt(everyN[1], 10) || 1);
    return {
      ui: { mode: n === 1 ? "daily" : "everyNDays", interval: n, until: "" },
      label: n === 1 ? "Daily" : `Every ${n} days`,
      range: [everyN.index, everyN.index + everyN[0].length],
    };
  }
  // "every other week" / biweekly is intentionally NOT matched — the recurrence
  // model has no every-N-weeks cadence, so auto-detecting it would silently
  // save a plain weekly task. ("every other day" is fine — it routes through
  // everyNDays.) Order matters: "every other day" before "every day".
  const rules: { re: RegExp; ui: RecurrenceUI; label: string }[] = [
    { re: /\bevery other day\b/i, ui: { mode: "everyNDays", interval: 2, until: "" }, label: "Every 2 days" },
    { re: /\bevery\s+(?:sun|mon|tues?|wednes?|thurs?|fri|satur?)(?:day)?s?\b/i, ui: { mode: "weekly", interval: 1, until: "" }, label: "Weekly" },
    { re: /\bevery\s*day\b/i, ui: { mode: "daily", interval: 1, until: "" }, label: "Daily" },
    { re: /\bevery\s*week\b/i, ui: { mode: "weekly", interval: 1, until: "" }, label: "Weekly" },
    { re: /\bevery\s*month\b/i, ui: { mode: "monthly", interval: 1, until: "" }, label: "Monthly" },
  ];
  for (const { re, ui, label } of rules) {
    const m = re.exec(text);
    if (m) return { ui, label, range: [m.index, m.index + m[0].length] };
  }
  return null;
}

export function parseTaskText(text: string, ref: Date = new Date()): ParsedTaskText {
  const recur = detectRecurrence(text);

  let date: Date | null = null;
  let hasTime = false;
  let dateRange: Range | null = null;
  // forwardDate: a bare "Friday" / "the 3rd" means the UPCOMING one.
  const results = chrono.parse(text, ref, { forwardDate: true });
  const result = results.find((r) => isDateLike(r.text));
  if (result) {
    date = result.start.date();
    hasTime = result.start.isCertain("hour");
    dateRange = [result.index, result.index + result.text.length];
  }

  if (date && !hasTime) {
    date = new Date(date);
    date.setHours(DEFAULT_HOUR, 0, 0, 0);
  }

  // Recurrence with no concrete date ("every day"): anchor to the next 9am —
  // today if it's still upcoming, otherwise tomorrow — so the task (and its
  // due-date reminder) is never born in the past.
  if (!date && recur) {
    const anchor = new Date(ref);
    anchor.setHours(DEFAULT_HOUR, 0, 0, 0);
    if (anchor.getTime() <= ref.getTime()) anchor.setDate(anchor.getDate() + 1);
    date = anchor;
    hasTime = false;
  }

  const cleanedSubject = removeRanges(text, [recur?.range ?? null, dateRange]);
  return {
    date,
    hasTime,
    dateRange,
    recurrence: recur?.ui ?? null,
    recurrenceLabel: recur?.label ?? null,
    recurrenceRange: recur?.range ?? null,
    cleanedSubject,
    matched: !!(date || recur),
  };
}

/**
 * Remove the given character ranges from the text in ONE pass, merging any that
 * overlap (e.g. "every Tuesday" and chrono's "Tuesday at 2pm" share "Tuesday").
 * Sequential substring removal would leave an orphaned "at 2pm" in the title.
 */
export function removeRanges(text: string, ranges: (Range | null)[]): string {
  const merged = ranges
    .filter((r): r is Range => !!r && r[1] > r[0])
    .sort((a, b) => a[0] - b[0])
    .reduce<Range[]>((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else acc.push([r[0], r[1]]);
      return acc;
    }, []);
  let out = text;
  for (let i = merged.length - 1; i >= 0; i--) {
    out = out.slice(0, merged[i][0]) + " " + out.slice(merged[i][1]);
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}

/** Format a Date as a datetime-local value ("YYYY-MM-DDTHH:mm") in local time. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Friendly label for the smart chip, e.g. "Tomorrow, 8:00 AM". */
export function formatParsedDate(date: Date): string {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000,
  );
  let dayPart: string;
  if (dayDiff === 0) dayPart = "Today";
  else if (dayDiff === 1) dayPart = "Tomorrow";
  else dayPart = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const timePart = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dayPart}, ${timePart}`;
}
