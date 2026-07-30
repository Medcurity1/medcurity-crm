// Nexus metric registry, with a hard focus on the ten KPIs ported over
// from Home's kpi-registry (docket C2 round 4). The landing-page swap is
// only safe if a ported metric shows the SAME number Home shows, so the
// things that could silently change a number are pinned here:
//
//  - fixed-scope metrics must stay fixed-scope. A new stat defaults to
//    scope "personal", so flipping supportsScope on a company-wide metric
//    (renewals, Active Customers, Total Contacts, MQL, SQL) would quietly
//    show a smaller number than Home does.
//  - fixed-window metrics must keep a periodNote, because that note is the
//    only thing the tile and the builder show in place of a period picker.
//  - the renewal-queue window math is pure, so it is tested directly.
//
// See src/features/nexus/metrics.ts.

import { describe, it, expect } from "vitest";
import {
  NEXUS_METRICS,
  METRIC_GROUPS,
  getMetricDef,
  countRenewalsDueWithin,
  sumRenewalQueueArr,
  type RenewalQueueRow,
} from "@/features/nexus/metrics";

const PORTED_FROM_HOME = [
  "win_rate",
  "renewals_due_30",
  "renewals_due_60",
  "arr_at_risk",
  "renewals_in_progress",
  "active_customers",
  "total_contacts",
  "revenue_starting_quarter",
  "mql_count",
  "sql_count",
] as const;

/** Company-wide on Home, so they must not offer a personal/team toggle. */
const COMPANY_WIDE = [
  "renewals_due_30",
  "renewals_due_60",
  "arr_at_risk",
  "active_customers",
  "total_contacts",
  "mql_count",
  "sql_count",
] as const;

/** "My ..." on Home, so personal (the default scope) reproduces Home. */
const PERSONAL_BY_DEFAULT = [
  "win_rate",
  "renewals_in_progress",
  "revenue_starting_quarter",
] as const;

describe("ported Home KPIs", () => {
  it("all ten are in the registry", () => {
    for (const key of PORTED_FROM_HOME) {
      expect(getMetricDef(key), key).toBeDefined();
    }
  });

  it("keeps the company-wide ones fixed-scope", () => {
    for (const key of COMPANY_WIDE) {
      expect(getMetricDef(key)!.supportsScope, key).toBe(false);
    }
  });

  it("lets the personal ones default to Home's owner-filtered number", () => {
    for (const key of PERSONAL_BY_DEFAULT) {
      // supportsScope true + the "personal" default = Home's own number;
      // team scope is the extra, opt-in variant.
      expect(getMetricDef(key)!.supportsScope, key).toBe(true);
    }
  });

  it("has a fixed window and no period picker on every ported metric", () => {
    // None of the ten is a per-period number on Home: they are all
    // all-time, current-state, or a window the metric names itself.
    for (const key of PORTED_FROM_HOME) {
      const def = getMetricDef(key)!;
      expect(def.supportsPeriod, key).toBe(false);
      expect(def.periodNote, key).toBeTruthy();
    }
  });

  it("does not offer a comparison whose label would name the wrong window", () => {
    // The tile labels a comparison from the stat's stored period, which is
    // meaningless for a fixed-window metric ("vs last week" under a
    // quarter number), so comparison stays off for all ten.
    for (const key of PORTED_FROM_HOME) {
      expect(getMetricDef(key)!.supportsCompare, key).toBe(false);
    }
  });
});

describe("registry invariants", () => {
  it("has unique keys and labels", () => {
    const keys = NEXUS_METRICS.map((m) => m.key);
    const labels = NEXUS_METRICS.map((m) => m.label);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("puts every metric in a group the picker renders", () => {
    for (const m of NEXUS_METRICS) {
      expect(METRIC_GROUPS, m.key).toContain(m.group);
    }
  });

  it("gives every group at least one metric", () => {
    for (const group of METRIC_GROUPS) {
      expect(NEXUS_METRICS.some((m) => m.group === group), group).toBe(true);
    }
  });

  it("explains the window whenever there is no period picker", () => {
    for (const m of NEXUS_METRICS.filter((x) => !x.supportsPeriod)) {
      expect(m.periodNote, m.key).toBeTruthy();
    }
  });

  it("keeps every string free of em dashes", () => {
    for (const m of NEXUS_METRICS) {
      expect(m.label.includes("—"), m.key).toBe(false);
      expect((m.periodNote ?? "").includes("—"), m.key).toBe(false);
    }
  });
});

describe("renewal queue window math", () => {
  const rows: RenewalQueueRow[] = [
    { days_until_renewal: -5, current_arr: 1000 }, // past due
    { days_until_renewal: 0, current_arr: 2000 }, // due today
    { days_until_renewal: 30, current_arr: 3000 }, // last day of the 30 window
    { days_until_renewal: 31, current_arr: 4000 },
    { days_until_renewal: 60, current_arr: 5000 }, // last day of the 60 window
    { days_until_renewal: 61, current_arr: 6000 },
    { days_until_renewal: null, current_arr: 7000 }, // no contract end date
  ];

  it("counts today through day N inclusive", () => {
    expect(countRenewalsDueWithin(rows, 30)).toBe(2);
    expect(countRenewalsDueWithin(rows, 60)).toBe(4);
  });

  it("excludes past-due rows, matching the renewals page preset", () => {
    // The -5 row would push the count above what /renewals shows.
    expect(countRenewalsDueWithin([{ days_until_renewal: -1, current_arr: 1 }], 30)).toBe(0);
  });

  it("ignores rows with no days_until_renewal", () => {
    expect(countRenewalsDueWithin([{ days_until_renewal: null, current_arr: 1 }], 60)).toBe(0);
  });

  it("sums ARR across the whole queue, not just the 30/60 subsets", () => {
    expect(sumRenewalQueueArr(rows)).toBe(28000);
  });

  it("treats a null ARR as zero rather than NaN", () => {
    expect(
      sumRenewalQueueArr([
        { days_until_renewal: 10, current_arr: null },
        { days_until_renewal: 10, current_arr: 500 },
      ]),
    ).toBe(500);
  });

  it("is zero for an empty queue", () => {
    expect(countRenewalsDueWithin([], 30)).toBe(0);
    expect(sumRenewalQueueArr([])).toBe(0);
  });
});
