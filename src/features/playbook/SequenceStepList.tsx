import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Building2,
  ChevronDown,
  Eye,
  Mail,
  MailCheck,
  PencilLine,
  Phone,
  Plus,
  Signature,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  AUTHOR_TOKENS,
  authorTextToTemplateHtml,
  campaignPreviewHtml,
  hasUnsupportedRichEmailHtml,
  insertAuthorToken,
  templateToAuthorText,
} from "./campaign-content";
import type { SequencePreviewContext } from "./SequenceTimeline";
import {
  addSequenceStep,
  firstAutoEmailIndex,
  moveSequenceStep,
  patchSequenceStep,
  removeSequenceStep,
  SEQUENCE_CHANNEL_OPTIONS,
  sequenceChannelDef,
  setSequenceChannel,
  shouldShowFieldValidation,
} from "./sequence-authoring";
import type { SequenceChannel, SequenceStep } from "./types";

const CHANNEL_ICONS = {
  EMAIL_AUTO: Mail,
  EMAIL_HYBRID: MailCheck,
  CALL: Phone,
  LINKEDIN: Users,
} as const;

function emailSrcDoc(bodyHtml: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;font-size:14px;line-height:1.5;padding:16px;max-width:600px;margin:0 auto;">${bodyHtml}</div>`;
}

export function SequenceStepList({
  steps,
  onChange,
  previewContext = {},
  revealErrors = false,
  launchOnlyNotice = false,
}: {
  steps: SequenceStep[];
  onChange: (steps: SequenceStep[]) => void;
  previewContext?: SequencePreviewContext;
  revealErrors?: boolean;
  launchOnlyNotice?: boolean;
}) {
  const [channelPicker, setChannelPicker] = useState<number | null>(null);
  const [subjectFocused, setSubjectFocused] = useState<number | null>(null);
  const [codeView, setCodeView] = useState<Set<number>>(new Set());
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [left, setLeft] = useState<Set<string>>(new Set());
  const firstEmailIndex = firstAutoEmailIndex(steps);

  const markTouched = (key: string) => setTouched((current) => new Set(current).add(key));
  const markLeft = (key: string) => {
    setTouched((current) => new Set(current).add(key));
    setLeft((current) => new Set(current).add(key));
  };
  const showError = (key: string) =>
    shouldShowFieldValidation(touched.has(key), left.has(key), revealErrors);

  const togglePreview = (index: number) => {
    setCodeView((current) => {
      const next = new Set(current);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {launchOnlyNotice && (
        <p className="text-xs font-medium text-muted-foreground">Edits apply to this launch only.</p>
      )}
      {steps.map((step, index) => {
        const def = sequenceChannelDef(step.channel);
        const Icon = CHANNEL_ICONS[step.channel] ?? Mail;
        const authorBody = templateToAuthorText(step.body_template ?? "");
        const hasAdvancedFormatting = def.isEmail && hasUnsupportedRichEmailHtml(step.body_template ?? "");
        const isPreview = codeView.has(index);
        const requireSubject = step.channel === "EMAIL_AUTO" && index === firstEmailIndex;
        const subjectKey = `${index}:subject`;
        const bodyKey = `${index}:body`;
        const subjectEmpty = !templateToAuthorText(step.subject_template ?? "").trim();
        const bodyEmpty = !authorBody.trim();
        const showSubjectError = def.isEmail && requireSubject && subjectEmpty && showError(subjectKey);
        const showBodyError = step.channel === "EMAIL_AUTO" && bodyEmpty && showError(bodyKey);
        const stepInvalid = showSubjectError || showBodyError;
        return (
          <div
            key={`${step.order}-${index}`}
            data-sequence-step={index}
            className={cn("camp-card p-3.5 space-y-3", stepInvalid && "!border-amber-400/70")}
          >
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Icon className="h-3.5 w-3.5" /> Step {index + 1}
              </Badge>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                Day
                <Input
                  type="number"
                  min={1}
                  value={step.day_offset}
                  onChange={(e) => onChange(patchSequenceStep(steps, index, {
                    day_offset: Math.max(1, Number(e.target.value) || 1),
                  }))}
                  className="h-7 w-16"
                  aria-label={`Step ${index + 1} day`}
                />
                {def.isEmail && (
                  <>
                    <Input
                      value={step.send_window_start ?? ""}
                      onChange={(e) => onChange(patchSequenceStep(steps, index, { send_window_start: e.target.value }))}
                      placeholder="10:00"
                      className="h-7 w-16"
                      aria-label={`Step ${index + 1} start time`}
                    />
                    to
                    <Input
                      value={step.send_window_end ?? ""}
                      onChange={(e) => onChange(patchSequenceStep(steps, index, { send_window_end: e.target.value }))}
                      placeholder="11:00"
                      className="h-7 w-16"
                      aria-label={`Step ${index + 1} end time`}
                    />
                  </>
                )}
              </div>
              <div className="ml-auto flex items-center gap-0.5">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Move up"
                  onClick={() => onChange(moveSequenceStep(steps, index, -1))} disabled={index === 0}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Move down"
                  onClick={() => onChange(moveSequenceStep(steps, index, 1))} disabled={index === steps.length - 1}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  title="Remove step" onClick={() => onChange(removeSequenceStep(steps, index))} disabled={steps.length <= 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                {/* A real dropdown-looking control — the step type is
                    changeable, and it should look changeable (Nathan 8/19). */}
                <button
                  type="button"
                  onClick={() => setChannelPicker((open) => open === index ? null : index)}
                  aria-expanded={channelPicker === index}
                  className="camp-btn text-xs !py-1.5"
                  title="Change step type"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {def.label}
                  <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", channelPicker === index && "rotate-180")} />
                </button>
                {/* Preview lives on the same line — a right-aligned toggle on
                    its own row read as a dead empty band (Nathan 8/19 r3). */}
                {def.isEmail && (
                  <Button variant="ghost" size="xs" className="h-6" disabled={hasAdvancedFormatting} onClick={() => togglePreview(index)}>
                    {isPreview ? <><PencilLine className="h-3 w-3 mr-1" /> Write</> : <><Eye className="h-3 w-3 mr-1" /> Preview</>}
                  </Button>
                )}
              </div>
              {channelPicker === index && (
                <div className="grid grid-cols-2 gap-1.5">
                  {SEQUENCE_CHANNEL_OPTIONS.map((option) => {
                    const OptionIcon = CHANNEL_ICONS[option.value];
                    const active = step.channel === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          onChange(setSequenceChannel(steps, index, option.value as SequenceChannel));
                          setChannelPicker(null);
                        }}
                        className="camp-method !flex-row !items-center !gap-2 !p-2.5 text-xs"
                        data-selected={active}
                      >
                        <OptionIcon className="h-4 w-4 shrink-0" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {def.isEmail && (
              <div className="space-y-2">
                {step.content_ai_draft && (
                  <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                    This older template was marked “AI writes later,” but no email should launch unseen. Add the wording here to make it ready.
                  </p>
                )}
                <Input
                  placeholder="Subject"
                  value={templateToAuthorText(step.subject_template ?? "")}
                  onChange={(e) => {
                    markTouched(subjectKey);
                    onChange(patchSequenceStep(steps, index, { subject_template: e.target.value, content_ai_draft: false }));
                  }}
                  onFocus={() => setSubjectFocused(index)}
                  onBlur={() => markLeft(subjectKey)}
                  className={cn("h-8", showSubjectError && "border-amber-400/60")}
                  aria-invalid={showSubjectError}
                />
                {showSubjectError && <p className="text-[11px] text-amber-600">Add a subject.</p>}
                {!isPreview && (
                <div className="flex flex-wrap items-center gap-1">
                  <span className="mr-1 text-xs text-muted-foreground">{subjectFocused === index ? "Add to subject" : "Personalize"}</span>
                  <Button type="button" variant="outline" size="xs" onClick={() => {
                    if (subjectFocused === index) {
                      onChange(patchSequenceStep(steps, index, {
                        subject_template: insertAuthorToken(templateToAuthorText(step.subject_template ?? ""), AUTHOR_TOKENS.firstName),
                        content_ai_draft: false,
                      }));
                    } else {
                      onChange(patchSequenceStep(steps, index, {
                        body_template: authorTextToTemplateHtml(insertAuthorToken(authorBody, AUTHOR_TOKENS.firstName)),
                        content_ai_draft: false,
                      }));
                    }
                  }}>
                    <UserRound className="h-3 w-3 mr-1" /> First name
                  </Button>
                  <Button type="button" variant="outline" size="xs" onClick={() => {
                    if (subjectFocused === index) {
                      onChange(patchSequenceStep(steps, index, {
                        subject_template: insertAuthorToken(templateToAuthorText(step.subject_template ?? ""), AUTHOR_TOKENS.organization),
                        content_ai_draft: false,
                      }));
                    } else {
                      onChange(patchSequenceStep(steps, index, {
                        body_template: authorTextToTemplateHtml(insertAuthorToken(authorBody, AUTHOR_TOKENS.organization)),
                        content_ai_draft: false,
                      }));
                    }
                  }}>
                    <Building2 className="h-3 w-3 mr-1" /> Organization
                  </Button>
                  <Button type="button" variant="outline" size="xs" onClick={() => onChange(patchSequenceStep(steps, index, {
                    body_template: authorTextToTemplateHtml(insertAuthorToken(authorBody, AUTHOR_TOKENS.signature)),
                    content_ai_draft: false,
                  }))}>
                    <Signature className="h-3 w-3 mr-1" /> Signature
                  </Button>
                </div>
                )}
                {hasAdvancedFormatting ? (
                  <>
                    <p className="rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-300">
                      This email uses advanced layout or embedded images. Pulse is preserving the body exactly so links and artwork are not lost; create a clean-copy step to replace it.
                    </p>
                    <div className="rounded border bg-white overflow-hidden">
                      <iframe title={`Step ${index + 1} email`} srcDoc={emailSrcDoc(step.body_template ?? "")} sandbox="" className="w-full min-h-[160px]" />
                    </div>
                  </>
                ) : <>
                  {isPreview ? (
                    <div className="rounded border bg-white overflow-hidden">
                      <iframe
                        title={`Step ${index + 1} preview`}
                        srcDoc={emailSrcDoc(campaignPreviewHtml(step.body_template ?? "", {
                          firstName: previewContext.firstName ?? undefined,
                          organization: previewContext.organization ?? undefined,
                        }))}
                        sandbox=""
                        className="w-full min-h-[160px]"
                      />
                    </div>
                  ) : (
                    <Textarea
                      placeholder="Write the email exactly as it should read. Pulse handles names, spacing, and the sender signature."
                      value={authorBody}
                      onChange={(e) => {
                        markTouched(bodyKey);
                        onChange(patchSequenceStep(steps, index, {
                          body_template: authorTextToTemplateHtml(e.target.value),
                          content_ai_draft: false,
                        }));
                      }}
                      onFocus={() => setSubjectFocused(null)}
                      onBlur={() => markLeft(bodyKey)}
                      rows={6}
                      className={cn(showBodyError && "border-amber-400/60")}
                      aria-invalid={showBodyError}
                    />
                  )}
                  {showBodyError && <p className="text-[11px] text-amber-600">Add the email wording.</p>}
                </>}
              </div>
            )}

            {def.isTask && (
              <div className="space-y-2">
                <Input
                  placeholder={
                    step.channel === "CALL"
                      ? "Task title, e.g. Call [[First name]] at [[Organization]]"
                      : step.channel === "LINKEDIN"
                        ? "Task title, e.g. LinkedIn connect: [[First name]]"
                        : "Task title, e.g. Review and send to [[First name]]"
                  }
                  value={templateToAuthorText(step.manual_task_title_template ?? "")}
                  onChange={(e) => onChange(patchSequenceStep(steps, index, { manual_task_title_template: e.target.value }))}
                  className="h-8"
                />
                <Textarea
                  placeholder="Note for the rep (optional)"
                  value={templateToAuthorText(step.task_note_template ?? "")}
                  onChange={(e) => onChange(patchSequenceStep(steps, index, { task_note_template: e.target.value }))}
                  rows={2}
                />
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="camp-btn w-full text-xs" onClick={() => onChange(addSequenceStep(steps))}>
        <Plus className="h-4 w-4" /> Add step
      </button>
    </div>
  );
}
