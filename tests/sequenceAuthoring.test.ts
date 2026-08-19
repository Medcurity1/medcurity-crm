import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  addSequenceStep,
  blankSequenceStep,
  incompleteAutoEmails,
  moveSequenceStep,
  recommendedCustomSequence,
  removeSequenceStep,
  setSequenceChannel,
  shouldShowFieldValidation,
} from "../src/features/playbook/sequence-authoring";

const read = (relative: string) => readFileSync(path.resolve(__dirname, "..", relative), "utf8");

function visibleSource(relative: string): string {
  return read(relative)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("recommended write-my-own sequence", () => {
  it("seeds a compact mixed-channel cadence", () => {
    const steps = recommendedCustomSequence();
    expect(steps.map((step) => step.channel)).toEqual(["EMAIL_AUTO", "EMAIL_AUTO", "CALL"]);
    expect(steps.map((step) => step.day_offset)).toEqual([1, 3, 5]);
    expect(steps.map((step) => step.order)).toEqual([1, 2, 3]);
  });
});

describe("per-launch sequence mutations", () => {
  it("adds, removes, reorders, retimes, and changes channel", () => {
    let steps = recommendedCustomSequence();
    steps = addSequenceStep(steps);
    expect(steps).toHaveLength(4);
    expect(steps[3].channel).toBe("EMAIL_AUTO");
    expect(steps[3].day_offset).toBe(8);
    expect(steps[3].order).toBe(4);

    steps = setSequenceChannel(steps, 3, "LINKEDIN");
    expect(steps[3].channel).toBe("LINKEDIN");
    expect(steps[3].automation).toBe("MANUAL");

    steps = moveSequenceStep(steps, 3, -1);
    expect(steps[2].channel).toBe("LINKEDIN");
    expect(steps[2].day_offset).toBe(5);
    expect(steps[3].channel).toBe("CALL");
    expect(steps[3].day_offset).toBe(8);

    steps = removeSequenceStep(steps, 2);
    expect(steps.map((step) => step.channel)).toEqual(["EMAIL_AUTO", "EMAIL_AUTO", "CALL"]);
    expect(steps.map((step) => step.order)).toEqual([1, 2, 3]);
  });

  it("keeps at least one step", () => {
    const only = [blankSequenceStep(1, 1)];
    expect(removeSequenceStep(only, 0)).toEqual(only);
  });
});

describe("sequence validation timing", () => {
  it("stays neutral until a field is touched and left, or continue is attempted", () => {
    expect(shouldShowFieldValidation(false, false, false)).toBe(false);
    expect(shouldShowFieldValidation(true, false, false)).toBe(false);
    expect(shouldShowFieldValidation(false, true, false)).toBe(false);
    expect(shouldShowFieldValidation(true, true, false)).toBe(true);
    expect(shouldShowFieldValidation(false, false, true)).toBe(true);
  });

  it("treats empty recommended emails as incomplete only for launch gating", () => {
    expect(incompleteAutoEmails(recommendedCustomSequence())).toHaveLength(2);
  });
});

describe("CampaignWizard per-launch authoring", () => {
  it("keeps Write my own compact until Customize, then edits this launch only", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/recommendedCustomSequence/);
    expect(wizard).toMatch(/setCustomSequence\(true\)/);
    expect(wizard).toMatch(/Customize sequence/);
    expect(wizard).toMatch(/SequenceStepList/);
    expect(wizard).toMatch(/launchOnlyNotice/);
    expect(wizard).toMatch(/Edits apply to this launch only/);
    expect(wizard).not.toMatch(/useSaveTemplate/);
    expect(wizard).not.toMatch(/This email still needs wording/);
    expect(wizard).not.toMatch(/still needs wording before you can continue/);
  });

  it("resets method-specific defaults and does not attribute custom steps to a seeded template", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/setAutoStart\(false\);\s*setEditingSequence\(false\);/);
    expect(wizard).toMatch(/setAutoStart\(true\);\s*setEditingSequence\(false\);\s*setTemplateSteps\(templateSeed\?\.steps/);
    expect(wizard).toMatch(/template_id: customSequence \? undefined : \(templateSeed\?\.template_id \?\? undefined\)/);
    expect(wizard).toMatch(/flow === "template" && customSequence/);
  });

  it("uses the single Campaign name and Goal row for AI setup and generated copy", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard.match(/<Label className="text-xs">Goal<\/Label>/g)).toHaveLength(1);
    expect(wizard).not.toMatch(/<Label>What's the campaign\?<\/Label>/);
    expect(wizard).not.toMatch(/<Label className="text-xs">Target audience<\/Label>/);
    expect(wizard).toMatch(/Describe the audience and goal above to draft the sequence\./);
  });

  it("does not paper over keyboard input with stopPropagation", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    const list = visibleSource("src/features/playbook/SequenceStepList.tsx");
    expect(wizard).not.toMatch(/stopPropagation/);
    expect(list).not.toMatch(/stopPropagation/);
    expect(list).toMatch(/authorTextToTemplateHtml\(e\.target\.value\)/);
  });

  it("exposes add/remove/reorder, day/timing, and all four channels in the shared editor", () => {
    const list = visibleSource("src/features/playbook/SequenceStepList.tsx");
    expect(list).toMatch(/Add step/);
    expect(list).toMatch(/Move up/);
    expect(list).toMatch(/Move down/);
    expect(list).toMatch(/Remove step/);
    expect(list).toMatch(/send_window_start/);
    expect(list).toMatch(/EMAIL_AUTO/);
    expect(list).toMatch(/EMAIL_HYBRID/);
    expect(list).toMatch(/CALL/);
    expect(list).toMatch(/LINKEDIN/);
    expect(list).toMatch(/Add a subject/);
    expect(list).toMatch(/Add the email wording/);
    expect(list.match(/Add the email wording/g)).toHaveLength(1);
    expect(list.match(/Add a subject/g)).toHaveLength(1);
  });
});
