/**
 * Server-backed goal + lock store. Mirrors the localStorage payloads
 * `dashboard_goals_by_quarter_v1` and `dashboard_goals_lock_by_quarter_v1`
 * from `dashboardGoalsByQuarter.ts` so the laptop and the TV (different
 * browsers, same domain) see the same per-quarter goals.
 *
 * Local-cache rationale: localStorage stays as the synchronous read
 * path for `getQuarterGoals()` / `isQuarterLocked()` — keeps the
 * existing readers cheap and avoids touching all the call sites.
 * The DB is the source of truth; the TV pulls from DB on mount and
 * again whenever the query invalidates. See migration
 * 20260513000001_dashboard_goals_and_widgets.sql.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  STORE_KEY,
  LOCK_STORE_KEY,
  type QuarterGoals,
} from "./dashboardGoalsByQuarter";

/** Per-quarter raw goal payload (same shape as localStorage). */
export type GoalsStore = Record<string, Partial<QuarterGoals>>;
export type LockStore = Record<string, boolean>;

const GOALS_QUERY_KEY = ["dashboard-goals-store"] as const;
const LOCKS_QUERY_KEY = ["dashboard-locks-store"] as const;
const GOALS_ROW_KEY = "goals_by_quarter";
const LOCKS_ROW_KEY = "locks_by_quarter";

// ---------------------------------------------------------------------
// Fetch / persist
// ---------------------------------------------------------------------

async function fetchKv(key: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("dashboard_goals")
    .select("data")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  const raw = (data?.data ?? {}) as unknown;
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

async function persistKv(
  key: string,
  data: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("dashboard_goals")
    .upsert(
      { key, data: data as unknown as object },
      { onConflict: "key" },
    );
  if (error) throw error;
}

// ---------------------------------------------------------------------
// localStorage mirror (so the existing sync getters keep working)
// ---------------------------------------------------------------------

function writeLocalGoals(store: GoalsStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded — ignore, DB is still source of truth */
  }
}

function writeLocalLocks(store: LockStore) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCK_STORE_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

function readLocalGoals(): GoalsStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readLocalLocks(): LockStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCK_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------

/**
 * Pulls the goals row from the DB and mirrors it into localStorage so
 * synchronous readers (`getQuarterGoals`) see fresh data. Returns the
 * parsed store. Cold-start: if DB is empty but localStorage has data,
 * the caller is expected to push the local payload up (one-shot
 * migration, handled in `useDashboardServerSync`).
 */
export function useGoalsStoreQuery() {
  return useQuery({
    queryKey: GOALS_QUERY_KEY,
    queryFn: async () => {
      const remote = (await fetchKv(GOALS_ROW_KEY)) as GoalsStore;
      writeLocalGoals(remote);
      return remote;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useLocksStoreQuery() {
  return useQuery({
    queryKey: LOCKS_QUERY_KEY,
    queryFn: async () => {
      const remote = (await fetchKv(LOCKS_ROW_KEY)) as LockStore;
      writeLocalLocks(remote);
      return remote;
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useUpsertGoalsStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (store: GoalsStore) => persistKv(GOALS_ROW_KEY, store),
    onMutate: async (store) => {
      await qc.cancelQueries({ queryKey: GOALS_QUERY_KEY });
      const prev = qc.getQueryData<GoalsStore>(GOALS_QUERY_KEY);
      qc.setQueryData(GOALS_QUERY_KEY, store);
      // Keep localStorage in sync immediately so other readers in the
      // same tab (the admin page calls `getQuarterGoals` synchronously)
      // see the new value without waiting on the round-trip.
      writeLocalGoals(store);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(GOALS_QUERY_KEY, ctx.prev);
        writeLocalGoals(ctx.prev);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: GOALS_QUERY_KEY }),
  });
}

export function useUpsertLocksStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (store: LockStore) => persistKv(LOCKS_ROW_KEY, store),
    onMutate: async (store) => {
      await qc.cancelQueries({ queryKey: LOCKS_QUERY_KEY });
      const prev = qc.getQueryData<LockStore>(LOCKS_QUERY_KEY);
      qc.setQueryData(LOCKS_QUERY_KEY, store);
      writeLocalLocks(store);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(LOCKS_QUERY_KEY, ctx.prev);
        writeLocalLocks(ctx.prev);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: LOCKS_QUERY_KEY }),
  });
}

// ---------------------------------------------------------------------
// Cold-start migration helpers (run once on first hydrate)
// ---------------------------------------------------------------------

export function localGoalsSnapshot(): GoalsStore {
  return readLocalGoals();
}

export function localLocksSnapshot(): LockStore {
  return readLocalLocks();
}
