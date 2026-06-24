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
  Sparkles,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useSaveTemplate } from "./api";
import type { CampaignTemplate, SequenceChannel, SequenceStep } from "./types";

const CHANNELS: {
  value: SequenceChannel;
  label: string;
  automation: SequenceStep["automation"];
  icon: React.ComponentType<{ className?: string }>;
  isEmail: boolean;
  isTask: boolean;
}[] = [
  { value: "EMAIL_AUTO", label: "Email — sends automatically", automation: "AUTO", icon: Mail, isEmail: true, isTask: false },
  { value: "EMAIL_HYBRID", label: "Email — you review & send", automation: "HYBRID", icon: MailCheck, isEmail: true, isTask: true },
  { value: "CALL", label: "Call — becomes your task", automation: "MANUAL", icon: Phone, isEmail: false, isTask: true },
  { value: "LINKEDIN", label: "LinkedIn — becomes your task", automation: "MANUAL", icon: Users, isEmail: false, isTask: true },
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
    content_ai_draft: true,
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
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  // Pass a template to edit it (with id) or to seed a copy (omit id upstream);
  // pass null to start a blank custom sequence.
  initial: (Partial<CampaignTemplate> & { steps: SequenceStep[] }) | null;
  onSaved?: (t: CampaignTemplate) => void;
}) {
  const save = useSaveTemplate();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [steps, setSteps] = useState<SequenceStep[]>(
    initial?.steps?.length ? initial.steps.map((s) => ({ ...s })) : [freshStep(1)],
  );

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
      [next[i], next[j]] = [next[j], next[i]];
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
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
                placeholder="e.g. SMB outbound — 6 touch"
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

                  {/* Channel picker */}
                  <div className="grid grid-cols-2 gap-1.5">
                    {CHANNELS.map((c) => {
                      const CIcon = c.icon;
                      const active = s.channel === c.value;
                      return (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setChannel(i, c.value)}
                          className={
                            "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs text-left transition-colors " +
                            (active
                              ? "border-primary bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-muted")
                          }
                        >
                          <CIcon className="h-4 w-4 shrink-0" />
                          {c.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Email content */}
                  {def.isEmail && (
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <Checkbox
                          checked={!!s.content_ai_draft}
                          onCheckedChange={(v) => patchStep(i, { content_ai_draft: !!v })}
                        />
                        <Sparkles className="h-3.5 w-3.5" /> Let AI draft this email when the campaign runs
                      </label>
                      {!s.content_ai_draft && (
                        <>
                          <Input
                            placeholder="Subject"
                            value={s.subject_template ?? ""}
                            onChange={(e) => patchStep(i, { subject_template: e.target.value })}
                            className="h-8"
                          />
                          <Textarea
                            placeholder="Email body — use {{first_name}}, {{company}} for merge fields"
                            value={s.body_template ?? ""}
                            onChange={(e) => patchStep(i, { body_template: e.target.value })}
                            rows={3}
                          />
                        </>
                      )}
                    </div>
                  )}

                  {/* Task details */}
                  {def.isTask && (
                    <div className="space-y-2">
                      <Input
                        placeholder={
                          s.channel === "CALL"
                            ? "Task title — e.g. Call {{first_name}} @ {{company}}"
                            : s.channel === "LINKEDIN"
                              ? "Task title — e.g. LinkedIn connect: {{first_name}}"
                              : "Task title — e.g. Review & send to {{first_name}}"
                        }
                        value={s.manual_task_title_template ?? ""}
                        onChange={(e) => patchStep(i, { manual_task_title_template: e.target.value })}
                        className="h-8"
                      />
                      <Textarea
                        placeholder="Note for the rep (optional)"
                        value={s.task_note_template ?? ""}
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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {initial?.id ? (
            <Button onClick={handleSave} disabled={save.isPending}>
              {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save changes
            </Button>
          ) : (
            <>
              {/* Save as a reusable card is OPTIONAL — pick it to keep this
                  sequence in your templates. Otherwise you'd just launch it
                  once (that launch flow is the next build). */}
              <Button variant="outline" onClick={handleSave} disabled={save.isPending}>
                {save.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                Save as template
              </Button>
              <Button
                variant="ai"
                disabled
                title="Launching on a list or contact is the next build"
              >
                Use this sequence
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
