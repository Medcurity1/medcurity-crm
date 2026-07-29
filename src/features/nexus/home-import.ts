// Home layout carry-over (docket C2, Phase 2, DORMANT until swap day).
//
// Home stores its widget visibility in localStorage ("dashboard_config",
// per browser). At the landing flip, each user's enabled Home widgets get
// their Nexus twin added to nexus_widgets IF the grid does not already
// have one of that type, so the below-the-briefing area barely changes
// for anyone (Nathan: "turning off Home at the end does essentially
// nothing"). Runs once per user per browser; a marker key prevents
// repeats, and it is NOT set when any insert fails so a retry happens on
// the next visit.
//
// Deliberately unmapped Home pieces (documented in the transition guide):
// upcoming_renewals lives on the Renewals tab, saved_report is rebuilt as
// a Custom Report widget by the user, recent_activity is covered by the
// Recents widget plus the Activities tab.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { NEXUS_IS_LANDING } from "./landing-flip";
import { DEFAULT_KPIS } from "@/features/dashboard/kpi-registry";
import type { NexusWidget, NexusWidgetType, MetricsStatConfig } from "./types";

/** Home dashboard_config key → Nexus widget twin (name, type). */
const HOME_TO_NEXUS: Partial<Record<string, { type: NexusWidgetType; name: string }>> = {
  kpis: { type: "metrics", name: "Metrics" },
  tasks: { type: "tasks", name: "Today's Tasks" },
  open_opps: { type: "pipeline", name: "Current Pipeline" },
  pipeline_summary: { type: "pipeline", name: "Current Pipeline" },
  recent_records: { type: "recents", name: "Recents" },
  recent_activity: { type: "recents", name: "Recents" },
  team_activity_feed: { type: "wins", name: "Recent Wins" },
  my_accounts: { type: "pinned_records", name: "Pinned Records" },
  cold_call: { type: "cold_call", name: "Cold Call List" },
};

const markerKey = (userId: string) => `nexus_home_import_done:${userId}`;

/**
 * Home KPI id → Nexus metric stat. The carried-over Metrics twin should
 * mirror the user's ACTUAL Home KPI band (their crm_kpi_config picks, or
 * their role default), not an empty widget. List-type and imports-era KPIs
 * are deliberately absent (upcoming_close lives in the Pipeline widget;
 * total_leads / new_leads_month / pending imports die with Home per the
 * round-4 metrics audit).
 */
const HOME_KPI_TO_STAT: Record<string, MetricsStatConfig> = {
  my_open_pipeline: { metric: "pipeline_value", scope: "personal", period: "month", compare: false },
  my_deals_in_progress: { metric: "open_opportunities", scope: "personal", period: "month", compare: false },
  closed_won_quarter: { metric: "revenue_closed", scope: "personal", period: "quarter", compare: true },
  revenue_starting_quarter: { metric: "revenue_starting_quarter", scope: "team", period: "quarter", compare: false },
  calls_this_week: { metric: "calls_made", scope: "personal", period: "week", compare: true },
  my_win_rate: { metric: "win_rate", scope: "personal", period: "quarter", compare: false },
  my_avg_deal_size: { metric: "avg_deal_size", scope: "personal", period: "quarter", compare: false },
  renewals_30: { metric: "renewals_due_30", scope: "team", period: "month", compare: false },
  renewals_60: { metric: "renewals_due_60", scope: "team", period: "month", compare: false },
  arr_at_risk: { metric: "arr_at_risk", scope: "team", period: "month", compare: false },
  my_renewals: { metric: "renewals_in_progress", scope: "personal", period: "month", compare: false },
  team_pipeline: { metric: "pipeline_value", scope: "team", period: "month", compare: false },
  active_accounts: { metric: "active_customers", scope: "team", period: "month", compare: false },
  total_contacts: { metric: "total_contacts", scope: "team", period: "month", compare: false },
  team_closed_month: { metric: "revenue_closed", scope: "team", period: "month", compare: true },
  mql_count: { metric: "mql_count", scope: "team", period: "month", compare: true },
  sql_count: { metric: "sql_count", scope: "team", period: "month", compare: true },
};

/** The user's Home KPI band (their picks, else their role default) as
 *  Nexus metric stats, mapped and deduped in order. */
function homeKpiStats(role: string | null | undefined): MetricsStatConfig[] {
  let ids: string[] = [];
  try {
    const stored = JSON.parse(localStorage.getItem("crm_kpi_config") ?? "null");
    if (Array.isArray(stored) && stored.length) ids = stored as string[];
  } catch { /* fall through to defaults */ }
  if (!ids.length) {
    ids = (DEFAULT_KPIS as Record<string, string[]>)[role ?? ""] ?? DEFAULT_KPIS.sales;
  }
  const seen = new Set<string>();
  const stats: MetricsStatConfig[] = [];
  for (const id of ids) {
    const stat = HOME_KPI_TO_STAT[id];
    if (!stat) continue;
    const key = `${stat.metric}:${stat.scope}:${stat.period}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stats.push(stat);
  }
  return stats;
}

/**
 * Call from NexusPage with the loaded grid. No-op unless the landing flip
 * is on, the user is known, the grid has loaded, and the import has not
 * run in this browser yet.
 */
export function useHomeLayoutImport(widgets: NexusWidget[] | undefined) {
  const { user, profile } = useAuth();
  const profileRole = (profile as { role?: string } | null)?.role ?? null;
  const qc = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (!NEXUS_IS_LANDING || !user?.id || !widgets || ran.current) return;
    if (localStorage.getItem(markerKey(user.id))) return;
    ran.current = true;

    (async () => {
      let homeConfig: Record<string, boolean> = {};
      try {
        homeConfig = JSON.parse(localStorage.getItem("dashboard_config") ?? "{}");
      } catch {
        // Unreadable config: nothing to import; mark done so this never loops.
        localStorage.setItem(markerKey(user.id), new Date().toISOString());
        return;
      }

      const have = new Set(widgets.map((w) => w.widget_type));
      const wanted = new Map<NexusWidgetType, string>();
      for (const [homeKey, twin] of Object.entries(HOME_TO_NEXUS)) {
        if (homeConfig[homeKey] && twin && !have.has(twin.type) && !wanted.has(twin.type)) {
          wanted.set(twin.type, twin.name);
        }
      }
      if (wanted.size === 0) {
        localStorage.setItem(markerKey(user.id), new Date().toISOString());
        return;
      }

      let position = widgets.reduce((m, w) => Math.max(m, w.position), -1) + 1;
      let allOk = true;
      for (const [type, name] of wanted) {
        // The Metrics twin carries the user's real Home KPI band over
        // (their picks or role default) so day one looks like Home did.
        const config =
          type === "metrics" ? { stats: homeKpiStats(profileRole) } : {};
        const { error } = await supabase.from("nexus_widgets").insert({
          user_id: user.id,
          widget_type: type,
          name,
          position: position++,
          preview_count: 5,
          config,
        });
        if (error) {
          console.error("home-import: could not add", type, error.message);
          allOk = false;
        }
      }
      if (allOk) localStorage.setItem(markerKey(user.id), new Date().toISOString());
      qc.invalidateQueries({ queryKey: ["nexus-widgets"] });
    })();
  }, [user?.id, widgets, qc]);
}
