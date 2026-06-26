import { useState, useMemo, useEffect } from "react";
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
import { Loader2, CalendarClock, Repeat } from "lucide-react";
import {
  parseTaskText,
  toDateTimeLocal,
  formatParsedDate,
  removeRanges,
} from "./parse-task-text";

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
  // Once the user hand-edits Due / Recurrence, the smart parser stops managing
  // that field (so it never clobbers a manual choice).
  const [dueManual, setDueManual] = useState(false);
  const [recurManual, setRecurManual] = useState(false);
  const createMutation = useCreateActivity();
  const { user } = useAuth();

  // Smart entry (Todoist-style): parse "tomorrow at 8am" / "every Monday" out of
  // the subject as it's typed, and auto-fill Due + Recurrence. Runs on each
  // subject change; skips any field the user has taken over manually.
  const parsed = useMemo(() => parseTaskText(subject), [subject]);
  useEffect(() => {
    if (!dueManual) setDueAt(parsed.date ? toDateTimeLocal(parsed.date) : "");
    if (!recurManual) setRecur(parsed.recurrence ?? EMPTY_RECURRENCE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  // The cleaned title (date/recurrence phrases removed) — but only strip a
  // phrase whose field the parser still manages, so a manual override keeps the
  // literal text. Falls back to the raw subject if cleaning would empty it.
  const cleanedSubject = useMemo(() => {
    if (!parsed.matched) return subject.trim();
    const cleaned = removeRanges(subject, [
      recurManual ? null : parsed.recurrenceRange,
      dueManual ? null : parsed.dateRange,
    ]).trim();
    return cleaned || subject.trim();
  }, [parsed, subject, dueManual, recurManual]);
  const showSmartChip =
    parsed.matched && ((parsed.date && !dueManual) || (parsed.recurrence && !recurManual));

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
    setDueManual(false);
    setRecurManual(false);
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
        subject: cleanedSubject,
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
              placeholder="e.g. Call Dr. Lee tomorrow at 8am"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoFocus
            />
            {showSmartChip ? (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {parsed.date && !dueManual && (
                    <span className="inline-flex items-center gap-1 font-medium">
                      <CalendarClock className="h-3.5 w-3.5 text-primary" />
                      {formatParsedDate(parsed.date)}
                    </span>
                  )}
                  {parsed.recurrenceLabel && !recurManual && (
                    <span className="inline-flex items-center gap-1 font-medium">
                      <Repeat className="h-3.5 w-3.5 text-primary" />
                      {parsed.recurrenceLabel}
                    </span>
                  )}
                </div>
                {cleanedSubject && cleanedSubject !== subject.trim() && (
                  <p className="text-muted-foreground">Saves as: "{cleanedSubject}"</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Auto-detected from your text — edit the fields below to change.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Tip: type the date and it fills Due automatically — "tomorrow 8am",
                "next Wed", "every Monday".
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-due">Due</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => {
                setDueAt(e.target.value);
                setDueManual(true);
              }}
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

          <RecurrencePicker
            value={recur}
            onChange={(v) => {
              setRecur(v);
              setRecurManual(true);
            }}
          />

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
