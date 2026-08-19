// Pure helpers for the Campaigns launch path. One shared builder for every
// user: Build, People, Review. Template and locked-recipient shortcuts skip
// steps that are already decided.

export type LaunchMode = "ai" | "template";
export type LaunchStep = 1 | 2 | 3;

export function initialLaunchStep(mode: LaunchMode, hasLockedRecipients: boolean): LaunchStep {
  if (mode === "template") return hasLockedRecipients ? 3 : 2;
  return 1;
}

/** Map a saved draft step onto the current 3-step builder. Older drafts used
 *  1=describe, 2=sequence, 3=people, 4=review. Never resume past the
 *  audience check unless recipients are already locked. */
export function resumeLaunchStep(
  mode: LaunchMode,
  savedStep: number,
  hasLockedRecipients: boolean,
): LaunchStep {
  const mapped: LaunchStep = savedStep >= 4 ? 3 : savedStep === 3 ? 2 : 1;
  if (mode === "template") return hasLockedRecipients ? 3 : 2;
  if (hasLockedRecipients) return mapped === 1 ? 1 : 3;
  if (mapped === 3) return 2;
  return mapped;
}

export function templateLaunchProgress(
  step: number,
  hasLockedRecipients: boolean,
): { displayStep: number; displayTotal: number; title: string; description: string } {
  return builderProgress("template", step, hasLockedRecipients);
}

export function builderProgress(
  mode: LaunchMode,
  step: number,
  hasLockedRecipients: boolean,
): { displayStep: number; displayTotal: number; title: string; description: string } {
  // A template shortcut normally starts on People/Review, but Back can
  // deliberately return to Build for per-launch sequence editing. The
  // header must follow the visible stage instead of the original shortcut.
  if (step === 1) {
    return {
      displayStep: 1,
      displayTotal: hasLockedRecipients ? 2 : 3,
      title: "Build",
      description: "Name the campaign, then use a template, draft with AI, or write your own.",
    };
  }
  if (mode === "template") {
    const displayTotal = hasLockedRecipients ? 1 : 2;
    if (hasLockedRecipients || step >= 3) {
      return {
        displayStep: displayTotal,
        displayTotal,
        title: "Review",
        description: "Check the sequence and recommended settings, then launch.",
      };
    }
    return {
      displayStep: 1,
      displayTotal,
      title: "People",
      description: "Who should get this?",
    };
  }

  const displayTotal = hasLockedRecipients ? 2 : 3;
  if (step >= 3) {
    return {
      displayStep: displayTotal,
      displayTotal,
      title: "Review",
      description: "Check the sequence and recommended settings, then launch.",
    };
  }
  if (step === 2 && !hasLockedRecipients) {
    return {
      displayStep: 2,
      displayTotal,
      title: "People",
      description: "Who should get this?",
    };
  }
  return {
    displayStep: 1,
    displayTotal,
    title: "Build",
    description: "Name the campaign, then use a template, draft with AI, or write your own.",
  };
}

export function formatSequenceWhen(
  dayOffset: number,
  weekday: string,
  start?: string,
  end?: string,
): string {
  const window = start ? (end ? `${start} to ${end}` : start) : "";
  return window ? `Day ${dayOffset} ${weekday} ${window}` : `Day ${dayOffset} ${weekday}`;
}

export function sequenceStepHeadline(input: {
  channel: string;
  subject?: string | null;
  isFirstEmail?: boolean;
}): string {
  if (input.channel === "CALL") return "Call";
  if (input.channel === "LINKEDIN") return "LinkedIn";
  if (input.channel === "EMAIL_HYBRID") return "Reviewed email";
  const subject = (input.subject ?? "").trim();
  if (subject) return subject;
  if (input.isFirstEmail === false) return "Threaded follow-up";
  return "Automated email";
}

export function firstMeaningfulLine(htmlOrText?: string | null): string {
  const text = (htmlOrText ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
