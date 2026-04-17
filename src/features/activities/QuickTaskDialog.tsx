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

type ReminderSchedule = "none" | "once" | "daily" | "weekdays" | "weekly";

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
  const [reminderSchedule, setReminderSchedule] =
    useState<ReminderSchedule>("none");
  const [reminderAt, setReminderAt] = useState("");
  const [channels, setChannels] = useState<Array<"in_app" | "email">>([
    "in_app",
  ]);
  const createMutation = useCreateActivity();
  const { user } = useAuth();

  function reset() {
    setSubject("");
    setDueAt("");
    setNotes("");
    setReminderSchedule("none");
    setReminderAt("");
    setChannels(["in_app"]);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function toggleChannel(ch: "in_app" | "email", checked: boolean) {
    setChannels((prev) => {
      const next = checked
        ? [...prev, ch].filter((v, i, a) => a.indexOf(v) === i)
        : prev.filter((v) => v !== ch);
      return next as Array<"in_app" | "email">;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return;

    // datetime-local returns "YYYY-MM-DDTHH:mm" with no timezone.
    // new Date(value) interprets as local time, which is what users expect.
    const dueIso = dueAt ? new Date(dueAt).toISOString() : null;
    // If schedule is set but user didn't pick a "First reminder at",
    // default it to the due time. This matches what most people want:
    // "remind me when it's due." Previously the reminder silently
    // never fired because reminder_at stayed null.
    const reminderIso =
      reminderSchedule !== "none"
        ? reminderAt
          ? new Date(reminderAt).toISOString()
          : dueIso
        : null;

    createMutation.mutate(
      {
        activity_type: "task",
        subject: subject.trim(),
        body: notes.trim() || undefined,
        due_at: dueIso,
        account_id: accountId ?? null,
        contact_id: contactId ?? null,
        opportunity_id: opportunityId ?? null,
        lead_id: leadId ?? null,
        // owner_user_id MUST be set — the task-reminders function sends
        // reminders to this user, the home-page "My Tasks" widget filters
        // by it, and most task queries RLS-gate on it.
        owner_user_id: user?.id ?? null,
        reminder_schedule: reminderSchedule,
        reminder_at: reminderIso,
        reminder_channels: reminderSchedule === "none" ? ["in_app"] : channels,
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

  const showReminderDetails = reminderSchedule !== "none";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Task</DialogTitle>
          <DialogDescription>
            Create a new task for this record.
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

          <div className="space-y-2 border rounded-md p-3">
            <Label className="text-sm font-semibold">Reminders</Label>
            <select
              className="w-full border rounded-md h-9 px-2 bg-background text-sm"
              value={reminderSchedule}
              onChange={(e) =>
                setReminderSchedule(e.target.value as ReminderSchedule)
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
                <Label htmlFor="reminder-at" className="text-xs text-muted-foreground">
                  First reminder at
                </Label>
                <Input
                  id="reminder-at"
                  type="datetime-local"
                  value={reminderAt}
                  onChange={(e) => setReminderAt(e.target.value)}
                />
                <div className="flex flex-wrap gap-3 pt-1">
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channels.includes("in_app")}
                      onChange={(e) =>
                        toggleChannel("in_app", e.target.checked)
                      }
                    />
                    In-app
                  </label>
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channels.includes("email")}
                      onChange={(e) =>
                        toggleChannel("email", e.target.checked)
                      }
                    />
                    Email
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Email reminders require your Outlook integration to have
                  Mail.Send permission (admin can enable).
                </p>
              </>
            )}
          </div>

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
