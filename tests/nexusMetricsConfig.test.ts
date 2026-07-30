// Metrics widget config reader (docket C2 round 4): one Metrics widget now
// holds an ordered LIST of stats. The pre-list shape stored a single stat at
// the top level of the jsonb config and those rows still exist, so the
// legacy path is pinned here: it must keep resolving to exactly one stat,
// with the same metric, scope, period and comparison it was saved with.
// See src/features/nexus/metrics.ts.

import { describe, it, expect } from "vitest";
import {
  normalizeMetricsConfig,
  nextMetricStat,
  describeStat,
  DEFAULT_METRIC_KEY,
} from "@/features/nexus/metrics";
import { MAX_METRIC_STATS } from "@/features/nexus/types";

describe("normalizeMetricsConfig", () => {
  it("reads a legacy single-stat config as a one-stat list, unchanged", () => {
    const legacy = {
      metric: "calls_made",
      scope: "team",
      period: "month",
      compare: true,
    };
    expect(normalizeMetricsConfig(legacy)).toEqual({
      stats: [
        { metric: "calls_made", scope: "team", period: "month", compare: true },
      ],
    });
  });

  it("keeps the list shape and its order", () => {
    const cfg = {
      stats: [
        { metric: "deals_closed", scope: "personal", period: "quarter", compare: false },
        { metric: "calls_made", scope: "team", period: "today", compare: true },
      ],
    };
    expect(normalizeMetricsConfig(cfg).stats.map((s) => s.metric)).toEqual([
      "deals_closed",
      "calls_made",
    ]);
  });

  it("falls back to one default stat for an empty or missing config", () => {
    for (const raw of [null, undefined, {}]) {
      expect(normalizeMetricsConfig(raw)).toEqual({
        stats: [
          {
            metric: DEFAULT_METRIC_KEY,
            scope: "personal",
            period: "week",
            compare: false,
          },
        ],
      });
    }
  });

  it("keeps an explicitly empty stat list empty", () => {
    expect(normalizeMetricsConfig({ stats: [] })).toEqual({ stats: [] });
  });

  it("defaults junk scope/period values but keeps the metric key", () => {
    const cfg = { stats: [{ metric: "calls_made", scope: "nope", period: "decade" }] };
    expect(normalizeMetricsConfig(cfg).stats[0]).toEqual({
      metric: "calls_made",
      scope: "personal",
      period: "week",
      compare: false,
    });
  });

  it("keeps an unknown metric key rather than silently swapping it", () => {
    // The widget says the metric is gone and the builder asks for a
    // replacement; quietly showing a different number would be worse.
    const cfg = { stats: [{ metric: "retired_metric", scope: "team", period: "week" }] };
    expect(normalizeMetricsConfig(cfg).stats[0].metric).toBe("retired_metric");
  });

  it("drops entries that are not stats at all", () => {
    const cfg = { stats: [null, "calls_made", { scope: "team" }, { metric: "calls_made" }] };
    expect(normalizeMetricsConfig(cfg).stats).toHaveLength(1);
  });

  it("caps the list at MAX_METRIC_STATS", () => {
    const cfg = {
      stats: Array.from({ length: MAX_METRIC_STATS + 5 }, () => ({
        metric: "calls_made",
      })),
    };
    expect(normalizeMetricsConfig(cfg).stats).toHaveLength(MAX_METRIC_STATS);
  });

  it("is idempotent (normalizing its own output changes nothing)", () => {
    const once = normalizeMetricsConfig({ metric: "emails_sent", compare: true });
    expect(normalizeMetricsConfig(once)).toEqual(once);
  });
});

describe("nextMetricStat", () => {
  it("picks a metric not already on the widget", () => {
    const existing = normalizeMetricsConfig(null).stats;
    const next = nextMetricStat(existing);
    expect(existing.some((s) => s.metric === next.metric)).toBe(false);
  });

  it("inherits how the previous stat is read", () => {
    const next = nextMetricStat([
      { metric: "calls_made", scope: "team", period: "month", compare: true },
    ]);
    expect(next.scope).toBe("team");
    expect(next.period).toBe("month");
    expect(next.compare).toBe(true);
  });

  it("has sane defaults for the first stat on an empty widget", () => {
    const next = nextMetricStat([]);
    expect(next.scope).toBe("personal");
    expect(next.period).toBe("week");
    expect(next.compare).toBe(false);
  });
});

describe("describeStat", () => {
  it("summarizes period, scope and comparison", () => {
    const summary = describeStat({
      metric: "calls_made",
      scope: "team",
      period: "week",
      compare: true,
    });
    expect(summary).toBe("This week · Team-wide · vs previous");
  });

  it("uses the metric's fixed-window note when it has no period", () => {
    const summary = describeStat({
      metric: "tasks_overdue",
      scope: "personal",
      period: "week",
      compare: false,
    });
    expect(summary).toBe("Open tasks past their due date · Personal");
  });

  it("asks for a replacement when the metric is gone", () => {
    const summary = describeStat({
      // Deliberately not a registry key — the stored-config escape hatch.
      metric: "retired_metric" as never,
      scope: "personal",
      period: "week",
      compare: false,
    });
    expect(summary).toBe("Pick a replacement metric");
  });
});
