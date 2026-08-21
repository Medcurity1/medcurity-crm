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
  it("opens only action items and Active by default (Nathan 8/19)", () => {
    expect(defaultCampaignGroupOpen("needsYou", 2)).toBe(true);
    expect(defaultCampaignGroupOpen("active", 1)).toBe(true);
    expect(defaultCampaignGroupOpen("replies", 3)).toBe(true);
    // Drafts and Recently ended stay collapsed until asked for.
    expect(defaultCampaignGroupOpen("drafts", 4)).toBe(false);
    expect(defaultCampaignGroupOpen("recentlyEnded", 5)).toBe(false);
  });

  it("keeps empty groups closed and auto-opens collapsed groups during a search", () => {
    expect(defaultCampaignGroupOpen("needsYou", 0)).toBe(false);
    expect(defaultCampaignGroupOpen("replies", 0)).toBe(false);
    expect(defaultCampaignGroupOpen("drafts", 4, true)).toBe(true);
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
  it("does not paint a nested Campaigns title, an Operations menu, or the refresh-schedule line", () => {
    const tab = visibleSource("src/features/playbook/CampaignsTab.tsx");
    expect(tab).not.toMatch(/<h2[\s\S]*?>\s*Campaigns\s*</);
    expect(tab).not.toMatch(/Operations/);
    expect(tab).toMatch(/lastSyncedLabel/);
    // Nathan 8/19: "Synced N min ago" stays; the "Automatic refresh daily
    // at …" line is gone.
    expect(tab).not.toMatch(/dailySweepLocalTimeLabel/);
    expect(tab).not.toMatch(/Automatic refresh/);
  });

  it("has ONE sync action and no separate Advanced import anywhere (Nathan 8/19)", () => {
    const tab = visibleSource("src/features/playbook/CampaignsTab.tsx");
    const page = visibleSource("src/features/playbook/PlaybookPage.tsx");
    // The ordinary action remains a bounded unified refresh so campaigns
    // created directly in Smartlead are imported, without double-fetching
    // campaigns already refreshed during that same pass.
    expect(tab).toMatch(/Sync Smartlead/);
    expect(tab).toMatch(/useRefreshSmartlead/);
    expect(tab).not.toMatch(/Advanced import/);
    expect(tab).not.toMatch(/useImportCampaigns/);
    // Templates + Sending inboxes moved up beside Insights/Training.
    expect(page).toMatch(/Templates/);
    expect(page).toMatch(/Sending inboxes/);
    expect(page).toMatch(/Insights/);
    expect(page).toMatch(/Training/);
    // Their dialogs still live in the tab (they hand off into the wizard).
    expect(tab).toMatch(/camp-templates-dialog/);
    expect(tab).toMatch(/overflow-hidden flex flex-col p-0/);
    expect(tab).toMatch(/InboxHealthDialog/);
  });

  it("settles slow syncs and keeps the enrollment-safe server reconciliation", () => {
    const api = visibleSource("src/features/playbook/api.ts");
    const edge = visibleSource("supabase/functions/playbook-smartlead/index.ts");
    const shared = visibleSource("supabase/functions/_shared/smartlead.ts");
    expect(api).toMatch(/55_000/);
    expect(api).toMatch(/Partial updates were kept/);
    expect(edge).toMatch(/syncCampaigns\(Date\.now\(\) \+ 35_000\)/);
    expect(edge).toMatch(/new Set\(imported\.processedIds\)/);
    expect(edge).toMatch(/if \(!existing\)[\s\S]*fetchCampaignSequences/);
    expect(edge).toMatch(/reconcileTerminalEnrollments\(deadline\)/);
    expect(shared).toMatch(/SMARTLEAD_REQUEST_TIMEOUT_MS = 15_000/);
    expect(shared).toMatch(/controller\.abort\(\)/);
  });

  it("labels Pulse campaigns by their actual authoring method", () => {
    const card = visibleSource("src/features/playbook/CampaignCard.tsx");
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(card).toMatch(/Written in Pulse/);
    expect(card).toMatch(/Created in Pulse/);
    expect(wizard).toMatch(/authoring_method/);
    expect(wizard).toMatch(/write_own/);
  });

  it("guards every edited campaign-builder dismissal path", () => {
    const wizard = visibleSource("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/useDialogDiscardGuard/);
    expect(wizard).toMatch(/discard\.requestClose\(\)/);
    expect(wizard).toMatch(/\{discard\.dialog\}/);
  });

  it("toggles Replies, Needs you, Active, Drafts, and Recently ended independently", () => {
    const tab = visibleSource("src/features/playbook/CampaignsTab.tsx");
    const replies = visibleSource("src/features/playbook/CampaignReplies.tsx");
    for (const id of ["needsYou", "active", "drafts", "recentlyEnded"]) {
      expect(tab).toMatch(new RegExp(`id="${id}"`));
      expect(tab).toMatch(new RegExp(`toggleGroup\\("${id}"`));
    }
    // The shared section header (CampaignSection.tsx) carries the
    // aria-expanded toggle every group renders through.
    const section = visibleSource("src/features/playbook/CampaignSection.tsx");
    expect(section).toMatch(/aria-expanded=\{open\}/);
    expect(section).toMatch(/camp-section-head/);
    expect(tab).toMatch(/searchKey/);
    expect(tab).toMatch(/delete next\.recentlyEnded/);
    expect(replies).toMatch(/data-campaigns-group="replies"/);
    expect(replies).toMatch(/campaignGroupOpen\("replies"/);
    expect(replies).toMatch(/setOpenOverride\(!open\)/);
    expect(replies).toMatch(/CampaignSectionHeader/);
    // The Replies badge counts only UNHANDLED replies (Nathan 8/19) —
    // handled ones wait behind "Show handled" and don't hold the section
    // open either.
    expect(replies).toMatch(/const count = active\.length/);
    expect(replies).not.toMatch(/const count = replies\?\.length/);
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
    expect(wizard).toMatch(/camp-method/);
    expect(wizard).toMatch(/camp-icon-chip/);
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

describe("Campaigns visual system (Aurora, rebuilt 8/19)", () => {
  it("keeps campaign styles OUT of the global stylesheet", () => {
    const appCss = read("src/app.css");
    // The 8/19 regression lesson: campaign CSS in app.css once broke every
    // campaigns dialog. It all lives in the route stylesheet now.
    expect(appCss).not.toMatch(/campaigns?-aurora|camp-scope|camp-shell|camp-wash/);
  });

  it("separates the token scope from the page wash so portaled dialogs keep their backgrounds", () => {
    const css = read("src/features/playbook/campaigns.css");
    // .camp-scope defines ONLY variables — a paint property here would
    // override dialog backgrounds again (the exact 8/19 breakage).
    const scopeBlock = css.match(/\.camp-scope \{([\s\S]*?)\}/)?.[1] ?? "";
    expect(scopeBlock).toMatch(/--camp-purple/);
    expect(scopeBlock).not.toMatch(/^\s*(background|padding|border-radius|color)\s*:/m);
    // The wash is page-only and paints nothing in dark mode (Nathan 8/19:
    // dark Campaigns stays on the platform's own canvas).
    expect(css).toMatch(/\.dark \.camp-wash::before \{\s*content: none;/);
    // Dialogs carry their own solid surface via camp-shell.
    const shellBlock = css.match(/\.camp-shell \{([\s\S]*?)\}/)?.[1] ?? "";
    expect(shellBlock).toMatch(/background: var\(--camp-surface\)/);
    // Templates dialog sizing lives here too.
    expect(css).toMatch(/\.camp-templates-dialog \{/);
  });

  it("puts the token scope on every portaled campaigns surface", () => {
    for (const file of [
      "src/features/playbook/CampaignWizard.tsx",
      "src/features/playbook/CampaignsTab.tsx",
      "src/features/playbook/QuickCampaignDialog.tsx",
      "src/features/playbook/InboxHealthDialog.tsx",
      "src/features/playbook/SequenceEditor.tsx",
      "src/features/playbook/TemplatesSection.tsx",
      "src/features/playbook/CampaignDetailSheet.tsx",
    ]) {
      const src = read(file);
      const portals = src.match(/(DialogContent|SheetContent) className="([^"]*)"/g) ?? [];
      for (const portal of portals) {
        expect(portal, `${file}: ${portal}`).toMatch(/camp-scope/);
      }
    }
  });

  it("keeps campaign details in the centered Aurora dialog system, not the legacy side sheet", () => {
    const detail = read("src/features/playbook/CampaignDetailSheet.tsx");
    expect(detail).toMatch(/<Dialog open=\{open\}/);
    expect(detail).toMatch(/DialogContent className="camp-scope camp-shell/);
    expect(detail).toMatch(/sm:max-w-5xl/);
    expect(detail).toMatch(/Open in Smartlead/);
    expect(detail).not.toMatch(/<Sheet|SheetContent|side="right"/);
  });
});
