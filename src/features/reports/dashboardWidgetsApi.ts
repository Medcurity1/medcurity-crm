/**
 * Server-backed manual widgets (Most Recent Quote, QTD Billing actual,
 * Dev project line items). Mirrors the `DashboardWidgets` shape from
 * `dashboardWidgets.ts` but persists in a single jsonb row of
 * `public.dashboard_widgets` so the laptop and the TV see the same
 * data.
 *
 * Same cache pattern as milestones: localStorage stays as the
 * synchronous read path; the DB is source of truth and gets re-pulled
 * every 30s. See migration 20260513000001_dashboard_goals_and_widgets.sql.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  DEFAULT_WIDGETS,
  WIDGETS_LS_KEY,
  type DashboardWidgets,
} from "./dashboardWidgets";

const QUERY_KEY = ["dashboard-widgets"] as const;
const SINGLETON_KEY = "singleton";

async function fetchWidgets(): Promise<DashboardWidgets> {
  const { data, error } = await supabase
    .from("dashboard_widgets")
    .select("data")
    .eq("key", SINGLETON_KEY)
    .maybeSingle();
  if (error) throw error;
  const raw = (data?.data ?? {}) as Partial<DashboardWidgets>;
  return {
    ...DEFAULT_WIDGETS,
    ...raw,
    dev_items: Array.isArray(raw?.dev_items) ? raw.dev_items : [],
  };
}

async function persistWidgets(w: DashboardWidgets): Promise<void> {
  const { error } = await supabase
    .from("dashboard_widgets")
    .upsert(
      { key: SINGLETON_KEY, data: w as unknown as object },
      { onConflict: "key" },
    );
  if (error) throw error;
}

function writeLocal(w: DashboardWidgets) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WIDGETS_LS_KEY, JSON.stringify(w));
  } catch {
    /* ignore */
  }
}

export function useWidgetsQuery() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const remote = await fetchWidgets();
      writeLocal(remote);
      return remote;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useUpsertWidgets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (w: DashboardWidgets) => persistWidgets(w),
    onMutate: async (w) => {
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev = qc.getQueryData<DashboardWidgets>(QUERY_KEY);
      qc.setQueryData(QUERY_KEY, w);
      writeLocal(w);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(QUERY_KEY, ctx.prev);
        writeLocal(ctx.prev);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
