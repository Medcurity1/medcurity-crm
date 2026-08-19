import { templateToAuthorText } from "./campaign-content";
import type { SequenceAutomation, SequenceChannel, SequenceStep } from "./types";

export const SEQUENCE_CHANNEL_OPTIONS: {
  value: SequenceChannel;
  label: string;
  automation: SequenceAutomation;
  isEmail: boolean;
  isTask: boolean;
}[] = [
  { value: "EMAIL_AUTO", label: "Email: sends automatically", automation: "AUTO", isEmail: true, isTask: false },
  { value: "EMAIL_HYBRID", label: "Email: you review and send", automation: "HYBRID", isEmail: true, isTask: true },
  { value: "CALL", label: "Call: becomes your task", automation: "MANUAL", isEmail: false, isTask: true },
  { value: "LINKEDIN", label: "LinkedIn: becomes your task", automation: "MANUAL", isEmail: false, isTask: true },
];

export function sequenceChannelDef(channel: SequenceChannel) {
  return SEQUENCE_CHANNEL_OPTIONS.find((option) => option.value === channel) ?? SEQUENCE_CHANNEL_OPTIONS[0];
}

function defaultTaskTitle(channel: SequenceChannel): string {
  if (channel === "CALL") return "Call [[First name]] at [[Organization]]";
  if (channel === "LINKEDIN") return "LinkedIn connect: [[First name]]";
  if (channel === "EMAIL_HYBRID") return "Review and send to [[First name]]";
  return "";
}

export function blankSequenceStep(
  dayOffset: number,
  order = 0,
  channel: SequenceChannel = "EMAIL_AUTO",
): SequenceStep {
  const def = sequenceChannelDef(channel);
  return {
    order,
    day_offset: dayOffset,
    channel,
    automation: def.automation,
    send_window_start: def.isEmail ? "10:00" : undefined,
    send_window_end: def.isEmail ? "11:00" : undefined,
    content_ai_draft: false,
    pause_on_reply: true,
    stop_on_unsubscribe: true,
    subject_template: "",
    body_template: "",
    ...(def.isTask
      ? {
          manual_task_title_template: defaultTaskTitle(channel),
          task_note_template: "",
        }
      : {}),
  };
}

export function recommendedCustomSequence(): SequenceStep[] {
  return [
    blankSequenceStep(1, 1, "EMAIL_AUTO"),
    blankSequenceStep(3, 2, "EMAIL_AUTO"),
    blankSequenceStep(5, 3, "CALL"),
  ];
}

export function reindexSequenceSteps(steps: SequenceStep[]): SequenceStep[] {
  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}

export function addSequenceStep(steps: SequenceStep[]): SequenceStep[] {
  const last = steps[steps.length - 1];
  return reindexSequenceSteps([
    ...steps,
    blankSequenceStep((last?.day_offset ?? 0) + 3, steps.length + 1),
  ]);
}

export function removeSequenceStep(steps: SequenceStep[], index: number): SequenceStep[] {
  if (steps.length <= 1) return steps;
  return reindexSequenceSteps(steps.filter((_, stepIndex) => stepIndex !== index));
}

export function moveSequenceStep(steps: SequenceStep[], index: number, dir: -1 | 1): SequenceStep[] {
  const swapWith = index + dir;
  if (swapWith < 0 || swapWith >= steps.length) return steps;
  const next = [...steps];
  const dayAtIndex = next[index].day_offset;
  const dayAtSwap = next[swapWith].day_offset;
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  next[index] = { ...next[index], day_offset: dayAtIndex };
  next[swapWith] = { ...next[swapWith], day_offset: dayAtSwap };
  return reindexSequenceSteps(next);
}

export function patchSequenceStep(
  steps: SequenceStep[],
  index: number,
  patch: Partial<SequenceStep>,
): SequenceStep[] {
  return steps.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step));
}

export function setSequenceChannel(
  steps: SequenceStep[],
  index: number,
  channel: SequenceChannel,
): SequenceStep[] {
  const current = steps[index];
  if (!current) return steps;
  const def = sequenceChannelDef(channel);
  const patch: Partial<SequenceStep> = {
    channel,
    automation: def.automation,
  };
  if (def.isEmail) {
    patch.send_window_start = current.send_window_start || "10:00";
    patch.send_window_end = current.send_window_end || "11:00";
  }
  if (def.isTask && !templateToAuthorText(current.manual_task_title_template ?? "").trim()) {
    patch.manual_task_title_template = defaultTaskTitle(channel);
  }
  return patchSequenceStep(steps, index, patch);
}

export function firstAutoEmailIndex(steps: SequenceStep[]): number {
  return steps.findIndex((step) => step.channel === "EMAIL_AUTO");
}

export function isAutoEmailIncomplete(step: SequenceStep, requireSubject: boolean): boolean {
  const bodyEmpty = !templateToAuthorText(step.body_template ?? "").trim();
  const subjectEmpty = !templateToAuthorText(step.subject_template ?? "").trim();
  return bodyEmpty || (requireSubject && subjectEmpty);
}

export function incompleteAutoEmails(steps: SequenceStep[]): SequenceStep[] {
  const first = firstAutoEmailIndex(steps);
  return steps.filter((step, index) => (
    step.channel === "EMAIL_AUTO" && isAutoEmailIncomplete(step, index === first)
  ));
}

export function shouldShowFieldValidation(touched: boolean, left: boolean, attempted: boolean): boolean {
  return attempted || (touched && left);
}
