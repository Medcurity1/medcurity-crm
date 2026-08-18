import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  activityBodyForDisplay,
  activityTitleForDisplay,
  isCampaignReplyTask,
} from "../src/features/activities/activity-display";

describe("activity presentation", () => {
  it("turns a legacy campaign reply task into an action", () => {
    expect(activityTitleForDisplay(
      "Reply from nathang@medcurity.com — PROD QA — 4-Day Smartlead Rendering — 2026-08-18",
    )).toBe("Follow up with nathang@medcurity.com");
    expect(activityTitleForDisplay("Follow up with nathang@medcurity.com"))
      .toBe("Follow up with nathang@medcurity.com");
    expect(isCampaignReplyTask({ activity_type: "task", subject: "Reply from nathang@medcurity.com — QA" })).toBe(true);
    expect(isCampaignReplyTask({ activity_type: "task", subject: "Normal task", campaign_enrollment_id: "enrollment" })).toBe(false);
  });

  it("shows only the useful new reply instead of provider HTML", () => {
    const raw = '<html><head><style>p{margin:0}</style></head><body><div>QA stop test&nbsp;</div><div id="divRplyFwdMsg">From: Summer</div></body></html>';
    expect(activityBodyForDisplay(raw)).toBe("QA stop test");
    expect(activityBodyForDisplay("Call back tomorrow.")).toBe("Call back tomorrow.");
  });

  it("keeps completion available on Nexus and the full task page", () => {
    const root = path.resolve(__dirname, "..");
    const nexus = readFileSync(path.join(root, "src/features/nexus/Briefing.tsx"), "utf8");
    const tasksWidget = readFileSync(path.join(root, "src/features/nexus/widgets/TasksWidget.tsx"), "utf8");
    const activitiesList = readFileSync(path.join(root, "src/features/activities/ActivitiesListPage.tsx"), "utf8");
    const detail = readFileSync(path.join(root, "src/features/activities/ActivityDetail.tsx"), "utf8");
    expect(nexus).toContain("<CheckCircle2");
    expect(nexus).toContain("> Done");
    expect(tasksWidget).toContain("activityTitleForDisplay(task.subject)");
    expect(activitiesList).toContain("activityTitleForDisplay(a.subject)");
    expect(detail).toContain('"Mark complete"');
  });
});
