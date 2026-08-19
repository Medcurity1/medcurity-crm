import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { planTerminalEnrollmentReconcile } from "../supabase/functions/_shared/campaign-terminal-enrollments.ts";
import { formatSmartleadRefreshToast } from "../src/features/playbook/campaign-sync-copy";

describe("planTerminalEnrollmentReconcile", () => {
  it("closes every active enrollment when the parent is stopped and archives their tasks", () => {
    expect(planTerminalEnrollmentReconcile({
      parentStatus: "stopped",
      activeEnrollmentIds: ["a", "b"],
      pendingTaskEnrollmentIds: ["a"],
    })).toEqual({
      flipIds: ["a", "b"],
      archiveTaskIds: ["a", "b"],
      deferredIds: [],
    });
  });

  it("leaves completed-campaign enrollments with pending call/LinkedIn tasks active", () => {
    expect(planTerminalEnrollmentReconcile({
      parentStatus: "completed",
      activeEnrollmentIds: ["done", "still-due"],
      pendingTaskEnrollmentIds: ["still-due"],
    })).toEqual({
      flipIds: ["done"],
      archiveTaskIds: [],
      deferredIds: ["still-due"],
    });
  });

  it("does not touch active, paused, or draft parents", () => {
    for (const parentStatus of ["active", "paused", "draft"]) {
      expect(planTerminalEnrollmentReconcile({
        parentStatus,
        activeEnrollmentIds: ["x"],
        pendingTaskEnrollmentIds: ["x"],
      })).toEqual({ flipIds: [], archiveTaskIds: [], deferredIds: [] });
    }
  });
});

describe("formatSmartleadRefreshToast", () => {
  it("reports imported inventory and closed enrollments", () => {
    const r = formatSmartleadRefreshToast({
      created: 1,
      updated: 4,
      enrollments_updated: 2,
    });
    expect(r.warning).toBe(false);
    expect(r.message).toContain("Imported 1 new, refreshed 4.");
    expect(r.message).toContain("no longer blocked");
  });

  it("surfaces deferred tasks and unfinished sync honestly", () => {
    const r = formatSmartleadRefreshToast({
      synced: 12,
      capped: 3,
      enrollments_deferred: 1,
    });
    expect(r.warning).toBe(true);
    expect(r.message).toContain("call or LinkedIn task");
    expect(r.message).toContain("next sync");
  });
});

describe("interactive sync wires terminal enrollment reconcile", () => {
  it("calls the shared planner from playbook-smartlead sync", () => {
    const edge = readFileSync(
      path.resolve(__dirname, "../supabase/functions/playbook-smartlead/index.ts"),
      "utf8",
    );
    expect(edge).toMatch(/planTerminalEnrollmentReconcile/);
    expect(edge).toMatch(/reconcileTerminalEnrollments/);
    const syncAt = edge.indexOf("async function syncCampaigns");
    const reconcileAt = edge.indexOf("await reconcileTerminalEnrollments", syncAt);
    expect(syncAt).toBeGreaterThan(-1);
    expect(reconcileAt).toBeGreaterThan(syncAt);
  });
});
