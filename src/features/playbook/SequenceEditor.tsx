// The one builder for everything: edit a campaign sequence step-by-step —
// channel, timing, automation, and either the email content or the rep-task
// details. Saves to campaign_templates.steps. Presets are "customized" into a
// new copy (handled by the caller passing no id); custom templates update.

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import { toast } from "sonner";
import { useDialogDiscardGuard } from "@/hooks/useDialogDiscardGuard";
import { useSaveTemplate } from "./api";
import type { CampaignTemplate, SequenceStep } from "./types";
import { SequenceStepList } from "./SequenceStepList";
import { blankSequenceStep, incompleteAutoEmails } from "./sequence-authoring";

export function SequenceEditor({
  open,
  onOpenChange,
  initial,
  onSaved,
  onLaunch,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  // Pass a template to edit it (with id) or to seed a copy (omit id upstream);
  // pass null to start a blank custom sequence.
  initial: (Partial<CampaignTemplate> & { steps: SequenceStep[] }) | null;
  onSaved?: (t: CampaignTemplate) => void;
  // "Use this sequence" (new/copy templates only — Campaigns overhaul S3):
  // fires after the save succeeds, with the now-persisted template, so the
  // caller can open the launch wizard on real (saved) steps.
  onLaunch?: (t: CampaignTemplate) => void;
}) {
  const save = useSaveTemplate();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [steps, setSteps] = useState<SequenceStep[]>(
    initial?.steps?.length ? initial.steps.map((s) => ({ ...s })) : [blankSequenceStep(1, 1)],
  );
  const [revealErrors, setRevealErrors] = useState(false);

  const persist = (after: (t: CampaignTemplate) => void) => {
    if (!name.trim()) {
      toast.error("Give the sequence a name.");
      return;
    }
    const incomplete = incompleteAutoEmails(steps);
    if (incomplete.length) {
      setRevealErrors(true);
      toast.error(`${incomplete.length === 1 ? "One automated email needs" : `${incomplete.length} automated emails need`} a subject and message.`);
      return;
    }
    save.mutate(
      {
        id: initial?.id,
        name,
        description,
        category: initial?.category ?? "custom",
        steps,
      },
      {
        onSuccess: after,
        onError: (e) => toast.error("Save failed: " + (e as Error).message),
      },
    );
  };

  const handleSave = () => persist((t) => {
    toast.success(initial?.id ? "Sequence saved" : "Saved as a template");
    onSaved?.(t);
    onOpenChange(false);
  });

  const handleSaveAndLaunch = () => persist((t) => {
    onSaved?.(t);
    onLaunch?.(t);
    onOpenChange(false);
  });

  // Guard against a stray outside-click/Esc wiping a build in progress —
  // compare against the initial/seeded steps so opening and closing
  // untouched (or an unmodified "customize a copy") doesn't trip it. Each
  // open is a fresh mount (name/description/steps are lazy useState off
  // `initial`, never re-synced), so comparing against `initial` here is safe.
  const initialSteps = initial?.steps?.length ? initial.steps : [blankSequenceStep(1, 1)];
  const dirty =
    name !== (initial?.name ?? "") ||
    description !== (initial?.description ?? "") ||
    JSON.stringify(steps) !== JSON.stringify(initialSteps);
  const discard = useDialogDiscardGuard(dirty, () => onOpenChange(false));

  return (
    <>
    <Dialog open={open} onOpenChange={discard.guardedOnOpenChange}>
      <DialogContent className="campaigns-aurora sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Edit sequence" : "Build a sequence"}</DialogTitle>
          <DialogDescription>
            Email steps marked “sends automatically” go out through Smartlead.
            Calls, LinkedIn, and review-and-send emails become your tasks in Up Next.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="seq-name">Name</Label>
              <Input
                id="seq-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. SMB outbound, 6 touch"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="seq-desc">Description</Label>
              <Input
                id="seq-desc"
                value={description ?? ""}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <SequenceStepList steps={steps} onChange={setSteps} revealErrors={revealErrors} />
        </div>

        <DialogFooter className="gap-2 sm:items-center">
          <Button variant="ghost" onClick={discard.requestClose}>
            Cancel
          </Button>
          {initial?.id ? (
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save changes
            </Button>
          ) : (
            <>
              {/* Both buttons save this as a new campaign_templates row (it
                  becomes a reusable card in the gallery either way) —
                  "Use this sequence" additionally opens the launch wizard
                  (mode="template") on the just-saved steps afterward. */}
              <Button variant="outline" onClick={handleSave} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Save as template
              </Button>
              <Button
                variant="ai"
                onClick={handleSaveAndLaunch}
                disabled={save.isPending}
              >
                {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Use this sequence
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {discard.dialog}
    </>
  );
}
