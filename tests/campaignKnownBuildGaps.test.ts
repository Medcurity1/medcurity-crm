import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const read = (relative: string) => readFileSync(path.resolve(__dirname, "..", relative), "utf8");

describe("known Campaigns build gaps", () => {
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

  it("pauses the Smartlead lead before recording an automatic meeting pause in Pulse", () => {
    const edge = read("supabase/functions/playbook-smartlead/index.ts");
    const remotePause = edge.indexOf("await smartleadSetLeadPauseState(info.smartlead_campaign_id, leadId, true)");
    const pulsePause = edge.indexOf('.update({ status: "paused", paused_reason: "meeting_booked" })', remotePause);

    expect(remotePause).toBeGreaterThan(-1);
    expect(pulsePause).toBeGreaterThan(remotePause);
    expect(edge.slice(remotePause, pulsePause)).toContain("continue;");
  });
});
