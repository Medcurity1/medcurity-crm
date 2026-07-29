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
import type { NexusWidget, NexusWidgetType } from "./types";

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
 * Call from NexusPage with the loaded grid. No-op unless the landing flip
 * is on, the user is known, the grid has loaded, and the import has not
 * run in this browser yet.
 */
export function useHomeLayoutImport(widgets: NexusWidget[] | undefined) {
  const { user } = useAuth();
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
        const { error } = await supabase.from("nexus_widgets").insert({
          user_id: user.id,
          widget_type: type,
          name,
          position: position++,
          preview_count: 5,
          config: {},
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
