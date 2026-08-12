// Shared task-priority semantics + ordering. Centralized so the homepage
// "My Tasks" widget, the per-record TasksPanel, and any list all agree on:
//   - what the three tiers are called (High / Medium / Low),
//   - that a NULL priority means Medium (the default tier — see V2-A1),
//   - the red / yellow / gray indicator colors, and
//   - the canonical sort: due date first, then priority as the tiebreak.
//
// The DB enum is activity_priority = ('high','normal','low') with no
// 'medium' member (adding one would be non-reversible — enum values can't
// be dropped). So 'normal' IS the Medium tier; we only relabel it in the UI.

export type TaskPriority = "high" | "normal" | "low" | null | undefined;

// Lower rank sorts first. NULL collapses to 'normal' (Medium) so untagged
// legacy tasks slot between High and Low rather than to one extreme.
const PRIORITY_RANK: Record<"high" | "normal" | "low", number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export function priorityRank(p: TaskPriority): number {
  return PRIORITY_RANK[p ?? "normal"];
}

/** Human label for the three tiers. 'normal' renders as "Medium". */
export function priorityLabel(p: TaskPriority): string {
  const eff = p ?? "normal";
  if (eff === "high") return "High";
  if (eff === "low") return "Low";
  return "Medium";
}

/** Tailwind bg class for the small priority dot: red / yellow / gray. */
export function priorityDotClass(p: TaskPriority): string {
  const eff = p ?? "normal";
  if (eff === "high") return "bg-red-500";
  if (eff === "low") return "bg-gray-400";
  return "bg-yellow-500";
}

/** Tailwind classes for the priority pill (text + bg), incl. dark mode. */
export function priorityPillClass(p: TaskPriority): string {
  const eff = p ?? "normal";
  if (eff === "high")
    return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  if (eff === "low")
    return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300";
  return "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300";
}

/**
 * Canonical task order: earliest due date first (tasks with no due date
 * sink to the bottom, matching the existing `nullsFirst: false` queries),
 * then High → Medium → Low as the tiebreak when due dates are equal.
 */
export function compareTasksByDueThenPriority(
  a: { due_at: string | null; priority?: TaskPriority },
  b: { due_at: string | null; priority?: TaskPriority },
): number {
  return compareTasksByDue(a, b, false);
}

/**
 * Direction-aware variant for the Activities page's clickable Due header
 * (Molly's task-organization pass, 2026-08-12). Undated tasks stay LAST in
 * both directions (flipping them to the top would bury every real due
 * date), and priority always breaks ties High-first — reversing the
 * priority tiebreak with the arrow would be meaningless.
 */
export function compareTasksByDue(
  a: { due_at: string | null; priority?: TaskPriority },
  b: { due_at: string | null; priority?: TaskPriority },
  descending = false,
): number {
  const ad = a.due_at;
  const bd = b.due_at;
  if (ad && bd) {
    const diff = new Date(ad).getTime() - new Date(bd).getTime();
    if (diff !== 0) return descending ? -diff : diff;
  } else if (ad && !bd) {
    return -1; // a has a due date, b doesn't → a first
  } else if (!ad && bd) {
    return 1; // b has a due date, a doesn't → b first
  }
  // Same due date (or both undated) → priority decides.
  return priorityRank(a.priority) - priorityRank(b.priority);
}

// ── Urgency buckets + due chips (Molly's task-organization pass) ──────
// One shared vocabulary for "how soon": the section headers in the tasks
// panels, the bucket rows on the task-filtered Activities list, and the
// tinted due chips all read from here so they can never disagree.

export type TaskDueBucket = "overdue" | "today" | "week" | "later" | "none";

/** Bucket display order + labels. "week" = the next 7 calendar days. */
export const DUE_BUCKET_ORDER: TaskDueBucket[] = [
  "overdue",
  "today",
  "week",
  "later",
  "none",
];

export const DUE_BUCKET_LABELS: Record<TaskDueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  week: "This week",
  later: "Later",
  none: "No due date",
};

/** Small dot color for each bucket header (matches the chip palette). */
export const DUE_BUCKET_DOT: Record<TaskDueBucket, string> = {
  overdue: "bg-rose-500",
  today: "bg-amber-500",
  week: "bg-sky-500",
  later: "bg-slate-400",
  none: "bg-slate-300 dark:bg-slate-600",
};

/** Calendar-day difference (due minus now), ignoring time of day. */
function calendarDayDiff(dueAt: string, now: Date): number {
  const due = new Date(dueAt);
  const a = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

export function taskDueBucket(
  dueAt: string | null | undefined,
  now: Date = new Date(),
): TaskDueBucket {
  if (!dueAt) return "none";
  const days = calendarDayDiff(dueAt, now);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "week";
  return "later";
}

/**
 * Chip wording: relative when it helps ("3d overdue", "Due today", "Due
 * tomorrow", "Due Fri"), absolute when it's far enough out that a weekday
 * name stops meaning anything ("Due Aug 29", year added when different).
 */
export function taskDueChipLabel(dueAt: string, now: Date = new Date()): string {
  const days = calendarDayDiff(dueAt, now);
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  const due = new Date(dueAt);
  if (days <= 6) {
    return `Due ${due.toLocaleDateString(undefined, { weekday: "short" })}`;
  }
  const sameYear = due.getFullYear() === now.getFullYear();
  return `Due ${due.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })}`;
}

/** Tint classes for the due chip, keyed by bucket (light + dark). */
export const DUE_BUCKET_CHIP: Record<Exclude<TaskDueBucket, "none">, string> = {
  overdue: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  today: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  week: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  later: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
};

/**
 * Group already-sorted open tasks into non-empty bucket sections, keeping
 * the incoming order inside each. Callers sort first (canonical order),
 * so sections read Overdue → Today → This week → Later → No due date.
 */
export function groupTasksByBucket<T extends { due_at: string | null }>(
  tasks: T[],
  now: Date = new Date(),
): Array<{ bucket: TaskDueBucket; tasks: T[] }> {
  const byBucket = new Map<TaskDueBucket, T[]>();
  for (const t of tasks) {
    const b = taskDueBucket(t.due_at, now);
    const arr = byBucket.get(b);
    if (arr) arr.push(t);
    else byBucket.set(b, [t]);
  }
  return DUE_BUCKET_ORDER.filter((b) => byBucket.has(b)).map((b) => ({
    bucket: b,
    tasks: byBucket.get(b)!,
  }));
}
