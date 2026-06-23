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
import { RecurrencePicker } from "./RecurrencePicker";
import {
  EMPTY_RECURRENCE,
  buildRecurrenceFields,
  recurrenceToUI,
  type RecurrenceUI,
} from "./recurrence";
import { ReminderFields } from "./ReminderFields";
import {
  EMPTY_REMINDER,
  buildReminderFields,
  isRepeat,
  reminderFromActivity,
  type ReminderUI,
} from "./reminder";
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
  const [reminder, setReminder] = useState<ReminderUI>(EMPTY_REMINDER);
  const [priority, setPriority] = useState<"high" | "normal" | "low">("normal");
  const [recur, setRecur] = useState<RecurrenceUI>(EMPTY_RECURRENCE);

  // Re-hydrate from the task when it changes.
  useEffect(() => {
    if (!task) return;
    setSubject(task.subject ?? "");
    setBody(task.body ?? "");
    // Convert ISO back to the "YYYY-MM-DDTHH:mm" local datetime-local
    // format the input expects.
    setDueAt(task.due_at ? toLocalInput(task.due_at) : "");
    setReminder(reminderFromActivity(task));
    // Legacy tasks may have a NULL priority — show them as Medium (the
    // default tier), which is how they already sort/render elsewhere.
    setPriority(task.priority ?? "normal");
    setRecur(recurrenceToUI(task));
  }, [task]);

  async function handleSave() {
    if (!task) return;
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    if (recur.mode !== "none" && !dueAt) {
      toast.error("Pick a due date for a repeating task");
      return;
    }
    if (isRepeat(reminder.timing) && (reminder.inApp || reminder.email) && !dueAt) {
      toast.error("Pick a due date for repeating reminders");
      return;
    }
    const recurFields = buildRecurrenceFields(recur, dueAt);
    try {
      const dueIso = dueAt ? new Date(dueAt).toISOString() : null;
      const reminderFields = buildReminderFields(reminder, dueIso);
      await update.mutateAsync({
        id: task.id,
        subject: subject.trim(),
        body: body.trim() || null,
        due_at: dueIso,
        reminder_schedule: reminderFields.reminder_schedule,
        reminder_at: reminderFields.reminder_at,
        reminder_channels: reminderFields.reminder_channels,
        priority,
        recur_freq: recurFields.recur_freq,
        recur_interval: recurFields.recur_interval,
        recur_weekday: recurFields.recur_weekday,
        recur_monthday: recurFields.recur_monthday,
        recur_until: recurFields.recur_until,
      });
      toast.success("Task updated");
      onOpenChange(false);
    } catch (err) {
      toast.error("Failed to save: " + errorMessage(err));
    }
  }

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
                setPriority(e.target.value as "high" | "normal" | "low")
              }
            >
              <option value="high">High</option>
              <option value="normal">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <RecurrencePicker value={recur} onChange={setRecur} />

          <ReminderFields value={reminder} onChange={setReminder} hasDueDate={!!dueAt} />

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
