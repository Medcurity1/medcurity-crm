import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (relative: string) => readFileSync(path.resolve(__dirname, "..", relative), "utf8");

describe("known Campaigns build gaps", () => {
  it("does not show an em dash when a template has no duration", () => {
    const picker = read("src/features/playbook/QuickCampaignDialog.tsx");
    const gallery = read("src/features/playbook/TemplatesSection.tsx");
    expect(picker).not.toMatch(/duration_days \?\? ["']—["']/);
    expect(gallery).not.toMatch(/duration_days \?\? ["']—["']/);
    expect(picker).toMatch(/duration_days != null/);
    expect(gallery).toMatch(/duration_days != null/);
  });

  it("offers friendly first-name and organization controls for subjects in every builder", () => {
    const editor = read("src/features/playbook/SequenceEditor.tsx");
    const wizard = read("src/features/playbook/CampaignWizard.tsx");

    expect(editor.match(/Add to subject/g)).toHaveLength(1);
    expect(wizard.match(/Add to subject/g)).toHaveLength(2);
    expect(editor).toMatch(/subject_template: insertAuthorToken[\s\S]*AUTHOR_TOKENS\.firstName/);
    expect(editor).toMatch(/subject_template: insertAuthorToken[\s\S]*AUTHOR_TOKENS\.organization/);
    expect(wizard).toMatch(/subject: insertAuthorToken[\s\S]*AUTHOR_TOKENS\.firstName/);
    expect(wizard).toMatch(/subject_template: insertAuthorToken[\s\S]*AUTHOR_TOKENS\.organization/);
  });

  it("sends reply follow-up bells to the contact, not the admin-only Campaigns tab", () => {
    const actions = read("supabase/functions/_shared/campaign-enrollment-actions.ts");
    expect(actions).toMatch(/\/contacts\/\$\{enrollment\.contact_id\}/);
    expect(actions).not.toMatch(/link = `\/playbook\?campaign=\$\{campaign\.id\}`/);
  });

  it("opens a campaign from the ?campaign= deep link and does not tell operators to start in Smartlead", () => {
    const tab = read("src/features/playbook/CampaignsTab.tsx");
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(tab).toMatch(/searchParams\.get\("campaign"\)/);
    expect(tab).toMatch(/setDetailOpen\(true\)/);
    expect(wizard).not.toMatch(/start in Smartlead later/i);
    expect(wizard).toMatch(/Press Start on the campaign card/);
  });

  it("marks the follow-up task complete when a reply is marked handled", () => {
    const edge = read("supabase/functions/playbook-smartlead/index.ts");
    expect(edge).toMatch(/action === "mark-reply-handled"/);
    expect(edge).toMatch(/enrollment_id/);
    expect(edge).toMatch(/completed_at: handledStamp\.at/);
    expect(edge).toMatch(/campaign_step_number/);
  });

  it("pauses the Smartlead lead before recording an automatic meeting pause in Pulse", () => {
    const edge = read("supabase/functions/playbook-smartlead/index.ts");
    const remotePause = edge.indexOf("await smartleadSetLeadPauseState(info.smartlead_campaign_id, leadId, true)");
    const pulsePause = edge.indexOf('.update({ status: "paused", paused_reason: "meeting_booked" })', remotePause);

    expect(remotePause).toBeGreaterThan(-1);
    expect(pulsePause).toBeGreaterThan(remotePause);
    expect(edge.slice(remotePause, pulsePause)).toContain("continue;");
  });

  it("keeps the chosen build method and campaign title when the unified builder autosaves or switches methods", () => {
    const wizard = read("src/features/playbook/CampaignWizard.tsx");
    expect(wizard).toMatch(/v: 1, mode, flow, step/);
    expect(wizard).toMatch(/setFlow\(s\.flow \?\?/);
    expect(wizard).toMatch(/campaign\?\.campaign_name \?\? templateName/);
    expect(wizard).toMatch(/requestedName \? \{ \.\.\.r\.campaign, campaign_name: requestedName \}/);
    expect(wizard).toMatch(/flow === "template" && editingSequence/);
    expect(wizard).toMatch(/builderProgress\(mode, step, hasLockedRecipients\)/);
    expect(wizard).toMatch(/\{step !== 1 && \(/);
  });

  it("refreshes visible enrollment details and card counts after Smartlead reconciliation", () => {
    const api = read("src/features/playbook/api.ts");
    expect(api).toMatch(/invalidateQueries\(\{ queryKey: \["playbook", "campaign-enrollments"\] \}\)/);
    expect(api).toMatch(/invalidateQueries\(\{ queryKey: \["playbook", "campaign-enrollment-stats"\] \}\)/);
  });
});
