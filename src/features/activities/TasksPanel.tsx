import { useState } from "react";
import { CheckCircle2, Circle, Clock, Plus, ChevronDown } from "lucide-react";
import { useTasks, useCompleteActivity } from "./api";
import { QuickTaskDialog } from "./QuickTaskDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/formatters";
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
  isCompleting,
}: {
  task: Activity;
  onComplete: (id: string) => void;
  isCompleting: boolean;
}) {
  const isCompleted = !!task.completed_at;
  const dueStatus = isCompleted ? null : getDueDateStatus(task.due_at);

  return (
    <div className="flex items-start gap-3 py-2 px-1 group">
      <button
        type="button"
        disabled={isCompleted || isCompleting}
        onClick={(e) => {
          e.stopPropagation();
          if (!isCompleted) onComplete(task.id);
        }}
        className={cn(
          "mt-0.5 shrink-0 transition-colors",
          isCompleted
            ? "text-emerald-500"
            : "text-muted-foreground hover:text-emerald-500"
        )}
      >
        {isCompleted ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <Circle className="h-5 w-5" />
        )}
      </button>

      <div className="flex-1 min-w-0">
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
        </div>
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
  const completeMutation = useCompleteActivity();

  const { data, isLoading } = useTasks({
    account_id: accountId,
    contact_id: contactId,
    opportunity_id: opportunityId,
    lead_id: leadId,
  });

  const openTasks = data?.open ?? [];
  const completedTasks = data?.completed ?? [];

  function handleComplete(id: string) {
    completeMutation.mutate(
      { id },
      {
        onSuccess: () => toast.success("Task completed"),
        onError: (err) =>
          toast.error("Failed to complete task: " + (err as Error).message),
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
              isCompleting={completeMutation.isPending}
            />
          ))}
        </div>
      )}

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
                  isCompleting={false}
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
