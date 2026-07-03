// Today's Tasks system widget — port of HomePage's MyTasksSection, scoped
// to the WIDGET OWNER (widget.user_id, not the signed-in user) so admin
// preview shows the target user's data. Honors preview_count and the
// shell's in-widget search string.

import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  compareTasksByDueThenPriority,
  priorityDotClass,
  priorityLabel,
} from "@/features/activities/taskOrder";
import { describeRecurrence } from "@/features/activities/recurrence";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/formatters";
import type { NexusWidgetBodyProps } from "../WidgetShell";

interface TaskItem {
  id: string;
  subject: string;
  due_at: string | null;
  completed_at: string | null;
  priority: "high" | "normal" | "low" | null;
  recur_freq: "daily" | "weekly" | "monthly" | null;
  recur_interval: number | null;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  account: { id: string; name: string } | null;
  contact: { id: string; first_name: string | null; last_name: string | null } | null;
  opportunity: { id: string; name: string } | null;
  lead: { id: string; first_name: string | null; last_name: string | null; company: string | null } | null;
}

function useOwnerTasks(userId: string) {
  return useQuery({
    queryKey: ["nexus-widget-data", "tasks", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select(
          "id, subject, due_at, completed_at, priority, recur_freq, recur_interval, account_id, contact_id, opportunity_id, lead_id, account:accounts(id, name), contact:contacts(id, first_name, last_name), opportunity:opportunities(id, name), lead:leads(id, first_name, last_name, company)",
        )
        .eq("activity_type", "task")
        .eq("owner_user_id", userId)
        .is("archived_at", null)
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as TaskItem[];
    },
    enabled: !!userId,
  });
}

function getDueDateColor(dueAt: string | null): string {
  if (!dueAt) return "text-muted-foreground";
  const due = new Date(dueAt);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor(
    (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return "text-red-600";
  if (diffDays === 0) return "text-amber-600";
  if (diffDays <= 2) return "text-amber-500";
  return "text-muted-foreground";
}

function formatDueLabel(dueAt: string | null): string {
  if (!dueAt) return "";
  const due = new Date(dueAt);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueMidnight = new Date(due);
  dueMidnight.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (dueMidnight.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return `Overdue ${Math.abs(diffDays)}d`;
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays < 7) return `Due in ${diffDays}d`;
  return `Due ${formatDate(dueAt)}`;
}

/** Primary related record (opp > contact > account > lead) — mirrors the
 * task-reminders Edge Function so deep-links stay consistent. */
function getTaskRelated(
  task: TaskItem,
): { label: string; href: string } | null {
  if (task.opportunity?.id && task.opportunity?.name) {
    return { label: task.opportunity.name, href: `/opportunities/${task.opportunity.id}` };
  }
  if (task.contact?.id) {
    const name = [task.contact.first_name, task.contact.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    return { label: name || "Contact", href: `/contacts/${task.contact.id}` };
  }
  if (task.account?.id && task.account?.name) {
    return { label: task.account.name, href: `/accounts/${task.account.id}` };
  }
  if (task.lead?.id) {
    const name = [task.lead.first_name, task.lead.last_name]
      .filter(Boolean)
      .join(" ")
      .trim();
    const label = task.lead.company
      ? name
        ? `${name} · ${task.lead.company}`
        : task.lead.company
      : name || "Lead";
    return { label, href: `/leads/${task.lead.id}` };
  }
  return null;
}

/** Account link shown alongside the primary record (null when the account
 * IS the primary record — avoids showing it twice). */
function getTaskAccount(
  task: TaskItem,
): { label: string; href: string } | null {
  if (!task.account?.id || !task.account?.name) return null;
  if (!task.opportunity?.id && !task.contact?.id && !task.lead?.id) {
    return null;
  }
  return { label: task.account.name, href: `/accounts/${task.account.id}` };
}

export function TasksWidget({
  widget,
  searchQuery,
  onDataUpdated,
}: NexusWidgetBodyProps) {
  const { data: tasks, isLoading, dataUpdatedAt } = useOwnerTasks(widget.user_id);
  const qc = useQueryClient();

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  // Paired complete/uncomplete mutations so an accidental check-off has a
  // one-click undo (same guard the old homepage widget had).
  const uncompleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("activities")
        .update({ completed_at: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nexus-widget-data", "tasks"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("activities")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["nexus-widget-data", "tasks"] });
      toast.success("Task completed", {
        action: {
          label: "Undo",
          onClick: () => uncompleteMutation.mutate(id),
        },
      });
    },
  });

  // Due date first, then priority (High → Medium → Low) — canonical order.
  const openTasks = useMemo(
    () =>
      (tasks ?? [])
        .filter((t) => !t.completed_at)
        .sort(compareTasksByDueThenPriority),
    [tasks],
  );

  // Preview = top N rows; the in-widget search filters ONLY these loaded
  // preview rows (spec §10) — it never widens the underlying result.
  const preview = openTasks.slice(0, widget.preview_count);
  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? preview.filter((t) =>
        [
          t.subject,
          t.account?.name,
          getTaskRelated(t)?.label,
        ].some((s) => s?.toLowerCase().includes(q)),
      )
    : preview;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: Math.min(widget.preview_count, 5) }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (!openTasks.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No tasks due today — you're all clear!
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {!visible.length ? (
        <p className="text-sm text-muted-foreground py-2">
          No rows match your filter.
        </p>
      ) : (
        visible.map((task) => {
          const related = getTaskRelated(task);
          const accountLink = getTaskAccount(task);
          const dueColor = getDueDateColor(task.due_at);
          const dueLabel = formatDueLabel(task.due_at);
          return (
            <div key={task.id} className="flex items-start gap-3 py-1.5">
              <Checkbox
                checked={false}
                onCheckedChange={() => completeMutation.mutate(task.id)}
                disabled={completeMutation.isPending}
                className="shrink-0 mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    className={`shrink-0 h-2 w-2 rounded-full self-center ${priorityDotClass(task.priority)}`}
                    title={`${priorityLabel(task.priority)} priority`}
                    aria-label={`${priorityLabel(task.priority)} priority`}
                  />
                  <span className="text-sm font-medium truncate">
                    {task.subject}
                  </span>
                  {dueLabel && (
                    <span className={`text-xs font-medium ${dueColor}`}>
                      {dueLabel}
                    </span>
                  )}
                  {describeRecurrence(task) && (
                    <span
                      className="text-xs text-muted-foreground"
                      title={`Repeats: ${describeRecurrence(task)}`}
                      aria-label={`Repeats ${describeRecurrence(task)}`}
                    >
                      ↻
                    </span>
                  )}
                </div>
                {(accountLink || related) && (
                  <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground min-w-0">
                    {accountLink && (
                      <Link
                        to={accountLink.href}
                        className="hover:text-primary hover:underline truncate"
                      >
                        {accountLink.label}
                      </Link>
                    )}
                    {accountLink && related && <span className="shrink-0">·</span>}
                    {related && (
                      <Link
                        to={related.href}
                        className="hover:text-primary hover:underline truncate"
                      >
                        {related.label}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })
      )}

      <div className="pt-2 flex items-center justify-between">
        <Link
          to="/activities?type=task&owner=me"
          className="text-sm text-primary hover:underline"
        >
          View All
        </Link>
        {openTasks.length > widget.preview_count && (
          <span className="text-xs text-muted-foreground">
            {openTasks.length} open
          </span>
        )}
      </div>
    </div>
  );
}
