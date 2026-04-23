import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateActivity } from "./api";
import { errorMessage } from "@/lib/errors";
import { toast } from "sonner";
import type { Activity } from "@/types/crm";

/**
 * View + edit an existing task. Kept narrow on purpose:
 *   - subject / body / due_at / reminder fields
 *   - NOT: activity_type, account/contact/opportunity links (use
 *     ReattributeActivityDialog for relinking, no UI for changing type)
 *
 * Brayden's concern about "a user could lie after the fact":
 *   - Every edit is captured by the audit_log trigger already installed
 *     on activities. Admins can see the before/after via
 *     /admin?tab=audit-log filtered by this record's id.
 *   - A footer note in the dialog makes this visible to the user so
 *     they know edits aren't silent.
 */
export function EditTaskDialog({
  open,
  onOpenChange,
  task,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: Activity | null;
}) {
  const update = useUpdateActivity();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [reminderSchedule, setReminderSchedule] = useState<
    "none" | "once" | "daily" | "weekdays" | "weekly"
  >("none");
  const [reminderAt, setReminderAt] = useState("");
  const [channels, setChannels] = useState<Array<"in_app" | "email">>([
    "in_app",
  ]);
  const [priority, setPriority] = useState<"" | "high" | "normal" | "low">("");

  // Re-hydrate from the task when it changes.
  useEffect(() => {
    if (!task) return;
    setSubject(task.subject ?? "");
    setBody(task.body ?? "");
    // Convert ISO back to the "YYYY-MM-DDTHH:mm" local datetime-local
    // format the input expects.
    setDueAt(task.due_at ? toLocalInput(task.due_at) : "");
    setReminderSchedule(task.reminder_schedule ?? "none");
    setReminderAt(
      task.reminder_at ? toLocalInput(task.reminder_at) : ""
    );
    setChannels(
      task.reminder_channels && task.reminder_channels.length > 0
        ? task.reminder_channels
        : ["in_app"]
    );
    setPriority(task.priority ?? "");
  }, [task]);

  function toggleChannel(ch: "in_app" | "email", checked: boolean) {
    setChannels((prev) => {
      const next = checked
        ? [...prev, ch].filter((v, i, a) => a.indexOf(v) === i)
        : prev.filter((v) => v !== ch);
      return next as Array<"in_app" | "email">;
    });
  }

  async function handleSave() {
    if (!task) return;
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    try {
      const dueIso = dueAt ? new Date(dueAt).toISOString() : null;
      const reminderIso =
        reminderSchedule !== "none"
          ? reminderAt
            ? new Date(reminderAt).toISOString()
            : dueIso
          : null;
      await update.mutateAsync({
        id: task.id,
        subject: subject.trim(),
        body: body.trim() || null,
        due_at: dueIso,
        reminder_schedule: reminderSchedule,
        reminder_at: reminderIso,
        reminder_channels: reminderSchedule === "none" ? ["in_app"] : channels,
        priority: priority || null,
      });
      toast.success("Task updated");
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to save: " + errorMessage(err));
    }
  }

  const showReminderDetails = reminderSchedule !== "none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Task</DialogTitle>
          <DialogDescription>
            Update task details. All edits are audit-logged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-subject">Subject</Label>
            <Input
              id="edit-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-due">Due</Label>
            <Input
              id="edit-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-priority">Priority</Label>
            <select
              id="edit-priority"
              className="w-full border rounded-md h-9 px-2 bg-background text-sm"
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as "" | "high" | "normal" | "low")
              }
            >
              <option value="">No priority (use due date)</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div className="space-y-2 border rounded-md p-3">
            <Label className="text-sm font-semibold">Reminders</Label>
            <select
              className="w-full border rounded-md h-9 px-2 bg-background text-sm"
              value={reminderSchedule}
              onChange={(e) =>
                setReminderSchedule(
                  e.target.value as
                    | "none"
                    | "once"
                    | "daily"
                    | "weekdays"
                    | "weekly"
                )
              }
            >
              <option value="none">No reminder</option>
              <option value="once">Once</option>
              <option value="daily">Daily until due</option>
              <option value="weekdays">Weekdays (M-F) until due</option>
              <option value="weekly">Weekly until due</option>
            </select>

            {showReminderDetails && (
              <>
                <Label htmlFor="edit-reminder-at" className="text-xs text-muted-foreground">
                  Next reminder at
                </Label>
                <Input
                  id="edit-reminder-at"
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(e) => setReminderAt(e.target.value)}
                />
                <div className="flex flex-wrap gap-3 pt-1">
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channels.includes("in_app")}
                      onChange={(e) => toggleChannel("in_app", e.target.checked)}
                    />
                    In-app
                  </label>
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channels.includes("email")}
                      onChange={(e) => toggleChannel("email", e.target.checked)}
                    />
                    Email
                  </label>
                </div>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-body">Notes</Label>
            <Textarea
              id="edit-body"
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={update.isPending}>
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * ISO datetime -> "YYYY-MM-DDTHH:mm" local-time string for
 * datetime-local input binding. JS Date.toISOString() is UTC; the input
 * wants naked local time, so we build it from components.
 */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}
