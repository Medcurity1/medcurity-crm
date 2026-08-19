import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  campaignGroupOpen,
  collapsedSearchMatchLabel,
  defaultCampaignGroupOpen,
} from "@/features/playbook/campaign-groups";

const read = (relative: string) => readFileSync(path.resolve(__dirname, "..", relative), "utf8");

function visibleSource(relative: string): string {
  return read(relative)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("campaign group open defaults", () => {
  it("opens nonempty Needs you, Active, Drafts, and Replies by default", () => {
    expect(defaultCampaignGroupOpen("needsYou", 2)).toBe(true);
    expect(defaultCampaignGroupOpen("active", 1)).toBe(true);
    expect(defaultCampaignGroupOpen("drafts", 4)).toBe(true);
    expect(defaultCampaignGroupOpen("replies", 3)).toBe(true);
  });

  it("keeps empty groups closed and Recently ended closed unless search needs it", () => {
    expect(defaultCampaignGroupOpen("needsYou", 0)).toBe(false);
    expect(defaultCampaignGroupOpen("replies", 0)).toBe(false);
    expect(defaultCampaignGroupOpen("recentlyEnded", 5)).toBe(false);
    expect(defaultCampaignGroupOpen("recentlyEnded", 5, true)).toBe(true);
    expect(defaultCampaignGroupOpen("recentlyEnded", 0, true)).toBe(false);
  });

  it("lets a user override win, including collapsing a search-open Recently ended group", () => {
    expect(campaignGroupOpen("active", 3, false, false)).toBe(false);
    expect(campaignGroupOpen("recentlyEnded", 2, true, false)).toBe(false);
    expect(campaignGroupOpen("recentlyEnded", 2, false, true)).toBe(true);
    expect(campaignGroupOpen("replies", 0, false, true)).toBe(true);
  });

  it("labels hidden search matches on a collapsed group", () => {
    expect(collapsedSearchMatchLabel(0)).toBeNull();
    expect(collapsedSearchMatchLabel(1)).toBe("1 match");
    expect(collapsedSearchMatchLabel(4)).toBe("4 matches");
  });
});

describe("Campaigns home correction", () => {
  it("does not paint a nested Campaigns title or Operations menu", () => {
    const tab = visibleSource("src/features/playbook/CampaignsTab.tsx");
    expect(tab).not.toMatch(/<h2[\s\S]*?>\s*Campaigns\s*</);
    expect(tab).not.toMatch(/Operations/);
    expect(tab).toMatch(/lastSyncedLabel/);
    expect(tab).toMatch(/dailySweepLocalTimeLabel/);
  });

  it("names Templates, Sending inboxes, and Advanced import as separate actions", () => {
    const tab = visibleSource("src/features/playbook/CampaignsTab.tsx");
    expect(tab).toMatch(/> Templates/);
    expect(tab).toMatch(/> Sending inboxes/);
    expect(tab).toMatch(/> Advanced import/);
    expect(tab).toMatch(/Manage templates/);
    expect(tab).toMatch(/campaigns-templates-dialog/);
    expect(tab).toMatch(/overflow-hidden flex flex-col p-0/);
    expect(tab.indexOf("Templates")).toBeLessThan(tab.indexOf("Sending inboxes"));
    expect(tab.indexOf("Sending inboxes")).toBeLessThan(tab.indexOf("Advanced import"));
  });

  it("toggles Replies, Needs you, Active, Drafts, and Recently ended independently", () => {
    const tab = visibleSource("src/features/playbook/CampaignsTab.tsx");
    const replies = visibleSource("src/features/playbook/CampaignReplies.tsx");
    for (const id of ["needsYou", "active", "drafts", "recentlyEnded"]) {
      expect(tab).toMatch(new RegExp(`id="${id}"`));
      expect(tab).toMatch(new RegExp(`toggleGroup\\("${id}"`));
    }
    expect(tab).toMatch(/aria-expanded=\{open\}/);
    expect(tab).toMatch(/searchKey/);
    expect(tab).toMatch(/delete next\.recentlyEnded/);
    expect(replies).toMatch(/data-campaigns-group="replies"/);
    expect(replies).toMatch(/campaignGroupOpen\("replies"/);
    expect(replies).toMatch(/setOpenOverride\(!open\)/);
  });
});

describe("Aurora build method cards", () => {
  it("renders three unselected start cards with icons and descriptions", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/How would you like to start\?/);
    expect(wizard).toMatch(/Start from proven copy\./);
    expect(wizard).toMatch(/Describe the audience and goal\./);
    expect(wizard).toMatch(/Paste, write, or build the sequence yourself\./);
    expect(wizard).toMatch(/Icon: LayoutTemplate/);
    expect(wizard).toMatch(/Icon: Sparkles/);
    expect(wizard).toMatch(/Icon: PenLine/);
    expect(wizard).toMatch(/campaigns-start-choice/);
    expect(wizard).toMatch(/mode === "template" \? "template" : "choose"/);
    expect(wizard).toMatch(/aria-pressed=\{selected\}/);
    expect(wizard).toMatch(/customSequence/);
  });
});

describe("Build sequence authoring correction", () => {
  it("starts Write my own as a compact recommended sequence with optional Customize", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/Recommended sequence/);
    expect(wizard).toMatch(/Customize sequence/);
    expect(wizard).toMatch(/recommendedCustomSequence\(\)/);
    expect(wizard).toMatch(/setEditingSequence\(false\)/);
    expect(wizard).toMatch(/SequenceStepList/);
    expect(wizard).toMatch(/launchOnlyNotice/);
    expect(wizard).not.toMatch(/useSaveTemplate/);
  });

  it("reveals field-specific copy errors only after touch and blur or a continue attempt", () => {
    const list = visibleSource("src/features/playbook/SequenceStepList.tsx");
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(list).toMatch(/shouldShowFieldValidation/);
    expect(list).toMatch(/Add a subject/);
    expect(list).toMatch(/Add the email wording/);
    expect(list.match(/Add the email wording/g)).toHaveLength(1);
    expect(wizard).toMatch(/setSequenceAttempted\(true\)/);
    expect(wizard).not.toMatch(/This email still needs wording/);
    expect(wizard).not.toMatch(/One email above still needs wording/);
  });
});

describe("Campaigns visual system correction", () => {
  it("keeps dark Campaigns on the CRM gray surface instead of a black island", () => {
    const css = read("src/app.css");
    expect(css).not.toMatch(/hsl\(240 12% 3%\)/);
    expect(css).not.toMatch(/hsl\(240 10% 8%\)/);
    expect(css).toMatch(/\[data-campaigns-shell\]\.campaigns-aurora \{/);
    expect(css).toMatch(/background: transparent;/);
    expect(css).toMatch(/--campaigns-surface: hsl\(210 25% 11%\);/);
    expect(css).toMatch(/\.campaigns-start-choice\[data-selected="true"\]/);
    expect(css).toMatch(/\.campaigns-templates-dialog \{/);
    expect(css).toMatch(/overflow: hidden;/);
  });
});
