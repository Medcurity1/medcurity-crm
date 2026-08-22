import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const edge = readFileSync(
  path.resolve(__dirname, "../supabase/functions/playbook-smartlead/index.ts"),
  "utf8",
);

describe("Campaigns company rollout backend boundary", () => {
  it("allows the read actions the shared builder needs while retaining an explicit allowlist", () => {
    const allowlist = edge.slice(
      edge.indexOf("const REP_ELIGIBLE_ACTIONS"),
      edge.indexOf("let repUserId", edge.indexOf("const REP_ELIGIBLE_ACTIONS")),
    );
    for (const action of ["status", "email-accounts", "inbox-health", "launch", "add-recipients", "set-campaign-status", "set-enrollment-status"]) {
      expect(allowlist).toContain(`"${action}"`);
    }
    for (const adminOnly of ["sync", "refresh", "import", "daily-sweep", "delete-campaign", "update-email-account-signature", "update-email-account-daily-limit"] ) {
      expect(allowlist).not.toContain(`"${adminOnly}"`);
    }
  });

  it("projects a credential-free email-account DTO", () => {
    const dispatch = edge.slice(
      edge.indexOf('if (action === "email-accounts")'),
      edge.indexOf('if (action === "import")'),
    );
    expect(dispatch).toContain("extractEmailAccountRows");
    expect(dispatch).toContain("id: Number(account.id)");
    expect(dispatch).toContain("from_email:");
    expect(dispatch).toContain("from_name:");
    const runtime = dispatch.replace(/\/\/.*$/gm, "");
    expect(runtime).not.toMatch(/password|smtp_|imap_|signature|bcc/i);
    expect(dispatch).not.toContain("accounts as unknown[]");
  });

  it("forces every non-admin launch owner to the authenticated caller", () => {
    const launch = edge.slice(edge.indexOf("async function launch"), edge.indexOf("const delay", edge.indexOf("async function launch")));
    expect(launch).toContain("if (!callerCtx.isAdmin)");
    expect(launch).toContain("p.owner_id = callerCtx.userId");
    expect(launch).not.toContain("p.owner_id !== callerCtx.userId");
  });

  it("adds recipients through the same safety rails with explicit rollback evidence", () => {
    const add = edge.slice(
      edge.indexOf("async function addRecipientsToExistingCampaign"),
      edge.indexOf("async function spawnCampaignTasks"),
    );
    expect(add).toContain('campaign.status !== "active" && campaign.status !== "draft"');
    expect(add).toContain("campaign.owner_user_id !== callerCtx.userId");
    expect(add).toContain("fetchSuppressionForEmails");
    expect(add).toContain("partitionSuppressedEmails");
    expect(add).toContain("fetchActiveEnrollmentEmails");
    expect(add).toContain("campaign_launch_claim_emails");
    expect(add).toContain(`/campaigns/\${smartleadCampaignId}/leads`);
    expect(add).toContain('svc.rpc("campaign_enrollments_append"');
    expect(add).toContain("backfillFirstSendDates");
    expect(add).toContain("spawnCampaignTasks");
    expect(add).toContain("smartlead_rollback_failed");
    expect(add).toContain("local_rollback_failed");
    expect(add).toContain("campaign_launch_release_emails");
    expect(edge).toContain('action === "add-recipients"');
  });

  it("allocates add-recipient positions atomically through a service-role-only RPC", () => {
    const migration = readFileSync(
      path.resolve(__dirname, "../supabase/migrations/20260822004500_campaign_add_recipients_atomic.sql"),
      "utf8",
    );
    expect(migration).toContain("for update");
    expect(migration).toContain("with ordinality");
    expect(migration).toContain("revoke all on function public.campaign_enrollments_append(uuid, jsonb) from public, anon, authenticated");
    expect(migration).toContain("grant execute on function public.campaign_enrollments_append(uuid, jsonb) to service_role");
  });
});
