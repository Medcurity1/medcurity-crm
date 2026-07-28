import { describe, it, expect } from "vitest";
import { campaignAttentionFlags, type AttentionCampaign } from "@/features/playbook/needs-attention";

// ---------------------------------------------------------------------------
// "Needs you today" flag rules (outside-review I27) — the logic that decides
// which campaigns surface at the top of the tracker and why. Pure module,
// same testing convention as suppression.ts / suggestion-apply.ts.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-28T18:00:00Z").getTime();
const daysAgoIso = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

function base(over: Partial<AttentionCampaign> = {}): AttentionCampaign {
  return {
    status: "active",
    anchor_date: daysAgoIso(10).slice(0, 10),
    created_at: daysAgoIso(10),
    // Production shape: Smartlead-synced metrics are STRINGS (see
    // buildSmartleadMetrics) — the helper must coerce.
    metrics: { sent: "100", bounces: "0" },
    settings: { last_metrics_sync_at: daysAgoIso(0.5) },
    ...over,
  };
}

describe("campaignAttentionFlags", () => {
  it("a healthy active campaign raises nothing", () => {
    expect(campaignAttentionFlags(base(), { unhandledReplies: 0, nowMs: NOW })).toEqual([]);
  });

  it("unhandled replies flag red, singular/plural correct", () => {
    const one = campaignAttentionFlags(base(), { unhandledReplies: 1, nowMs: NOW });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ kind: "replies", severity: "red", label: "1 reply waiting" });
    const three = campaignAttentionFlags(base(), { unhandledReplies: 3, nowMs: NOW });
    expect(three[0].label).toBe("3 replies waiting");
  });

  it("high bounce rate flags red only with a real sample", () => {
    const hot = campaignAttentionFlags(base({ metrics: { sent: "100", bounces: "8" } }), { unhandledReplies: 0, nowMs: NOW });
    expect(hot[0]).toMatchObject({ kind: "high_bounce", severity: "red" });
    expect(hot[0].label).toContain("8%");
    // Below the 20-send sample floor: never flags, even at 50% bounce.
    const tiny = campaignAttentionFlags(base({ metrics: { sent: "10", bounces: "5" } }), { unhandledReplies: 0, nowMs: NOW });
    expect(tiny).toEqual([]);
    // Plain numbers (pre-sync or hand-written metrics) coerce identically.
    const numeric = campaignAttentionFlags(base({ metrics: { sent: 100, bounces: 8 } }), { unhandledReplies: 0, nowMs: NOW });
    expect(numeric[0]).toMatchObject({ kind: "high_bounce" });
  });

  it("active for days with zero sends flags amber; a fresh launch doesn't", () => {
    const stalled = campaignAttentionFlags(
      base({ metrics: { sent: "0" }, anchor_date: daysAgoIso(4).slice(0, 10), settings: {} }),
      { unhandledReplies: 0, nowMs: NOW },
    );
    expect(stalled[0]).toMatchObject({ kind: "nothing_sent", severity: "amber" });
    const fresh = campaignAttentionFlags(
      base({ metrics: { sent: "0" }, anchor_date: daysAgoIso(1).slice(0, 10), settings: {} }),
      { unhandledReplies: 0, nowMs: NOW },
    );
    expect(fresh).toEqual([]);
  });

  it("a draft is flagged only once it's a week old", () => {
    const old = campaignAttentionFlags(
      base({ status: "draft", created_at: daysAgoIso(9), metrics: null, settings: {} }),
      { unhandledReplies: 0, nowMs: NOW },
    );
    expect(old[0]).toMatchObject({ kind: "stale_draft", severity: "amber" });
    expect(old[0].label).toBe("Draft for 9 days");
    const young = campaignAttentionFlags(
      base({ status: "draft", created_at: daysAgoIso(2), metrics: null, settings: {} }),
      { unhandledReplies: 0, nowMs: NOW },
    );
    expect(young).toEqual([]);
  });

  it("stale numbers flag only when a sync HAS happened before", () => {
    const stale = campaignAttentionFlags(
      base({ settings: { last_metrics_sync_at: daysAgoIso(3) } }),
      { unhandledReplies: 0, nowMs: NOW },
    );
    expect(stale[0]).toMatchObject({ kind: "stale_numbers", severity: "amber" });
    // Never-synced (no last_metrics_sync_at at all) stays quiet on this signal.
    const never = campaignAttentionFlags(base({ settings: {} }), { unhandledReplies: 0, nowMs: NOW });
    expect(never).toEqual([]);
  });

  it("red flags sort before amber regardless of rule order", () => {
    const flags = campaignAttentionFlags(
      base({ metrics: { sent: "0" }, anchor_date: daysAgoIso(5).slice(0, 10), settings: { last_metrics_sync_at: daysAgoIso(3) } }),
      { unhandledReplies: 2, nowMs: NOW },
    );
    expect(flags.map((f) => f.severity)).toEqual(["red", "amber", "amber"]);
    expect(flags[0].kind).toBe("replies");
  });

  it("junk metrics values never crash, never flag, and never read as zero sends", () => {
    const junk = campaignAttentionFlags(
      base({ metrics: { sent: "lots", bounces: -3 } as unknown as AttentionCampaign["metrics"], settings: {} }),
      { unhandledReplies: 0, nowMs: NOW },
    );
    expect(junk).toEqual([]);
  });

  it("missing metrics on a days-old active campaign DOES flag nothing-sent", () => {
    const noMetrics = campaignAttentionFlags(
      base({ metrics: null, anchor_date: daysAgoIso(5).slice(0, 10), settings: {} }),
      { unhandledReplies: 0, nowMs: NOW },
    );
    expect(noMetrics[0]).toMatchObject({ kind: "nothing_sent", severity: "amber" });
  });

  it("stopped/completed campaigns only ever flag replies", () => {
    const done = campaignAttentionFlags(
      base({ status: "completed", metrics: { sent: "100", bounces: "50" }, settings: { last_metrics_sync_at: daysAgoIso(5) } }),
      { unhandledReplies: 1, nowMs: NOW },
    );
    expect(done).toHaveLength(1);
    expect(done[0].kind).toBe("replies");
  });
});
