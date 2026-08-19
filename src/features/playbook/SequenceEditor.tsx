// The one builder for everything: edit a campaign sequence step-by-step —
// channel, timing, automation, and either the email content or the rep-task
// details. Saves to campaign_templates.steps. Presets are "customized" into a
// new copy (handled by the caller passing no id); custom templates update.

import { useState } from "react";
import {
  Mail,
  MailCheck,
  Phone,
  Users,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  UserRound,
  Building2,
  Signature,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useDialogDiscardGuard } from "@/hooks/useDialogDiscardGuard";
import { useSaveTemplate } from "./api";
import type { CampaignTemplate, SequenceChannel, SequenceStep } from "./types";
import {
  AUTHOR_TOKENS,
  authorTextToTemplateHtml,
  insertAuthorToken,
  hasUnsupportedRichEmailHtml,
  templateToAuthorText,
} from "./campaign-content";

const CHANNELS: {
  value: SequenceChannel;
  label: string;
  automation: SequenceStep["automation"];
  icon: React.ComponentType<{ className?: string }>;
  isEmail: boolean;
  isTask: boolean;
}[] = [
  { value: "EMAIL_AUTO", label: "Email: sends automatically", automation: "AUTO", icon: Mail, isEmail: true, isTask: false },
  { value: "EMAIL_HYBRID", label: "Email: you review and send", automation: "HYBRID", icon: MailCheck, isEmail: true, isTask: true },
  { value: "CALL", label: "Call: becomes your task", automation: "MANUAL", icon: Phone, isEmail: false, isTask: true },
  { value: "LINKEDIN", label: "LinkedIn: becomes your task", automation: "MANUAL", icon: Users, isEmail: false, isTask: true },
];
const channelDef = (c: SequenceChannel) => CHANNELS.find((x) => x.value === c) ?? CHANNELS[0];

function freshStep(dayOffset: number): SequenceStep {
  return {
    order: 0,
    day_offset: dayOffset,
    channel: "EMAIL_AUTO",
    automation: "AUTO",
    send_window_start: "10:00",
    send_window_end: "11:00",
    content_ai_draft: false,
    pause_on_reply: true,
    stop_on_unsubscribe: true,
    subject_template: "",
    body_template: "",
  };
}

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
    initial?.steps?.length ? initial.steps.map((s) => ({ ...s })) : [freshStep(1)],
  );
  const [channelPicker, setChannelPicker] = useState<number | null>(null);
  const [subjectFocused, setSubjectFocused] = useState<number | null>(null);

  const patchStep = (i: number, patch: Partial<SequenceStep>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const setChannel = (i: number, channel: SequenceChannel) => {
    const def = channelDef(channel);
    patchStep(i, { channel, automation: def.automation });
  };

  const move = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      // Swap the step CONTENT but keep each position's day_offset, so the
      // sequence stays chronological (position order == timing order) — moving
      // a step up makes it happen earlier rather than saving a backwards cadence.
      const dayAtI = next[i].day_offset;
      const dayAtJ = next[j].day_offset;
      [next[i], next[j]] = [next[j], next[i]];
      next[i] = { ...next[i], day_offset: dayAtI };
      next[j] = { ...next[j], day_offset: dayAtJ };
      return next;
    });

  const addStep = () =>
    setSteps((prev) => [
      ...prev,
      freshStep((prev[prev.length - 1]?.day_offset ?? 0) + 3),
    ]);

  const removeStep = (i: number) =>
    setSteps((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("Give the sequence a name.");
      return;
    }
    const firstEmailIndex = steps.findIndex((s) => s.channel === "EMAIL_AUTO");
    const incomplete = steps.filter((s, index) => s.channel === "EMAIL_AUTO" && (
      !templateToAuthorText(s.body_template ?? "").trim() ||
      (index === firstEmailIndex && !s.subject_template?.trim())
    ));
    if (incomplete.length) {
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
        onSuccess: (t) => {
          toast.success(initial?.id ? "Sequence saved" : "Saved as a template");
          onSaved?.(t);
          onOpenChange(false);
        },
        onError: (e) => toast.error("Save failed: " + (e as Error).message),
      },
    );
  };

  // "Use this sequence" — saves first (same path as "Save as template"),
  // then hands the caller the persisted template so it can open the launch
  // wizard on real steps instead of unsaved local state.
  const handleSaveAndLaunch = () => {
    if (!name.trim()) {
      toast.error("Give the sequence a name.");
      return;
    }
    const firstEmailIndex = steps.findIndex((s) => s.channel === "EMAIL_AUTO");
    const incomplete = steps.filter((s, index) => s.channel === "EMAIL_AUTO" && (
      !templateToAuthorText(s.body_template ?? "").trim() ||
      (index === firstEmailIndex && !s.subject_template?.trim())
    ));
    if (incomplete.length) {
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
        onSuccess: (t) => {
          onSaved?.(t);
          onLaunch?.(t);
          onOpenChange(false);
        },
        onError: (e) => toast.error("Save failed: " + (e as Error).message),
      },
    );
  };

  // Guard against a stray outside-click/Esc wiping a build in progress —
  // compare against the initial/seeded steps so opening and closing
  // untouched (or an unmodified "customize a copy") doesn't trip it. Each
  // open is a fresh mount (name/description/steps are lazy useState off
  // `initial`, never re-synced), so comparing against `initial` here is safe.
  const initialSteps = initial?.steps?.length ? initial.steps : [freshStep(1)];
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
            Calls, LinkedIn, and review-&-send emails become your tasks in Up Next.
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

          <div className="space-y-3">
            {steps.map((s, i) => {
              const def = channelDef(s.channel);
              const Icon = def.icon;
              const hasAdvancedFormatting = def.isEmail && hasUnsupportedRichEmailHtml(s.body_template ?? "");
              return (
                <div key={i} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="gap-1">
                      <Icon className="h-3.5 w-3.5" /> Step {i + 1}
                    </Badge>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      Day
                      <Input
                        type="number"
                        min={1}
                        value={s.day_offset}
                        onChange={(e) =>
                          patchStep(i, { day_offset: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className="h-7 w-16"
                      />
                    </div>
                    <div className="ml-auto flex items-center gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Move up"
                        onClick={() => move(i, -1)} disabled={i === 0}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Move down"
                        onClick={() => move(i, 1)} disabled={i === steps.length - 1}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        title="Remove step" onClick={() => removeStep(i)} disabled={steps.length <= 1}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setChannelPicker((open) => open === i ? null : i)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {def.label}
                    </button>
                    {channelPicker === i && (
                      <div className="grid grid-cols-2 gap-1.5">
                        {CHANNELS.map((c) => {
                          const CIcon = c.icon;
                          const active = s.channel === c.value;
                          return (
                            <button
                              key={c.value}
                              type="button"
                              onClick={() => { setChannel(i, c.value); setChannelPicker(null); }}
                              className={
                                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-left transition-colors " +
                                (active
                                  ? "campaigns-method bg-primary/10 text-foreground"
                                  : "text-muted-foreground hover:bg-muted")
                              }
                              data-selected={active}
                            >
                              <CIcon className="h-4 w-4 shrink-0" />
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Email content */}
                  {def.isEmail && (
                    <div className="space-y-2">
                      {s.content_ai_draft && (
                        <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                          This older template was marked “AI writes later,” but no email should launch unseen. Add the wording here to make it ready.
                        </p>
                      )}
                      <Input
                        placeholder="Subject"
                        value={templateToAuthorText(s.subject_template ?? "")}
                        onChange={(e) => patchStep(i, { subject_template: e.target.value, content_ai_draft: false })}
                        onFocus={() => setSubjectFocused(i)}
                        className="h-8"
                      />
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="mr-1 text-xs text-muted-foreground">{subjectFocused === i ? "Add to subject" : "Personalize"}</span>
                        <Button type="button" variant="outline" size="xs" onClick={() => {
                          if (subjectFocused === i) {
                            patchStep(i, { subject_template: insertAuthorToken(templateToAuthorText(s.subject_template ?? ""), AUTHOR_TOKENS.firstName), content_ai_draft: false });
                          } else {
                            patchStep(i, { body_template: authorTextToTemplateHtml(insertAuthorToken(templateToAuthorText(s.body_template ?? ""), AUTHOR_TOKENS.firstName)), content_ai_draft: false });
                          }
                        }}>
                          <UserRound className="h-3 w-3 mr-1" /> First name
                        </Button>
                        <Button type="button" variant="outline" size="xs" onClick={() => {
                          if (subjectFocused === i) {
                            patchStep(i, { subject_template: insertAuthorToken(templateToAuthorText(s.subject_template ?? ""), AUTHOR_TOKENS.organization), content_ai_draft: false });
                          } else {
                            patchStep(i, { body_template: authorTextToTemplateHtml(insertAuthorToken(templateToAuthorText(s.body_template ?? ""), AUTHOR_TOKENS.organization)), content_ai_draft: false });
                          }
                        }}>
                          <Building2 className="h-3 w-3 mr-1" /> Organization
                        </Button>
                        <Button type="button" variant="outline" size="xs" onClick={() => patchStep(i, { body_template: authorTextToTemplateHtml(insertAuthorToken(templateToAuthorText(s.body_template ?? ""), AUTHOR_TOKENS.signature)), content_ai_draft: false })}>
                          <Signature className="h-3 w-3 mr-1" /> Signature
                        </Button>
                      </div>
                      {hasAdvancedFormatting ? (
                        <>
                          <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                            This email uses advanced layout or embedded images. Pulse is preserving the body exactly so links and artwork are not lost; create a clean-copy step to replace it.
                          </p>
                          <div className="rounded border bg-white overflow-hidden">
                            <iframe title={`Step ${i + 1} email`} srcDoc={s.body_template ?? ""} sandbox="" className="w-full min-h-[160px]" />
                          </div>
                        </>
                      ) : <>
                      <Textarea
                        placeholder="Write the email exactly as it should read. Pulse handles names, spacing, and the sender signature."
                        value={templateToAuthorText(s.body_template ?? "")}
                        onChange={(e) => patchStep(i, { body_template: authorTextToTemplateHtml(e.target.value), content_ai_draft: false })}
                        onFocus={() => setSubjectFocused(null)}
                        rows={6}
                      />
                      </>}
                    </div>
                  )}

                  {/* Task details */}
                  {def.isTask && (
                    <div className="space-y-2">
                      <Input
                        placeholder={
                          s.channel === "CALL"
                            ? "Task title, e.g. Call [[First name]] at [[Organization]]"
                            : s.channel === "LINKEDIN"
                              ? "Task title, e.g. LinkedIn connect: [[First name]]"
                              : "Task title, e.g. Review & send to [[First name]]"
                        }
                        value={templateToAuthorText(s.manual_task_title_template ?? "")}
                        onChange={(e) => patchStep(i, { manual_task_title_template: e.target.value })}
                        className="h-8"
                      />
                      <Textarea
                        placeholder="Note for the rep (optional)"
                        value={templateToAuthorText(s.task_note_template ?? "")}
                        onChange={(e) => patchStep(i, { task_note_template: e.target.value })}
                        rows={2}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            <Button variant="outline" size="sm" onClick={addStep} className="w-full">
              <Plus className="h-4 w-4 mr-1" /> Add step
            </Button>
          </div>
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
