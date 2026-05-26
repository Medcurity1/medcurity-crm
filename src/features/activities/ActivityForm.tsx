import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Phone, Mail, Calendar, CheckSquare } from "lucide-react";
import { activityFormSchema, type ActivityFormValues } from "./schema";
import { useCreateActivity, useUpdateActivity } from "./api";
import { useAuth } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { ActivityType, Activity } from "@/types/crm";

interface ActivityFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  leadId?: string;
  /**
   * When passed, the form runs in edit mode: fields pre-fill from this
   * activity and submit updates the existing row instead of inserting.
   */
  activity?: Activity | null;
}

// "Note" was intentionally removed as a NEW activity option — Brayden
// wanted reps logging calls/meetings/tasks tied to real interactions
// rather than free-floating notes. Existing note rows in the database
// stay editable (see schema.ts comment on `activity_type`), but the
// picker below no longer offers it.
const activityTypes: { value: ActivityType; label: string; icon: typeof Phone }[] = [
  { value: "call", label: "Call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "meeting", label: "Meeting", icon: Calendar },
  { value: "task", label: "Task", icon: CheckSquare },
];

interface ContactPickerOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
}

/**
 * Resolve the account this activity is being logged against, even when
 * the caller only supplied an opportunity or lead. Returning null means
 * we have no account context (raw lead with no converted account yet),
 * in which case the contact picker is hidden — there's nobody to scope
 * the dropdown to.
 */
function useEffectiveAccountId(args: {
  accountId?: string;
  opportunityId?: string;
}): { accountId: string | null; loading: boolean } {
  const { accountId, opportunityId } = args;
  const { data, isLoading } = useQuery({
    queryKey: ["activity-form-account-resolver", accountId, opportunityId],
    enabled: !accountId && !!opportunityId,
    queryFn: async () => {
      if (!opportunityId) return null;
      const { data, error } = await supabase
        .from("opportunities")
        .select("account_id")
        .eq("id", opportunityId)
        .maybeSingle();
      if (error) throw error;
      return (data?.account_id as string | null) ?? null;
    },
  });
  if (accountId) return { accountId, loading: false };
  return { accountId: data ?? null, loading: isLoading };
}

function useContactOptions(accountId: string | null) {
  return useQuery({
    queryKey: ["activity-form-contact-options", accountId],
    enabled: !!accountId,
    queryFn: async () => {
      if (!accountId) return [] as ContactPickerOption[];
      const { data, error } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, title")
        .eq("account_id", accountId)
        .is("archived_at", null)
        .order("last_name", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ContactPickerOption[];
    },
  });
}

export function ActivityForm({
  open,
  onOpenChange,
  accountId,
  contactId,
  opportunityId,
  leadId,
  activity,
}: ActivityFormProps) {
  const { user } = useAuth();
  const createMutation = useCreateActivity();
  const updateMutation = useUpdateActivity();
  const isEditing = !!activity;

  // Helper: today as YYYY-MM-DD in local time (HTML date inputs expect this).
  // Reps usually log an activity the day it happened; defaulting to today
  // saves clicks. They can still change it via the calendar picker.
  const todayLocalISO = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  // Convert "YYYY-MM-DD" (from <input type="date">) to a local-noon ISO
  // string. Sending the bare date string makes Postgres interpret it as
  // UTC midnight; in negative-UTC timezones that renders as the prior
  // day (a rep added a task on May 5 and the timeline read "Due May 4").
  // Using local noon avoids any timezone-induced day-shift on either
  // side of the date line.
  const dateToLocalNoonISO = (yyyyMmDd: string): string | null => {
    if (!yyyyMmDd) return null;
    const [y, m, d] = yyyyMmDd.split("-").map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
  };

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: {
      activity_type: "call",
      subject: "",
      body: "",
      activity_date: todayLocalISO(),
      due_at: "",
      contact_id: contactId ?? null,
      reminder_schedule: "none",
      reminder_at: "",
      reminder_channels: ["in_app"],
    },
  });

  // Resolve the account context so the contact dropdown can list the
  // right people. When the rep opens the form from a contact page,
  // contactId is pre-set and we lock the picker — there's nothing to
  // pick. When opened from an opportunity page, we look up the opp's
  // account so the dropdown still works.
  const { accountId: effectiveAccountId } = useEffectiveAccountId({
    accountId,
    opportunityId,
  });
  const { data: contactOptions = [] } = useContactOptions(effectiveAccountId);
  const lockedContactName = useMemo(() => {
    if (!contactId) return null;
    const c = contactOptions.find((c) => c.id === contactId);
    if (!c) return null;
    return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Contact";
  }, [contactId, contactOptions]);
  // Show picker only when:
  //   1. We have an account context to scope the contacts by, and
  //   2. The caller didn't already nail down a specific contact.
  // The lead-only path (no accountId, no opp) intentionally hides the
  // picker — a raw lead doesn't have related contacts yet.
  const showContactPicker = !contactId && !!effectiveAccountId;

  // Pre-fill when editing an existing activity. We only take the YYYY-MM-DD
  // prefix off the due_at ISO timestamp since the input is type="date".
  useEffect(() => {
    if (!open) return;
    if (activity) {
      form.reset({
        activity_type: activity.activity_type,
        subject: activity.subject ?? "",
        body: activity.body ?? "",
        activity_date: activity.activity_date
          ? activity.activity_date.slice(0, 10)
          : activity.created_at
            ? activity.created_at.slice(0, 10)
            : todayLocalISO(),
        due_at: activity.due_at ? activity.due_at.slice(0, 10) : "",
        contact_id: activity.contact_id ?? null,
        reminder_schedule:
          (activity.reminder_schedule as ActivityFormValues["reminder_schedule"]) ??
          "none",
        reminder_at: activity.reminder_at ? activity.reminder_at.slice(0, 16) : "",
        reminder_channels:
          (activity.reminder_channels as Array<"in_app" | "email">) ?? ["in_app"],
      });
    } else {
      form.reset({
        activity_type: "call",
        subject: "",
        body: "",
        activity_date: todayLocalISO(),
        due_at: "",
        contact_id: contactId ?? null,
        reminder_schedule: "none",
        reminder_at: "",
        reminder_channels: ["in_app"],
      });
    }
  }, [open, activity, form, contactId]);

  function onSubmit(values: ActivityFormValues) {
    const isTask = values.activity_type === "task";
    const reminderSchedule = isTask
      ? (values.reminder_schedule ?? "none")
      : "none";
    const reminderAt =
      isTask && reminderSchedule !== "none" && values.reminder_at
        ? new Date(values.reminder_at).toISOString()
        : null;
    const reminderChannels = (
      isTask && reminderSchedule !== "none"
        ? values.reminder_channels ?? ["in_app"]
        : ["in_app"]
    ) as Array<"in_app" | "email">;

    // Activity date applies to every type; falls back to "today" if
    // the user cleared the field. Due date only applies to tasks.
    const activityDateIso =
      dateToLocalNoonISO(values.activity_date ?? "") ??
      dateToLocalNoonISO(todayLocalISO())!;
    const dueAtIso = isTask ? dateToLocalNoonISO(values.due_at ?? "") : null;
    // Prop wins when the form was opened from a contact's own page
    // (locked picker); otherwise honor whatever the user picked, which
    // may legitimately be "no contact" (null) for account-level logs.
    const resolvedContactId: string | null =
      contactId ?? values.contact_id ?? null;

    if (isEditing && activity) {
      updateMutation.mutate(
        {
          id: activity.id,
          activity_type: values.activity_type,
          subject: values.subject,
          body: values.body || null,
          activity_date: activityDateIso,
          due_at: dueAtIso,
          contact_id: resolvedContactId,
          reminder_schedule: reminderSchedule,
          reminder_at: reminderAt,
          reminder_channels: reminderChannels,
        },
        {
          onSuccess: () => {
            toast.success("Activity updated");
            onOpenChange(false);
          },
          onError: (err) => {
            toast.error("Failed to update activity: " + (err as Error).message);
          },
        }
      );
      return;
    }

    createMutation.mutate(
      {
        activity_type: values.activity_type,
        subject: values.subject,
        body: values.body || undefined,
        activity_date: activityDateIso,
        due_at: dueAtIso ?? undefined,
        account_id: accountId,
        contact_id: resolvedContactId ?? undefined,
        opportunity_id: opportunityId,
        lead_id: leadId,
        owner_user_id: user?.id,
        reminder_schedule: reminderSchedule,
        reminder_at: reminderAt,
        reminder_channels: reminderChannels,
      },
      {
        onSuccess: () => {
          toast.success("Activity logged");
          form.reset();
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error("Failed to log activity: " + (err as Error).message);
        },
      }
    );
  }

  const selectedType = form.watch("activity_type");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Activity" : "Log Activity"}</DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* Activity type selector */}
          <div className="space-y-2">
            <Label>Type</Label>
            <div className="flex gap-1">
              {activityTypes.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => form.setValue("activity_type", value)}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs transition-colors ${
                    selectedType === value
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            {form.formState.errors.activity_type && (
              <p className="text-sm text-destructive">
                {form.formState.errors.activity_type.message}
              </p>
            )}
          </div>

          {/* Contact picker. Reps were misattributing calls/meetings to
              the wrong record because the form didn't ask. Now the
              activity is linked to BOTH the account and (optionally) a
              specific contact, so it shows up on the contact's timeline
              without manual double-entry. Hidden when the form was
              opened from a contact page (already locked) or from a raw
              lead (no account to scope to). */}
          {showContactPicker && (
            <div className="space-y-2">
              <Label htmlFor="contact_id">Contact (optional)</Label>
              <select
                id="contact_id"
                className="w-full border rounded-md h-9 px-2 bg-background text-sm"
                value={form.watch("contact_id") ?? ""}
                onChange={(e) =>
                  form.setValue("contact_id", e.target.value || null)
                }
              >
                <option value="">No specific contact</option>
                {contactOptions.map((c) => {
                  const name =
                    [c.first_name, c.last_name].filter(Boolean).join(" ") ||
                    "(unnamed)";
                  return (
                    <option key={c.id} value={c.id}>
                      {name}
                      {c.title ? ` — ${c.title}` : ""}
                    </option>
                  );
                })}
              </select>
              <p className="text-xs text-muted-foreground">
                Linking a contact also logs this activity on their timeline.
              </p>
            </div>
          )}
          {contactId && lockedContactName && (
            <p className="text-xs text-muted-foreground">
              Logging for contact: <strong>{lockedContactName}</strong>
            </p>
          )}

          {/* Subject — calls and meetings get a curated dropdown of the
              outcomes reps actually log so the data is consistent across
              the team (Brayden's request); other types stay free-text. */}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            {selectedType === "call" ? (
              <select
                id="subject"
                className="w-full border rounded-md h-9 px-2 bg-background text-sm"
                value={form.watch("subject") ?? ""}
                onChange={(e) => form.setValue("subject", e.target.value)}
              >
                <option value="">Select call outcome...</option>
                <option value="Call - Spoke">Call - Spoke</option>
                <option value="Call - Left VM">Call - Left VM</option>
                <option value="Call - No answer">Call - No answer</option>
              </select>
            ) : selectedType === "meeting" ? (
              <select
                id="subject"
                className="w-full border rounded-md h-9 px-2 bg-background text-sm"
                value={form.watch("subject") ?? ""}
                onChange={(e) => form.setValue("subject", e.target.value)}
              >
                <option value="">Select meeting type...</option>
                <option value="Demo">Demo</option>
                <option value="Proposal conversation">Proposal conversation</option>
                <option value="Partner Meeting">Partner Meeting</option>
              </select>
            ) : (
              <Input id="subject" {...form.register("subject")} placeholder="Activity subject" />
            )}
            {form.formState.errors.subject && (
              <p className="text-sm text-destructive">
                {form.formState.errors.subject.message}
              </p>
            )}
          </div>

          {/* Body */}
          <div className="space-y-2">
            <Label htmlFor="body">Notes</Label>
            <Textarea
              id="body"
              {...form.register("body")}
              placeholder="Optional details..."
              rows={3}
            />
          </div>

          {/* Due Date — tasks only. This is the main scheduling input
              for a task and what the timeline displays prominently. */}
          {selectedType === "task" && (
            <div className="space-y-2">
              <Label htmlFor="due_at">Due Date</Label>
              <Input id="due_at" type="date" {...form.register("due_at")} />
            </div>
          )}

          {/* Activity Date — when this interaction actually happened
              (or was logged). Defaults to today. Reps can backdate
              when they're catching up on logging from earlier in the
              week. Applies to every activity type, including tasks
              (separate from when the task is due). */}
          <div className="space-y-1">
            <Label htmlFor="activity_date" className="text-xs text-muted-foreground">
              Activity Date {selectedType === "task" && "(when logged — optional)"}
            </Label>
            <Input
              id="activity_date"
              type="date"
              {...form.register("activity_date")}
            />
            <p className="text-xs text-muted-foreground">
              Defaults to today. Change to backdate.
            </p>
          </div>

          {/* Reminder controls — only for tasks. When schedule != none,
              we also show the exact first-fire datetime + channels. */}
          {selectedType === "task" && (
            <div className="space-y-2 border rounded-md p-3">
              <Label className="text-sm font-semibold">Reminders</Label>
              <select
                className="w-full border rounded-md h-9 px-2 bg-background text-sm"
                value={form.watch("reminder_schedule") ?? "none"}
                onChange={(e) =>
                  form.setValue(
                    "reminder_schedule",
                    e.target.value as "none" | "once" | "daily" | "weekdays" | "weekly"
                  )
                }
              >
                <option value="none">No reminder</option>
                <option value="once">Once</option>
                <option value="daily">Daily until due</option>
                <option value="weekdays">Weekdays (M-F) until due</option>
                <option value="weekly">Weekly until due</option>
              </select>

              {form.watch("reminder_schedule") !== "none" &&
                form.watch("reminder_schedule") !== undefined && (
                  <>
                    <Label htmlFor="reminder_at" className="text-xs text-muted-foreground">
                      First reminder at
                    </Label>
                    <Input
                      id="reminder_at"
                      type="datetime-local"
                      {...form.register("reminder_at")}
                    />
                    <div className="flex flex-wrap gap-3 pt-1">
                      {(["in_app", "email"] as const).map((ch) => {
                        const channels = form.watch("reminder_channels") ?? [];
                        const checked = channels.includes(ch);
                        return (
                          <label
                            key={ch}
                            className="flex items-center gap-1 text-xs cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...channels, ch].filter(
                                      (v, i, a) => a.indexOf(v) === i
                                    )
                                  : channels.filter((v) => v !== ch);
                                form.setValue(
                                  "reminder_channels",
                                  next as Array<"in_app" | "email">
                                );
                              }}
                            />
                            {ch === "in_app" ? "In-app" : "Email"}
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Email reminders require your Outlook integration to have
                      Mail.Send permission (see admin).
                    </p>
                  </>
                )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? "Saving..."
                : isEditing
                ? "Save Changes"
                : "Log Activity"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
