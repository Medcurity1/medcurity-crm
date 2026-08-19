// Pure Your Day hide/snooze helpers. Kept free of React and Supabase so
// the "third Not today" prompt, category labels, and the task-reminder
// safety rail can be unit-tested without rendering Nexus.

export const ASK_TO_HIDE_EVERY = 3;

/** Categories the Tune your list control always shows, in display order. */
export const DAY_QUEUE_CATEGORIES = [
  { id: "reply", label: "Replies", hideable: true },
  { id: "request:product", label: "Product requests", hideable: true },
  { id: "request:crm", label: "CRM requests", hideable: true },
  { id: "request:collateral", label: "Collateral requests", hideable: true },
  { id: "renewal", label: "Renewals", hideable: true },
  { id: "campaign_task", label: "Campaign steps", hideable: true },
  { id: "outreach_paused", label: "Meeting prep", hideable: true },
  { id: "stale_deal", label: "Quiet deals", hideable: true },
  { id: "task", label: "Tasks", hideable: false },
] as const;

export type DayQueueCategoryId = (typeof DAY_QUEUE_CATEGORIES)[number]["id"];

const CATEGORY_BY_ID = new Map<string, (typeof DAY_QUEUE_CATEGORIES)[number]>(
  DAY_QUEUE_CATEGORIES.map((c) => [c.id, c]),
);

const CATEGORY_ID_RE = /^[a-z][a-z0-9_:%]*$/;

export interface DayQueueCategorySource {
  kind: string;
  category?: string | null;
}

/** Server-sent category, falling back to kind when the column is absent. */
export function categoryOf(row: DayQueueCategorySource): string {
  const fromRow = (row.category ?? "").trim();
  if (fromRow) return fromRow;
  return row.kind;
}

export function categoryLabel(category: string): string {
  const known = CATEGORY_BY_ID.get(category);
  if (known) return known.label;
  if (category.startsWith("request:")) {
    const type = category.slice("request:".length);
    if (!type) return "Requests";
    return `${type.charAt(0).toUpperCase()}${type.slice(1)} requests`;
  }
  if (category === "request") return "Requests";
  return category.replace(/_/g, " ");
}

/**
 * Group hide is exact-category only. Regular tasks cannot be turned off as
 * a group: one Not today (or one "like this") must never suppress the
 * whole task list.
 */
export function canHideCategory(category: string): boolean {
  if (!category || category === "task") return false;
  if (category === "*" || category === "%" || category === "all") return false;
  const known = CATEGORY_BY_ID.get(category);
  if (known) return known.hideable;
  return CATEGORY_ID_RE.test(category);
}

export function shouldAskToHide(dismissCount: number): boolean {
  return (
    Number.isInteger(dismissCount) &&
    dismissCount >= ASK_TO_HIDE_EVERY &&
    dismissCount % ASK_TO_HIDE_EVERY === 0
  );
}

export function stopCategoryLabel(category: string): string {
  return `Stop ${categoryLabel(category).toLowerCase()}`;
}

export function hidePromptCopy(row: DayQueueCategorySource & { title?: string | null }): {
  title: string;
  body: string;
  hint: string | null;
  stopItemLabel: string;
  stopCategoryLabel: string | null;
  keepLabel: string;
} {
  const category = categoryOf(row);
  const hideCategory = canHideCategory(category);
  const isRequest = category === "request" || category.startsWith("request:");
  return {
    title: "Stop seeing this?",
    body: "You've set this aside a few times.",
    hint: isRequest ? "You can still find these in Requests." : null,
    stopItemLabel: "Stop this reminder",
    stopCategoryLabel: hideCategory ? stopCategoryLabel(category) : null,
    keepLabel: "Keep showing it",
  };
}

export const CATEGORY_DOT: Record<string, string> = {
  reply: "bg-rose-500 dark:bg-rose-400",
  "request:product": "bg-orange-500 dark:bg-orange-400",
  "request:crm": "bg-emerald-500 dark:bg-emerald-400",
  "request:collateral": "bg-violet-500 dark:bg-violet-400",
  request: "bg-sky-500 dark:bg-sky-400",
  renewal: "bg-blue-500 dark:bg-blue-400",
  task: "bg-amber-500 dark:bg-amber-400",
  campaign_task: "bg-violet-500 dark:bg-violet-400",
  outreach_paused: "bg-cyan-500 dark:bg-cyan-400",
  stale_deal: "bg-slate-400 dark:bg-slate-500",
};

export function categoryDotClass(category: string): string {
  if (CATEGORY_DOT[category]) return CATEGORY_DOT[category];
  if (category.startsWith("request:")) return CATEGORY_DOT.request;
  return "bg-slate-400 dark:bg-slate-500";
}

/** UTC offset of America/Los_Angeles at `at`, in minutes (negative west). */
function pacificOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asIfUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/**
 * Tomorrow at 4am Pacific, as an instant. 4am is before anyone's workday
 * starts, so a snoozed row is back at the top of the next morning's
 * briefing.
 */
export function nextFourAmPacific(now: Date = new Date()): Date {
  const offsetNow = pacificOffsetMinutes(now);
  const pacificClock = new Date(now.getTime() + offsetNow * 60_000);
  const wallClock = Date.UTC(
    pacificClock.getUTCFullYear(),
    pacificClock.getUTCMonth(),
    pacificClock.getUTCDate() + 1,
    4,
    0,
    0,
  );
  let target = wallClock - offsetNow * 60_000;
  const offsetThen = pacificOffsetMinutes(new Date(target));
  if (offsetThen !== offsetNow) target = wallClock - offsetThen * 60_000;
  return new Date(target);
}
