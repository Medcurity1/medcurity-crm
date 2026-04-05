import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, FileText } from "lucide-react";
import { useCreateActivity } from "./api";
import { useAuth } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import { pauseEnrollmentsOnEngagement } from "@/features/sequences/sequences-api";
import {
  useEmailTemplates,
  useIncrementUsage,
} from "@/features/email-templates/templates-api";
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
import type { Opportunity, EmailTemplate } from "@/types/crm";

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

function applyTemplateVariables(
  text: string,
  vars: { first_name: string; last_name: string; company: string; account_name: string }
): string {
  return text
    .replaceAll("{{first_name}}", vars.first_name)
    .replaceAll("{{last_name}}", vars.last_name)
    .replaceAll("{{company}}", vars.company)
    .replaceAll("{{account_name}}", vars.account_name);
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
  const incrementUsage = useIncrementUsage();
  const queryClient = useQueryClient();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const { data: templates } = useEmailTemplates();

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
      setSelectedTemplateId("");
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

  // Fetch contact for template variable replacement
  const { data: contact } = useQuery({
    queryKey: ["contact-for-template", contactId],
    queryFn: async () => {
      if (!contactId) return null;
      const { data, error } = await supabase
        .from("contacts")
        .select("first_name, last_name, account:accounts(name)")
        .eq("id", contactId)
        .single();
      if (error) throw error;
      return data as unknown as {
        first_name: string;
        last_name: string;
        account: { name: string } | null;
      };
    },
    enabled: !!contactId && open,
  });

  function handleApplyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    if (templateId === "__none__") {
      return;
    }
    const template = (templates ?? []).find(
      (t: EmailTemplate) => t.id === templateId
    );
    if (!template) return;

    const vars = {
      first_name: contact?.first_name ?? "",
      last_name: contact?.last_name ?? "",
      company: account?.name ?? contact?.account?.name ?? "",
      account_name: account?.name ?? contact?.account?.name ?? "",
    };

    form.setValue("subject", applyTemplateVariables(template.subject, vars));
    form.setValue("body", applyTemplateVariables(template.body, vars));

    // Track usage (fire-and-forget)
    incrementUsage.mutate(template.id);
  }

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
          {/* Template selector */}
          {templates && templates.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1 text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                Use Template
              </Label>
              <Select
                value={selectedTemplateId}
                onValueChange={handleApplyTemplate}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a template (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      {t.category ? ` · ${t.category}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
