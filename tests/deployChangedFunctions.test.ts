import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CI_MANAGED_FUNCTIONS,
  deployArgs,
  planDeployments,
  selectFunctions,
} from "../scripts/ci/deploy-changed-functions.mjs";

describe("changed Edge Function deployment plan", () => {
  it("deploys nothing for frontend-only changes", () => {
    expect(selectFunctions(["src/App.tsx", "tests/app.test.ts"])).toEqual([]);
  });

  it("deploys only the changed managed function", () => {
    expect(selectFunctions(["supabase/functions/task-reminders/index.ts"])).toEqual(["task-reminders"]);
  });

  it("deploys every managed function when shared code changes", () => {
    expect(selectFunctions(["supabase/functions/_shared/graph-token.ts"])).toEqual(
      CI_MANAGED_FUNCTIONS.map(([name]) => name),
    );
  });

  it("preserves JWT verification exceptions", () => {
    expect(deployArgs("campaign-webhooks")).toContain("--no-verify-jwt");
    expect(deployArgs("sync-emails")).not.toContain("--no-verify-jwt");
  });

  it("deploys all when a safe base cannot be established", () => {
    expect(planDeployments({ files: [], safe: false })).toHaveLength(CI_MANAGED_FUNCTIONS.length);
  });

  it("does not deploy deliberately manual-only functions", () => {
    expect(selectFunctions(["supabase/functions/pandadoc-sync/index.ts"])).toEqual([]);
    expect(CI_MANAGED_FUNCTIONS.map(([name]) => name)).not.toContain("crm-mcp");
    expect(CI_MANAGED_FUNCTIONS.map(([name]) => name)).not.toContain("clickup-services-sync");
  });

  it("gives both workflows enough git history to compute the push diff", () => {
    const root = path.resolve(__dirname, "..");
    for (const workflow of [
      "azure-static-web-apps-white-flower-0f9685910.yml",
      "azure-static-web-apps-ambitious-grass-0ad59c510.yml",
    ]) {
      const source = readFileSync(path.join(root, ".github", "workflows", workflow), "utf8");
      expect(source).toContain("fetch-depth: 0");
      expect(source).toContain("node scripts/ci/deploy-changed-functions.mjs");
      expect(source).toContain("github.event.pull_request.base.sha");
      expect(source).toContain("github.event.pull_request.head.sha");
    }
  });
});
