import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  builderProgress,
  firstMeaningfulLine,
  formatSequenceWhen,
  initialLaunchStep,
  resumeLaunchStep,
  sequenceStepHeadline,
  templateLaunchProgress,
} from "../src/features/playbook/campaign-launch";

const read = (relative: string) => readFileSync(path.resolve(__dirname, "..", relative), "utf8");

function visibleSource(relative: string): string {
  return read(relative)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("template launch flow", () => {
  it("starts a template launch on audience, or review when people are already locked", () => {
    expect(initialLaunchStep("template", false)).toBe(2);
    expect(initialLaunchStep("template", true)).toBe(3);
    expect(initialLaunchStep("ai", false)).toBe(1);
  });

  it("resumes templates through audience unless recipients are locked", () => {
    expect(resumeLaunchStep("template", 2, false)).toBe(2);
    expect(resumeLaunchStep("template", 4, false)).toBe(2);
    expect(resumeLaunchStep("template", 4, true)).toBe(3);
    expect(resumeLaunchStep("ai", 4, false)).toBe(2);
    expect(resumeLaunchStep("ai", 2, false)).toBe(1);
  });

  it("shows people, then review, or review only when recipients are locked", () => {
    expect(templateLaunchProgress(2, false)).toMatchObject({
      displayStep: 1,
      displayTotal: 2,
      title: "People",
    });
    expect(templateLaunchProgress(3, false)).toMatchObject({
      displayStep: 2,
      displayTotal: 2,
      title: "Review",
    });
    expect(templateLaunchProgress(3, true)).toMatchObject({
      displayStep: 1,
      displayTotal: 1,
      title: "Review",
    });
    expect(builderProgress("ai", 1, false).title).toBe("Build");
    expect(builderProgress("template", 1, false)).toMatchObject({
      displayStep: 1,
      displayTotal: 3,
      title: "Build",
    });
  });

  it("formats sequence timing without dashes", () => {
    expect(formatSequenceWhen(1, "Mon")).toBe("Day 1 Mon");
    expect(formatSequenceWhen(5, "Fri", "10:00", "11:00")).toBe("Day 5 Fri 10:00 to 11:00");
    expect(formatSequenceWhen(8, "Mon", "09:00")).toBe("Day 8 Mon 09:00");
  });

  it("shows a real subject or threaded follow-up instead of a generic email label", () => {
    expect(sequenceStepHeadline({ channel: "EMAIL_AUTO", subject: "Quick intro", isFirstEmail: true }))
      .toBe("Quick intro");
    expect(sequenceStepHeadline({ channel: "EMAIL_AUTO", subject: "  ", isFirstEmail: false }))
      .toBe("Threaded follow-up");
    expect(firstMeaningfulLine("<p>Hello there, this is the body.</p>")).toBe("Hello there, this is the body.");
  });

  it("keeps sequence rows collapsed until opened", () => {
    const timeline = read("src/features/playbook/SequenceTimeline.tsx");
    expect(timeline).toMatch(/defaultExpanded = false/);
    expect(timeline).toMatch(/aria-expanded=\{open\}/);
    expect(timeline).toMatch(/setOpenOrder\(open \? null : s\.order\)/);
  });

  it("keeps custom campaigns as a secondary choice on both creation pickers", () => {
    const gallery = read("src/features/playbook/TemplatesSection.tsx");
    const picker = read("src/features/playbook/QuickCampaignDialog.tsx");
    expect(gallery).toMatch(/Or start a custom campaign/);
    expect(picker).toMatch(/Or start a custom campaign/);
    expect(gallery).not.toMatch(/<h4 className="font-semibold text-sm">Custom sequence<\/h4>/);
    expect(picker.indexOf("Pick a template")).toBeLessThan(picker.indexOf("Or start a custom campaign"));
  });

  it("does not put visible em or en dashes on touched creation surfaces", () => {
    const files = [
      "src/features/playbook/campaign-launch.ts",
      "src/features/playbook/SequenceTimeline.tsx",
      "src/features/playbook/CampaignWizard.tsx",
      "src/features/playbook/SequenceStepList.tsx",
      "src/features/playbook/TemplatesSection.tsx",
      "src/features/playbook/QuickCampaignDialog.tsx",
    ];
    for (const file of files) {
      expect(visibleSource(file), file).not.toMatch(/[—–]/);
    }
  });
});
