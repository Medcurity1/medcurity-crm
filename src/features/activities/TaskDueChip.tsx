import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import {
  DUE_BUCKET_CHIP,
  taskDueBucket,
  taskDueChipLabel,
} from "./taskOrder";

/**
 * The tinted due-date pill (Molly's task-organization pass, 2026-08-12).
 * Replaces plain date text everywhere a task's due date renders in a list:
 * rose for overdue with "3d overdue" phrasing, amber for today, sky for
 * this week, slate for later. Completed tasks drop the urgency theater and
 * show a quiet plain date — a done task can't be overdue.
 */
export function TaskDueChip({
  dueAt,
  completed = false,
  className,
}: {
  dueAt: string | null;
  completed?: boolean;
  className?: string;
}) {
  if (!dueAt) return null;
  if (completed) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground",
          className,
        )}
      >
        {formatDate(dueAt)}
      </span>
    );
  }
  const bucket = taskDueBucket(dueAt);
  if (bucket === "none") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        DUE_BUCKET_CHIP[bucket],
        className,
      )}
      title={formatDate(dueAt)}
    >
      {taskDueChipLabel(dueAt)}
    </span>
  );
}
