// QuickCampaignDialog — the right-click / Contact-detail fast path into a
// campaign (Campaigns overhaul S7). Pick a template (compact preset cards,
// same data TemplatesSection uses), then hand off to the EXISTING
// CampaignWizard in template mode with the picked contact(s) pre-seeded as
// recipients. Works for a single contact or a multi-select.
//
// Solo by design (Nathan): a right-click start is ALWAYS its own campaign —
// no "add to an existing campaign" option here, even if one's already
// running. Smartlead-side clutter from that is an accepted tradeoff for
// keeping this a one-click flow.

import { useState } from "react";
import { Layers, Clock, Wand2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { formatName } from "@/lib/formatters";
import { useCampaignTemplates, useSmartleadStatus, type Recipient } from "./api";
import { CampaignWizard } from "./CampaignWizard";
import { CATEGORY } from "./TemplatesSection";
import { SequenceMiniPreview } from "./SequenceTimeline";
import type { CampaignTemplate } from "./types";

/** The subset of a Contact this dialog needs — deliberately loose so both
 *  ContactsList's row objects and ContactDetail's single-contact object
 *  (different query shapes, same underlying columns) pass straight through. */
export interface QuickCampaignContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  account_id?: string | null;
  account?: { name: string | null } | null;
}

function contactLabel(c: QuickCampaignContact): string {
  const name = formatName(c.first_name ?? "", c.last_name ?? "").trim();
  return name || c.email || "this contact";
}

export function QuickCampaignDialog({
  open, onOpenChange, contacts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contacts: QuickCampaignContact[];
}) {
  const { data: templates, isLoading } = useCampaignTemplates();
  const { data: sl } = useSmartleadStatus();
  // Only a confirmed `false` disables — undefined (still loading) and true
  // both leave the picker enabled, so the gate never flashes on while the
  // status query is in flight.
  const smartleadDisabled = sl?.configured === false;
  const [launchOpen, setLaunchOpen] = useState(false);
  const [launchNonce, setLaunchNonce] = useState(0);
  const [launchSeed, setLaunchSeed] = useState<{ template_id: string | null; name: string; steps: CampaignTemplate["steps"] } | null>(null);
  const [launchRecipients, setLaunchRecipients] = useState<Recipient[]>([]);

  // Only people with an email on file can be enrolled — same rule every
  // other recipient source (tag/CSV/paste) enforces via EMAIL_RE in
  // CampaignRecipients.tsx.
  const withEmail = contacts.filter((c) => !!c.email?.trim());
  const missingEmail = contacts.length - withEmail.length;

  function pickTemplate(t: CampaignTemplate) {
    const recipients: Recipient[] = withEmail.map((c) => ({
      email: (c.email as string).trim(),
      first_name: c.first_name ?? "",
      last_name: c.last_name ?? "",
      company_name: c.account?.name ?? "",
      contact_id: c.id,
      account_id: c.account_id ?? undefined,
    }));
    const label = withEmail.length === 1
      ? contactLabel(withEmail[0])
      : `${withEmail.length} people`;
    setLaunchRecipients(recipients);
    setLaunchSeed({ template_id: t.id, name: `${t.name} — ${label}`, steps: t.steps });
    setLaunchNonce((n) => n + 1);
    onOpenChange(false);
    setLaunchOpen(true);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Start a campaign</DialogTitle>
            <DialogDescription>
              {contacts.length === 1
                ? `Pick a sequence for ${contactLabel(contacts[0])}. This starts a new campaign just for them.`
                : `Pick a sequence for ${contacts.length} people. This starts one new campaign for the group.`}
            </DialogDescription>
          </DialogHeader>

          {missingEmail > 0 && withEmail.length > 0 && (
            <p className="text-xs text-amber-600">
              {missingEmail} of {contacts.length} {missingEmail === 1 ? "person has" : "people have"} no email on
              file and won't be included.
            </p>
          )}

          {smartleadDisabled ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Campaigns aren't connected yet — ask an admin to finish Smartlead setup.
            </div>
          ) : withEmail.length === 0 ? (
            <EmptyState
              icon={Wand2}
              title="No email on file"
              description={
                contacts.length === 1
                  ? "Add an email address to this contact before starting a campaign."
                  : "None of the selected contacts have an email on file."
              }
            />
          ) : isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : !templates?.length ? (
            <EmptyState icon={Wand2} title="No sequence templates yet" description="Build one from Playbook → Campaigns first." />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {templates.map((t) => {
                const cat = CATEGORY[t.category] ?? CATEGORY.custom;
                const Icon = cat.icon;
                return (
                  <Card
                    key={t.id}
                    className="py-0 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all overflow-hidden"
                    onClick={() => pickTemplate(t)}
                  >
                    <div className={cn("h-1 w-full bg-gradient-to-r", cat.accent)} />
                    <CardContent className="p-3 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className={cn("h-6 w-6 rounded-md flex items-center justify-center shrink-0", cat.chip)}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <h4 className="font-semibold text-sm truncate">{t.name}</h4>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <SequenceMiniPreview steps={t.steps} />
                        <span className="text-[11px] text-muted-foreground inline-flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center gap-1"><Layers className="h-3 w-3" />{t.step_count ?? t.steps.length}</span>
                          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{t.duration_days ?? "—"}d</span>
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hands off into the same wizard TemplatesSection uses — key remounts
          it fresh per open so a stale seed/recipient list never leaks in. */}
      <CampaignWizard
        key={launchNonce}
        open={launchOpen}
        onOpenChange={setLaunchOpen}
        mode="template"
        templateSeed={launchSeed ?? { template_id: null, name: "", steps: [] }}
        initialRecipients={launchRecipients}
      />
    </>
  );
}
