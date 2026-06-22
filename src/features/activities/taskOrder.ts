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
  const ad = a.due_at;
  const bd = b.due_at;
  if (ad && bd) {
    const diff = new Date(ad).getTime() - new Date(bd).getTime();
    if (diff !== 0) return diff;
  } else if (ad && !bd) {
    return -1; // a has a due date, b doesn't → a first
  } else if (!ad && bd) {
    return 1; // b has a due date, a doesn't → b first
  }
  // Same due date (or both undated) → priority decides.
  return priorityRank(a.priority) - priorityRank(b.priority);
}
