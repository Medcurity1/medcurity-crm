/**
 * Server-backed milestone storage. Mirrors the `Milestone` shape from
 * `dashboardMilestones.ts` but reads/writes a single jsonb row in
 * `public.dashboard_milestones` so the laptop and the TV (different
 * browsers, same domain) see the same list.
 *
 * Local-cache rationale: localStorage is still written on every change
 * for instant repaints on the laptop. The DB is the source of truth;
 * the TV pulls from DB on mount and again whenever the query
 * invalidates. See migration 20260512000001_dashboard_milestones.sql.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Milestone } from "./dashboardMilestones";

const QUERY_KEY = ["dashboard-milestones"] as const;
const SINGLETON_KEY = "singleton";

async function fetchMilestones(): Promise<Milestone[]> {
  const { data, error } = await supabase
    .from("dashboard_milestones")
    .select("items")
    .eq("key", SINGLETON_KEY)
    .maybeSingle();
  if (error) throw error;
  const items = (data?.items ?? []) as unknown;
  return Array.isArray(items) ? (items as Milestone[]) : [];
}

async function persistMilestones(items: Milestone[]): Promise<void> {
  const { error } = await supabase
    .from("dashboard_milestones")
    .upsert(
      { key: SINGLETON_KEY, items: items as unknown as object },
      { onConflict: "key" },
    );
  if (error) throw error;
}

export function useMilestonesQuery() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchMilestones,
    // TV view sits open for hours — re-pull periodically so edits made
    // on the laptop appear without a hard refresh. 30s is enough for
    // dashboard cadence and cheap (one row, jsonb).
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useUpsertMilestones() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: Milestone[]) => persistMilestones(items),
    onMutate: async (items) => {
      // Optimistic update so other consumers of the query (anything
      // useMilestonesQuery() in the same tab) see the new list
      // immediately.
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev = qc.getQueryData<Milestone[]>(QUERY_KEY);
      qc.setQueryData(QUERY_KEY, items);
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(QUERY_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}
