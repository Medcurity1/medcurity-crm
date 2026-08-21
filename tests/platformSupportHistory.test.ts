import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { notificationTarget } from "../src/features/notifications/notification-target";

const supportApi = readFileSync("src/features/support/api.ts", "utf8");
const supportPage = readFileSync("src/features/support/SupportPage.tsx", "utf8");
const historyView = readFileSync("src/features/support/SupportHistoryView.tsx", "utf8");
const notificationToasts = readFileSync("src/hooks/useNotificationToasts.ts", "utf8");

describe("Platform support history", () => {
  it("is source-isolated to Platform support records", () => {
    const historyHook = supportApi.slice(
      supportApi.indexOf("export function useSupportHistory"),
      supportApi.indexOf("export type SupportStats"),
    );

    expect(historyHook).toContain('from("support_conversations")');
    expect(historyHook).not.toContain("meddy_conversations");
  });

  it("pages the durable archive instead of applying the live queue cap", () => {
    expect(supportApi).toContain("export const SUPPORT_HISTORY_PAGE_SIZE = 50");
    expect(supportApi).toContain(".range(from, from + SUPPORT_HISTORY_PAGE_SIZE - 1)");
    expect(historyView).toContain("Previous");
    expect(historyView).toContain("Next");
  });

  it("keeps ended conversations searchable outside the live recency window", () => {
    expect(supportApi).toContain('q = q.eq("status", "closed")');
    expect(historyView).toContain('{ key: "ended", label: "Ended" }');
    expect(historyView).toContain("useSupportMessages(conversation.id)");
  });

  it("exposes responsive loading, empty, and error states", () => {
    expect(historyView).toContain("isLoading");
    expect(historyView).toContain("No matching platform conversations");
    expect(historyView).toContain("Couldn't load platform conversation history.");
    expect(historyView).toContain("grid-cols-2");
    expect(historyView).toContain("sm:grid-cols-4");
    expect(historyView).toContain("overflow-x-auto");
  });

  it("keeps live conversations and durable history as explicit Platform tabs", () => {
    expect(supportPage).toContain('["conversations", "history"]');
    expect(supportPage).toContain('<SupportHistoryView />');
    expect(supportPage).toContain('next.delete("conversation")');
  });
});

describe("notification conversation targets", () => {
  it("routes Platform human requests to the exact support conversation", () => {
    expect(
      notificationTarget({
        type: "support_human_requested",
        conversation_id: "platform conversation/42",
        link: "/meddy?conversation=stale",
      }),
    ).toBe("/support?conversation=platform%20conversation%2F42");
  });

  it("keeps Website Meddy notifications isolated", () => {
    expect(
      notificationTarget({ type: "meddy_human_requested", conversation_id: "website-42" }),
    ).toBe("/meddy?conversation=website-42");
  });

  it("falls back to a stored link for unrelated notifications", () => {
    expect(notificationTarget({ type: "task_due", link: "/tasks?task=42" })).toBe(
      "/tasks?task=42",
    );
  });

  it("wires native notification clicks to the canonical target", () => {
    expect(notificationToasts).toContain("notification.onclick");
    expect(notificationToasts).toContain("window.focus()");
    expect(notificationToasts).toContain("window.location.assign(link)");
    expect(notificationToasts).toContain("const link = notificationTarget(n)");
  });
});
