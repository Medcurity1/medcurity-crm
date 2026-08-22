import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (...parts: string[]) =>
  readFileSync(path.resolve(__dirname, "..", ...parts), "utf8");

describe("company-wide Campaigns launch", () => {
  it("opens navigation and direct route to every authenticated Pulse role", () => {
    const app = read("src", "App.tsx");
    const sidebar = read("src", "components", "layout", "Sidebar.tsx");
    expect(app).toContain('<Route path="playbook" element={<PlaybookPage />} />');
    expect(app).not.toContain('<Route path="playbook" element={<AdminGate>');
    expect(sidebar).toContain('{ to: "/playbook", icon: Megaphone, label: "Campaigns", badge: { label: "New", className: NEW_BADGE } }');
    expect(sidebar.match(/to: "\/playbook"/g)).toHaveLength(1);
  });

  it("opens contact, selection, saved-list, and report-builder launch paths", () => {
    const contacts = read("src", "features", "contacts", "ContactsList.tsx");
    const detail = read("src", "features", "contacts", "ContactDetail.tsx");
    const lists = read("src", "features", "lead-lists", "ListsPage.tsx");
    const reports = read("src", "features", "reports", "ReportBuilder.tsx");
    expect(contacts).toContain("Start a campaign…");
    expect(contacts).toContain("Add to a campaign…");
    expect(contacts).toContain("addCampaignForIds");
    expect(contacts).toContain("fetchCampaignContactsByIds");
    expect(detail).toContain("Start a Campaign");
    expect(detail).toContain("Add to Campaign");
    expect(lists).toContain("startWholeListCampaign");
    expect(lists).toContain("fetchRecipientsByList(list)");
    expect(reports).toContain("startCampaignFromResults");
    for (const source of [contacts, detail, lists, reports]) {
      expect(source).not.toMatch(/isAdmin\s*&&\s*\([^)]*Start (?:a )?[Cc]ampaign/s);
    }
  });

  it("keeps administrative Smartlead controls away from non-admin screens", () => {
    const page = read("src", "features", "playbook", "PlaybookPage.tsx");
    const tab = read("src", "features", "playbook", "CampaignsTab.tsx");
    expect(page).toContain("{isAdmin &&");
    expect(tab).toContain("{isAdmin && <button");
    expect(tab).toContain("adminActions={isAdmin}");
  });

  it("gives every user the same sender picker while defaults fail closed", () => {
    const wizard = read("src", "features", "playbook", "CampaignWizard.tsx");
    const defaults = read("src", "features", "playbook", "sender-default.ts");
    expect(wizard).toContain("defaultSenderForUser(user?.email, inboxes)");
    expect(wizard).toContain("onValueChange={setInboxId}");
    expect(defaults).toContain("return null;");
    expect(defaults).not.toContain("accounts[0]");
  });

  it("keeps each non-admin campaign owner bound to the authenticated caller", () => {
    const edge = read("supabase", "functions", "playbook-smartlead", "index.ts");
    expect(edge).toContain("p.owner_id = callerCtx.userId");
    expect(edge).toContain('"status",');
    expect(edge).toContain('"email-accounts",');
    expect(edge).toContain('"inbox-health",');
  });

  it("lets campaign owners read all enrollments and only their own drafts", () => {
    const migration = read("supabase", "migrations", "20260822003000_campaign_company_access_rls.sql");
    expect(migration).toContain("campaign_drafts_self");
    expect(migration).toContain("user_id = (select auth.uid())");
    expect(migration).toContain("campaign_enrollments_read_campaign_owner");
    expect(migration).toContain("c.owner_user_id = (select auth.uid())");
  });
});
