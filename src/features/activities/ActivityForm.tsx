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
    },
  });

  function onSubmit(values: ActivityFormValues) {
    createMutation.mutate(
      {
        activity_type: values.activity_type,
        subject: values.subject,
        body: values.body || undefined,
        due_at: values.due_at || undefined,
        account_id: accountId,
        contact_id: contactId,
        opportunity_id: opportunityId,
        owner_user_id: user?.id,
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
