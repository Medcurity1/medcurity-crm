import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateActivity } from "./api";
import {
  TaskRecordPicker,
  EMPTY_TASK_RECORD,
  type TaskRecordSelection,
} from "./TaskRecordPicker";
import { RecurrencePicker } from "./RecurrencePicker";
import {
  EMPTY_RECURRENCE,
  buildRecurrenceFields,
  type RecurrenceUI,
} from "./recurrence";
import { ReminderFields } from "./ReminderFields";
import {
  EMPTY_REMINDER,
  buildReminderFields,
  isRepeat,
  type ReminderUI,
} from "./reminder";
import { useAuth } from "@/features/auth/AuthProvider";
import { errorMessage } from "@/lib/errors";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface QuickTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  leadId?: string;
}

export function QuickTaskDialog({
  open,
  onOpenChange,
  accountId,
  contactId,
  opportunityId,
  leadId,
}: QuickTaskDialogProps) {
  const [subject, setSubject] = useState("");
  // Due uses datetime-local now (not just date) so users can set a time.
  // Previously only date was captured which was too coarse for reminders
  // and for the Outlook-calendar event we create.
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [reminder, setReminder] = useState<ReminderUI>(EMPTY_REMINDER);
  // Priority is required with a Medium default (V2-A1). 'normal' is the
  // Medium tier — see taskOrder.ts.
  const [priority, setPriority] = useState<"high" | "normal" | "low">("normal");
  // Optional record attachment, only used in standalone mode (Activities
  // tab) where no record context was passed in via props.
  const [attach, setAttach] = useState<TaskRecordSelection>(EMPTY_TASK_RECORD);
  const [recur, setRecur] = useState<RecurrenceUI>(EMPTY_RECURRENCE);
  const createMutation = useCreateActivity();
  const { user } = useAuth();

  // Standalone = opened with no record context (the Activities tab). Only
  // then do we offer the attach-to-record picker; from a record's Tasks
  // panel the parent record is already implied by the props.
  const isStandalone =
    !accountId && !contactId && !opportunityId && !leadId;

  function reset() {
    setSubject("");
    setDueAt("");
    setNotes("");
    setReminder(EMPTY_REMINDER);
    setPriority("normal");
    setAttach(EMPTY_TASK_RECORD);
    setRecur(EMPTY_RECURRENCE);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return;

    // Recurring tasks derive their weekday / day-of-month from the due
    // date, so a due date is required when repeating.
    if (recur.mode !== "none" && !dueAt) {
      toast.error("Pick a due date for a repeating task");
      return;
    }
    // Repeating reminders need a due date to repeat until.
    if (isRepeat(reminder.timing) && (reminder.inApp || reminder.email) && !dueAt) {
      toast.error("Pick a due date for repeating reminders");
      return;
    }
    const recurFields = buildRecurrenceFields(recur, dueAt);

    // datetime-local returns "YYYY-MM-DDTHH:mm" with no timezone.
    // new Date(value) interprets as local time, which is what users expect.
    const dueIso = dueAt ? new Date(dueAt).toISOString() : null;
    const reminderFields = buildReminderFields(reminder, dueIso);

    // Record links: props win when opened from a record's Tasks panel;
    // otherwise fall back to the standalone attach picker (which is all
    // nulls unless the rep chose something).
    createMutation.mutate(
      {
        activity_type: "task",
        subject: subject.trim(),
        body: notes.trim() || undefined,
        due_at: dueIso,
        account_id: accountId ?? attach.accountId ?? null,
        contact_id: contactId ?? attach.contactId ?? null,
        opportunity_id: opportunityId ?? attach.opportunityId ?? null,
        lead_id: leadId ?? null,
        // owner_user_id MUST be set — the task-reminders function sends
        // reminders to this user, the home-page "My Tasks" widget filters
        // by it, and most task queries RLS-gate on it.
        owner_user_id: user?.id ?? null,
        reminder_schedule: reminderFields.reminder_schedule,
        reminder_at: reminderFields.reminder_at,
        reminder_channels: reminderFields.reminder_channels,
        priority,
        recur_freq: recurFields.recur_freq,
        recur_interval: recurFields.recur_interval,
        recur_weekday: recurFields.recur_weekday,
        recur_monthday: recurFields.recur_monthday,
        recur_until: recurFields.recur_until,
      },
      {
        onSuccess: () => {
          toast.success("Task created");
          handleClose(false);
        },
        onError: (err) => {
          toast.error("Failed to create task: " + errorMessage(err));
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Task</DialogTitle>
          <DialogDescription>
            {isStandalone
              ? "Create a task for yourself. Optionally attach it to a record."
              : "Create a new task for this record."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-subject">Subject *</Label>
            <Input
              id="task-subject"
              placeholder="e.g. Follow up on proposal"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-due">Due</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Date + time. Used for calendar placement and reminder
              cutoff.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-priority">Priority *</Label>
            <select
              id="task-priority"
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

          {isStandalone && (
            <TaskRecordPicker value={attach} onChange={setAttach} />
          )}

          <RecurrencePicker value={recur} onChange={setRecur} />

          <ReminderFields value={reminder} onChange={setReminder} hasDueDate={!!dueAt} />

          <div className="space-y-2">
            <Label htmlFor="task-notes">Notes</Label>
            <Textarea
              id="task-notes"
              placeholder="Additional details..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!subject.trim() || createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              )}
              Create Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
