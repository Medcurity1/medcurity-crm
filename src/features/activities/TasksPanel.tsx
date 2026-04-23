import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, Clock, Plus, ChevronDown, RotateCcw, Pencil } from "lucide-react";
import { useTasks, useCompleteActivity, useReopenActivity } from "./api";
import { QuickTaskDialog } from "./QuickTaskDialog";
import { EditTaskDialog } from "./EditTaskDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
import { errorMessage } from "@/lib/errors";
import { isToday, isPast, parseISO } from "date-fns";
import { toast } from "sonner";
import type { Activity } from "@/types/crm";

interface TasksPanelProps {
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  leadId?: string;
}

function getDueDateStatus(dueAt: string | null): "overdue" | "today" | "upcoming" | null {
  if (!dueAt) return null;
  const date = parseISO(dueAt);
  if (isToday(date)) return "today";
  if (isPast(date)) return "overdue";
  return "upcoming";
}

const dueDateClasses: Record<string, string> = {
  overdue: "text-red-600",
  today: "text-amber-600",
  upcoming: "text-muted-foreground",
};

function TaskItem({
  task,
  onComplete,
  onReopen,
  onEdit,
  isBusy,
}: {
  task: Activity;
  onComplete: (id: string) => void;
  onReopen: (id: string) => void;
  onEdit: (task: Activity) => void;
  isBusy: boolean;
}) {
  const isCompleted = !!task.completed_at;
  const dueStatus = isCompleted ? null : getDueDateStatus(task.due_at);

  return (
    <div className="flex items-start gap-3 py-2 px-1 group hover:bg-muted/40 rounded transition-colors">
      {/* Left: complete/circle toggle */}
      <button
        type="button"
        disabled={isBusy}
        onClick={(e) => {
          e.stopPropagation();
          if (isCompleted) onReopen(task.id);
          else onComplete(task.id);
        }}
        title={isCompleted ? "Reopen task" : "Mark complete"}
        className={cn(
          "mt-0.5 shrink-0 transition-colors",
          isCompleted
            ? "text-emerald-500 hover:text-muted-foreground"
            : "text-muted-foreground hover:text-emerald-500"
        )}
      >
        {isCompleted ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </button>

      {/* Middle: click-to-edit body */}
      <button
        type="button"
        onClick={() => onEdit(task)}
        className="flex-1 min-w-0 text-left cursor-pointer"
      >
        <p
          className={cn(
            "text-sm",
            isCompleted && "line-through text-muted-foreground"
          )}
        >
          {task.subject}
        </p>
        <div className="flex items-center gap-3 mt-0.5">
          {task.due_at && (
            <span
              className={cn(
                "text-xs inline-flex items-center gap-1",
                dueStatus ? dueDateClasses[dueStatus] : "text-muted-foreground"
              )}
            >
              <Clock className="h-3 w-3" />
              {dueStatus === "overdue" && "Overdue: "}
              {dueStatus === "today" && "Due today: "}
              {formatDate(task.due_at)}
            </span>
          )}
          {task.owner?.full_name && (
            <span className="text-xs text-muted-foreground">
              {task.owner.full_name}
            </span>
          )}
          {task.priority && (
            <span
              className={cn(
                "text-xs inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium",
                task.priority === "high" && "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
                task.priority === "normal" && "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
                task.priority === "low" && "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              )}
            >
              {task.priority}
            </span>
          )}
          {task.reminder_schedule && task.reminder_schedule !== "none" && (
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              {task.reminder_schedule}
            </span>
          )}
        </div>
      </button>

      {/* Right: quick action icons (only on hover) */}
      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(task);
          }}
          title="Edit task"
          className="p-1 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {isCompleted && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReopen(task.id);
            }}
            title="Reopen task"
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function TasksPanel({
  accountId,
  contactId,
  opportunityId,
  leadId,
}: TasksPanelProps) {
  const [showAddTask, setShowAddTask] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [editingTask, setEditingTask] = useState<Activity | null>(null);
  const completeMutation = useCompleteActivity();
  const reopenMutation = useReopenActivity();

  const { data, isLoading } = useTasks({
    account_id: accountId,
    contact_id: contactId,
    opportunity_id: opportunityId,
    lead_id: leadId,
  });

  const openTasks = data?.open ?? [];
  const completedTasks = data?.completed ?? [];

  // If we were opened from a notification click with ?open_task=<id>,
  // auto-open the edit dialog for that task. We match across both open
  // and completed lists so reopening a completed task works too.
  const [urlParams, setUrlParams] = useSearchParams();
  useEffect(() => {
    const taskId = urlParams.get("open_task");
    if (!taskId || editingTask) return;
    const match =
      openTasks.find((t) => t.id === taskId) ??
      completedTasks.find((t) => t.id === taskId);
    if (match) {
      setEditingTask(match);
      // Strip the query param so refresh doesn't re-open it.
      const next = new URLSearchParams(urlParams);
      next.delete("open_task");
      setUrlParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlParams, openTasks, completedTasks]);

  function handleComplete(id: string) {
    completeMutation.mutate(
      { id },
      {
        onSuccess: () => toast.success("Task completed"),
        onError: (err) =>
          toast.error("Failed to complete task: " + errorMessage(err)),
      }
    );
  }

  function handleReopen(id: string) {
    reopenMutation.mutate(
      { id },
      {
        onSuccess: () => toast.success("Task reopened"),
        onError: (err) =>
          toast.error("Failed to reopen task: " + errorMessage(err)),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3 py-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="h-5 w-5 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Tasks</h3>
          <Badge variant="secondary" className="text-xs">
            {openTasks.length}
          </Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAddTask(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add Task
        </Button>
      </div>

      {/* Open tasks */}
      {openTasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          No open tasks. Create one to get started.
        </p>
      ) : (
        <div className="divide-y">
          {openTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              onComplete={handleComplete}
              onReopen={handleReopen}
              onEdit={setEditingTask}
              isBusy={completeMutation.isPending || reopenMutation.isPending}
            />
          ))}
        </div>
      )}

      <EditTaskDialog
        open={!!editingTask}
        task={editingTask}
        onOpenChange={(o) => !o && setEditingTask(null)}
      />

      {/* Completed tasks section */}
      {completedTasks.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform",
                !showCompleted && "-rotate-90"
              )}
            />
            {completedTasks.length} completed task
            {completedTasks.length !== 1 ? "s" : ""}
          </button>
          {showCompleted && (
            <div className="divide-y mt-2">
              {completedTasks.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  onComplete={handleComplete}
                  onReopen={handleReopen}
                  onEdit={setEditingTask}
                  isBusy={completeMutation.isPending || reopenMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <QuickTaskDialog
        open={showAddTask}
        onOpenChange={setShowAddTask}
        accountId={accountId}
        contactId={contactId}
        opportunityId={opportunityId}
        leadId={leadId}
      />
    </div>
  );
}
