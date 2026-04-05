import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { useCreateActivity } from "./api";
import { useAuth } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { pauseEnrollmentsOnEngagement } from "@/features/sequences/sequences-api";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { Opportunity } from "@/types/crm";

const emailFormSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().optional(),
  date: z.string().min(1, "Date is required"),
  opportunity_id: z.string().optional(),
});

type EmailFormValues = z.infer<typeof emailFormSchema>;

interface LogEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  contactEmail?: string;
  contactName?: string;
}

export function LogEmailDialog({
  open,
  onOpenChange,
  accountId,
  contactId,
  opportunityId,
  contactEmail,
  contactName,
}: LogEmailDialogProps) {
  const { user } = useAuth();
  const createMutation = useCreateActivity();
  const queryClient = useQueryClient();

  const form = useForm<EmailFormValues>({
    resolver: zodResolver(emailFormSchema),
    defaultValues: {
      subject: "",
      body: "",
      date: new Date().toISOString().slice(0, 16),
      opportunity_id: opportunityId ?? "",
    },
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      form.reset({
        subject: "",
        body: "",
        date: new Date().toISOString().slice(0, 16),
        opportunity_id: opportunityId ?? "",
      });
    }
  }, [open, opportunityId, form]);

  // Fetch opportunities for the account
  const { data: opportunities } = useQuery({
    queryKey: ["opportunities", "for-account", accountId],
    queryFn: async () => {
      if (!accountId) return [];
      const { data, error } = await supabase
        .from("opportunities")
        .select("id, name, stage, amount")
        .eq("account_id", accountId)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Pick<Opportunity, "id" | "name" | "stage" | "amount">[];
    },
    enabled: !!accountId && open,
  });

  // Fetch account name for display
  const { data: account } = useQuery({
    queryKey: ["account-name", accountId],
    queryFn: async () => {
      if (!accountId) return null;
      const { data, error } = await supabase
        .from("accounts")
        .select("name")
        .eq("id", accountId)
        .single();
      if (error) throw error;
      return data as { name: string };
    },
    enabled: !!accountId && open,
  });

  function onSubmit(values: EmailFormValues) {
    createMutation.mutate(
      {
        activity_type: "email",
        subject: values.subject,
        body: values.body || undefined,
        due_at: values.date ? new Date(values.date).toISOString() : undefined,
        account_id: accountId,
        contact_id: contactId,
        opportunity_id: values.opportunity_id || opportunityId,
        owner_user_id: user?.id,
      },
      {
        onSuccess: async () => {
          toast.success("Email logged");
          // Auto-pause any active sequences for this contact (engagement detected)
          if (contactId) {
            try {
              const pausedCount = await pauseEnrollmentsOnEngagement({
                contactId,
                reason: "engagement",
              });
              if (pausedCount > 0) {
                toast.info(
                  `Paused ${pausedCount} active sequence${pausedCount === 1 ? "" : "s"} for this contact`
                );
                queryClient.invalidateQueries({
                  queryKey: ["sequence-enrollments", "by-contact", contactId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["sequence-enrollment-counts"],
                });
              }
            } catch {
              // Non-fatal
            }
          }
          form.reset();
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error("Failed to log email: " + (err as Error).message);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-purple-600" />
            Log Email
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* To field */}
          {contactEmail && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">To</Label>
              <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
                {contactName ? `${contactName} <${contactEmail}>` : contactEmail}
              </div>
            </div>
          )}

          {/* Related Account */}
          {account && (
            <div className="space-y-2">
              <Label className="text-muted-foreground">Account</Label>
              <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
                {account.name}
              </div>
            </div>
          )}

          {/* Subject */}
          <div className="space-y-2">
            <Label htmlFor="email-subject">Subject</Label>
            <Input
              id="email-subject"
              {...form.register("subject")}
              placeholder="Email subject"
            />
            {form.formState.errors.subject && (
              <p className="text-sm text-destructive">
                {form.formState.errors.subject.message}
              </p>
            )}
          </div>

          {/* Body / Notes */}
          <div className="space-y-2">
            <Label htmlFor="email-body">Body / Notes</Label>
            <Textarea
              id="email-body"
              {...form.register("body")}
              placeholder="Email content or summary..."
              rows={4}
            />
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label htmlFor="email-date">Date</Label>
            <Input
              id="email-date"
              type="datetime-local"
              {...form.register("date")}
            />
            {form.formState.errors.date && (
              <p className="text-sm text-destructive">
                {form.formState.errors.date.message}
              </p>
            )}
          </div>

          {/* Related Opportunity */}
          {accountId && opportunities && opportunities.length > 0 && (
            <div className="space-y-2">
              <Label>Related Opportunity</Label>
              <Select
                value={form.watch("opportunity_id") ?? ""}
                onValueChange={(val) =>
                  form.setValue("opportunity_id", val === "__none__" ? "" : val)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an opportunity (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {opportunities.map((opp) => (
                    <SelectItem key={opp.id} value={opp.id}>
                      {opp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {contactId && (
            <p className="text-xs text-muted-foreground">
              Note: This will pause any active sequences for this contact.
            </p>
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
              {createMutation.isPending ? "Saving..." : "Log Email"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
