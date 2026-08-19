// Nexus "Your Day" queue hooks (docket C2, phase 1).
//
// One round trip to the rep_day_queue RPC (SECURITY INVOKER, owner-scoped
// server-side) returns the ranked next-best-action rows. "Not today"
// writes a per-user snooze that hides the row until the next 4am Pacific,
// which is the queue's own day boundary (the RPC computes every date in
// America/Los_Angeles), and atomically counts that exact item.
//
// "Done" is deliberately not stored: finishing the underlying work (task
// completed, reply handled, deal opened) drops the row on the next fetch.
// Exact-item and category hides are durable prefs, restored from Tune
// your list.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  canHideCategory,
  categoryLabel,
  categoryOf,
  nextFourAmPacific,
  shouldAskToHide,
} from "./day-queue";

export { nextFourAmPacific };

// ── Row shape ────────────────────────────────────────────────────────

/**
 * Kinds the queue emits today. Typed as a union plus a string escape
 * hatch so a branch added server-side (the requests branch landed this
 * way) still type-checks and renders through the generic path.
 */
export type DayQueueKind =
  | "reply"
  | "outreach_paused"
  | "task"
  | "campaign_task"
  | "renewal"
  | "stale_deal"
  | "request"
  | (string & {});

/** One row of rep_day_queue (migration 20260729150000 + later branches). */
export interface DayQueueRow {
  item_key: string;
  kind: DayQueueKind;
  title: string | null;
  reason: string | null;
  urgency: number | null;
  amount: number | null;
  due_at: string | null;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  enrollment_id: string | null;
  task_id: string | null;
  campaign_id: string | null;
  event_id: string | null;
  /** Hide group. Requests are request:product / request:crm / request:collateral. */
  category?: string | null;
}

export interface DayQueueNotTodayResult {
  dismiss_count: number;
  ask_to_hide: boolean;
}

export interface HiddenDayItem {
  item_key: string;
  title: string | null;
  kind: string;
  category: string;
  hidden_at: string | null;
}

export interface DayQueuePrefs {
  hiddenCategories: string[];
  hiddenItems: HiddenDayItem[];
}

export const DAY_QUEUE_KEY = ["nexus", "day-queue"] as const;
export const DAY_QUEUE_PREFS_KEY = ["nexus", "day-queue-prefs"] as const;

/**
 * The signed-in user's ranked queue. Short staleTime plus refetch on
 * focus so coming back to the tab after working a row shows the row
 * gone, without polling.
 */
export function useDayQueue() {
  return useQuery({
    queryKey: DAY_QUEUE_KEY,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rep_day_queue", {
        p_limit: 100,
      });
      if (error) throw error;
      return (data ?? []) as DayQueueRow[];
    },
  });
}

export function useDayQueuePrefs(enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: DAY_QUEUE_PREFS_KEY,
    enabled: enabled && !!user?.id,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<DayQueuePrefs> => {
      const [cats, items] = await Promise.all([
        supabase
          .from("day_queue_hidden_categories")
          .select("category")
          .order("category"),
        supabase
          .from("day_queue_item_state")
          .select("item_key, title, kind, category, hidden_at")
          .not("hidden_at", "is", null)
          .order("hidden_at", { ascending: false }),
      ]);
      if (cats.error) throw cats.error;
      if (items.error) throw items.error;
      return {
        hiddenCategories: (cats.data ?? []).map((r) => r.category as string),
        hiddenItems: (items.data ?? []) as HiddenDayItem[],
      };
    },
  });
}

function parseNotTodayResult(data: unknown): DayQueueNotTodayResult {
  const row = Array.isArray(data) ? data[0] : data;
  const count = Number((row as { dismiss_count?: unknown } | null)?.dismiss_count ?? 0);
  const flagged = Boolean((row as { ask_to_hide?: unknown } | null)?.ask_to_hide);
  return {
    dismiss_count: count,
    ask_to_hide: flagged || shouldAskToHide(count),
  };
}

/**
 * Hide one queue row until tomorrow morning. Keyed on item_key, which is
 * deterministic per underlying thing, so the snooze sticks across
 * refetches and re-ranks. Counts this exact item atomically.
 */
export function useSnoozeDayItem() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (row: DayQueueRow): Promise<DayQueueNotTodayResult> => {
      if (!user?.id) throw new Error("Not signed in");
      const { data, error } = await supabase.rpc("day_queue_not_today", {
        p_item_key: row.item_key,
        p_kind: row.kind,
        p_category: categoryOf(row),
        p_title: row.title,
        p_until: nextFourAmPacific().toISOString(),
      });
      if (error) throw error;
      return parseNotTodayResult(data);
    },
    // Optimistic (docket C2 round 4, "briefing cycles instantly"): the row
    // disappears and the next-ranked item slides into the strip the moment
    // Not today is clicked, not a round-trip later. Rolled back on error.
    onMutate: async (row: DayQueueRow) => {
      await qc.cancelQueries({ queryKey: DAY_QUEUE_KEY });
      const previous = qc.getQueryData<DayQueueRow[]>(DAY_QUEUE_KEY);
      qc.setQueryData<DayQueueRow[]>(DAY_QUEUE_KEY, (rows) =>
        (rows ?? []).filter((r) => r.item_key !== row.item_key),
      );
      return { previous };
    },
    onSuccess: (result) => {
      if (!result.ask_to_hide) toast.success("Back tomorrow.");
    },
    onError: (e, _row, ctx) => {
      if (ctx?.previous) qc.setQueryData(DAY_QUEUE_KEY, ctx.previous);
      toast.error("Couldn't snooze that: " + (e as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DAY_QUEUE_KEY });
    },
  });
}

export function useHideDayItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: DayQueueRow) => {
      const { error } = await supabase.rpc("day_queue_hide_item", {
        p_item_key: row.item_key,
        p_kind: row.kind,
        p_category: categoryOf(row),
        p_title: row.title,
      });
      if (error) throw error;
    },
    onMutate: async (row: DayQueueRow) => {
      await qc.cancelQueries({ queryKey: DAY_QUEUE_KEY });
      const previous = qc.getQueryData<DayQueueRow[]>(DAY_QUEUE_KEY);
      qc.setQueryData<DayQueueRow[]>(DAY_QUEUE_KEY, (rows) =>
        (rows ?? []).filter((r) => r.item_key !== row.item_key),
      );
      return { previous };
    },
    onSuccess: () => {
      toast.success("Hidden from Your Day.");
    },
    onError: (e, _row, ctx) => {
      if (ctx?.previous) qc.setQueryData(DAY_QUEUE_KEY, ctx.previous);
      toast.error("Couldn't hide that: " + (e as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DAY_QUEUE_KEY });
      qc.invalidateQueries({ queryKey: DAY_QUEUE_PREFS_KEY });
    },
  });
}

export function useHideDayCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (category: string) => {
      if (!canHideCategory(category)) {
        throw new Error("Task reminders stay on your list");
      }
      const { error } = await supabase.rpc("day_queue_hide_category", {
        p_category: category,
      });
      if (error) throw error;
      return category;
    },
    onMutate: async (category: string) => {
      await qc.cancelQueries({ queryKey: DAY_QUEUE_KEY });
      const previous = qc.getQueryData<DayQueueRow[]>(DAY_QUEUE_KEY);
      qc.setQueryData<DayQueueRow[]>(DAY_QUEUE_KEY, (rows) =>
        (rows ?? []).filter((r) => categoryOf(r) !== category),
      );
      return { previous };
    },
    onSuccess: (category) => {
      toast.success(`${categoryLabel(category)} hidden from Your Day.`);
    },
    onError: (e, _category, ctx) => {
      if (ctx?.previous) qc.setQueryData(DAY_QUEUE_KEY, ctx.previous);
      toast.error("Couldn't hide that: " + (e as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DAY_QUEUE_KEY });
      qc.invalidateQueries({ queryKey: DAY_QUEUE_PREFS_KEY });
    },
  });
}

export function useUnhideDayItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemKey: string) => {
      const { error } = await supabase.rpc("day_queue_unhide_item", {
        p_item_key: itemKey,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Back on your list.");
    },
    onError: (e) => {
      toast.error("Couldn't restore that: " + (e as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DAY_QUEUE_KEY });
      qc.invalidateQueries({ queryKey: DAY_QUEUE_PREFS_KEY });
    },
  });
}

export function useSetDayCategoryHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      category,
      hidden,
    }: {
      category: string;
      hidden: boolean;
    }) => {
      if (hidden && !canHideCategory(category)) {
        throw new Error("Task reminders stay on your list");
      }
      const { error } = hidden
        ? await supabase.rpc("day_queue_hide_category", { p_category: category })
        : await supabase.rpc("day_queue_unhide_category", { p_category: category });
      if (error) throw error;
      return { category, hidden };
    },
    onMutate: async ({ category, hidden }) => {
      await qc.cancelQueries({ queryKey: DAY_QUEUE_PREFS_KEY });
      const previous = qc.getQueryData<DayQueuePrefs>(DAY_QUEUE_PREFS_KEY);
      qc.setQueryData<DayQueuePrefs>(DAY_QUEUE_PREFS_KEY, (prefs) => {
        const current = prefs ?? { hiddenCategories: [], hiddenItems: [] };
        const next = hidden
          ? Array.from(new Set([...current.hiddenCategories, category]))
          : current.hiddenCategories.filter((c) => c !== category);
        return { ...current, hiddenCategories: next };
      });
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(DAY_QUEUE_PREFS_KEY, ctx.previous);
      toast.error("Couldn't update that: " + (e as Error).message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DAY_QUEUE_KEY });
      qc.invalidateQueries({ queryKey: DAY_QUEUE_PREFS_KEY });
    },
  });
}
