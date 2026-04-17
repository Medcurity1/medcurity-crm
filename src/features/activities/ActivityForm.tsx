import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Phone, Mail, Calendar, StickyNote, CheckSquare } from "lucide-react";
import { activityFormSchema, type ActivityFormValues } from "./schema";
import { useCreateActivity } from "./api";
import { useAuth } from "@/features/auth/AuthProvider";
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
import type { ActivityType } from "@/types/crm";

interface ActivityFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  leadId?: string;
}

const activityTypes: { value: ActivityType; label: string; icon: typeof Phone }[] = [
  { value: "call", label: "Call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "meeting", label: "Meeting", icon: Calendar },
  { value: "note", label: "Note", icon: StickyNote },
  { value: "task", label: "Task", icon: CheckSquare },
];

export function ActivityForm({
  open,
  onOpenChange,
  accountId,
  contactId,
  opportunityId,
  leadId,
}: ActivityFormProps) {
  const { user } = useAuth();
  const createMutation = useCreateActivity();

  const form = useForm<ActivityFormValues>({
    resolver: zodResolver(activityFormSchema),
    defaultValues: {
      activity_type: "note",
      subject: "",
      body: "",
      due_at: "",
      reminder_schedule: "none",
      reminder_at: "",
      reminder_channels: ["in_app"],
    },
  });

  function onSubmit(values: ActivityFormValues) {
    const isTask = values.activity_type === "task";
    const reminderSchedule = isTask
      ? (values.reminder_schedule ?? "none")
      : "none";
    createMutation.mutate(
      {
        activity_type: values.activity_type,
        subject: values.subject,
        body: values.body || undefined,
        due_at: values.due_at || undefined,
        account_id: accountId,
        contact_id: contactId,
        opportunity_id: opportunityId,
        lead_id: leadId,
        owner_user_id: user?.id,
        reminder_schedule: reminderSchedule,
        reminder_at:
          isTask && reminderSchedule !== "none" && values.reminder_at
            ? new Date(values.reminder_at).toISOString()
            : null,
        reminder_channels:
          isTask && reminderSchedule !== "none"
            ? values.reminder_channels ?? ["in_app"]
            : ["in_app"],
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
          <DialogTitle>Log Activity</DialogTitle>
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

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" {...form.register("subject")} placeholder="Activity subject" />
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

          {/* Due date */}
          <div className="space-y-2">
            <Label htmlFor="due_at">Due Date</Label>
            <Input id="due_at" type="date" {...form.register("due_at")} />
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
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving..." : "Log Activity"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
