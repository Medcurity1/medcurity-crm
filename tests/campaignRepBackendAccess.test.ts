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
    for (const action of ["status", "email-accounts", "inbox-health", "launch", "set-campaign-status", "set-enrollment-status"]) {
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
});
