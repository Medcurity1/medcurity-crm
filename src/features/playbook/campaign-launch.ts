// Pure helpers for the Campaigns launch path. Keep the default template
// flow to three decisions: pick a template, choose people, review and launch.

export type LaunchMode = "ai" | "template";
export type LaunchStep = 1 | 2 | 3 | 4;

export function initialLaunchStep(mode: LaunchMode, hasLockedRecipients: boolean): LaunchStep {
  if (mode === "template") return hasLockedRecipients ? 4 : 3;
  return 1;
}

/** Never resume past the audience check. Old template drafts that landed on
 *  the email-wall step (2) now re-enter at people (3) or review (4). */
export function resumeLaunchStep(
  mode: LaunchMode,
  savedStep: number,
  hasLockedRecipients: boolean,
): LaunchStep {
  if (mode === "template") return hasLockedRecipients ? 4 : 3;
  if (savedStep === 4) return 3;
  if (savedStep === 1 || savedStep === 2 || savedStep === 3) return savedStep;
  return 1;
}

export function templateLaunchProgress(
  step: number,
  hasLockedRecipients: boolean,
): { displayStep: number; displayTotal: number; title: string; description: string } {
  const displayTotal = hasLockedRecipients ? 1 : 2;
  if (step === 2) {
    return {
      displayStep: displayTotal,
      displayTotal,
      title: "Edit sequence",
      description: "Edits apply to this launch only.",
    };
  }
  if (hasLockedRecipients || step === 4) {
    return {
      displayStep: displayTotal,
      displayTotal,
      title: "Review and launch",
      description: "Check the sequence, then start it.",
    };
  }
  return {
    displayStep: 1,
    displayTotal,
    title: "Choose people",
    description: "Who should get this?",
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
