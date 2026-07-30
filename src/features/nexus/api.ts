// Nexus persistence hooks — nexus_widgets / nexus_default_widgets rows +
// the nexus_initialize / nexus_reset_to_default RPCs. UI lands in Stage B.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import type {
  NexusWidget,
  NexusDefaultWidget,
  NexusWidgetType,
  NexusWidgetColor,
  NexusWidgetConfig,
  PreviewCount,
} from "./types";
import {
  MAX_FEATURED,
  notePinned,
  noteUnpinned,
  pickOldestFeatured,
  readFeaturedOrder,
} from "./featured";

// ── Input shapes ─────────────────────────────────────────────────────
export interface NexusWidgetInput {
  widget_type: NexusWidgetType;
  name: string;
  position: number;
  color?: NexusWidgetColor | null;
  icon?: string | null;
  preview_count?: PreviewCount;
  config?: NexusWidgetConfig;
  /** Pinned above the divider. Defaults to false server-side. */
  featured?: boolean;
}

export interface ReorderItem {
  id: string;
  position: number;
}

// ── Report filter option sources ─────────────────────────────────────

/**
 * Distinct accounts.account_type values actually present (with counts) —
 * powers the exact-match "Account Type" / contact "Org Type" report
 * filters. Data-driven (not the picklist) because live SF-imported rows
 * carry values like CHC / FQHC / PCA that were never picklist options.
 */
export function useAccountTypesInUse() {
  return useQuery({
    queryKey: ["account_types_in_use"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_account_types_in_use");
      if (error) throw error;
      return (data ?? []) as { account_type: string; n: number }[];
    },
  });
}

/**
 * Distinct non-null accounts.timezone values actually present — powers the
 * exact-match "Time Zone" report filter (contacts + accounts). Data-driven,
 * NOT the app's UsTimeZone constant list, because accounts.timezone holds
 * free-text SF-imported strings ("US/Eastern", "Central- (CDT)", …) that the
 * enum values would never match. One round trip via the
 * list_timezones_in_use RPC (migration 20260710172000) — server-side
 * DISTINCT, same pattern as list_account_types_in_use / list_states_in_use.
 *
 * `opts.enabled` lets the panel skip the fetch for entities without a
 * timezone filter (opportunities / imports).
 */
export function useTimezonesInUse(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["nexus_timezones_in_use"],
    staleTime: 5 * 60 * 1000,
    enabled: opts?.enabled ?? true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_timezones_in_use");
      if (error) throw error;
      const rows = (data ?? []) as { timezone: string; n: number }[];
      return rows
        .map((r) => r.timezone)
        .sort((a, b) => a.localeCompare(b));
    },
  });
}

// ── User widgets ─────────────────────────────────────────────────────

/**
 * The widget rows for a user's Nexus page, ordered by position.
 * Defaults to the signed-in user; admins pass a target userId to view /
 * configure someone else's page (RLS admin policy allows).
 * `opts.enabled=false` skips the fetch (the grid's default-layout mode).
 */
export function useNexusWidgets(userId?: string, opts?: { enabled?: boolean }) {
  const { user } = useAuth();
  const uid = userId ?? user?.id;
  return useQuery({
    queryKey: ["nexus-widgets", uid],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nexus_widgets")
        .select("*")
        .eq("user_id", uid!)
        .order("position", { ascending: true });
      if (error) throw error;
      // `featured` (migration 20260729200000) comes back with the rest of
      // the row. Coerced here so a row written before the column existed,
      // or a response from a stale PostgREST schema cache, still reads as
      // a plain false rather than undefined.
      return (data ?? []).map((w) => ({
        ...w,
        featured: w.featured === true,
      })) as NexusWidget[];
    },
    enabled: !!uid && (opts?.enabled ?? true),
  });
}

/** Add a widget (to your own page, or — as admin — to `userId`'s). */
export function useAddWidget() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: NexusWidgetInput & { userId?: string }) => {
      const { userId, ...widget } = input;
      const uid = userId ?? user?.id;
      if (!uid) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("nexus_widgets")
        .insert({ ...widget, user_id: uid, config: widget.config ?? {} })
        .select()
        .single();
      if (error) throw error;
      return data as NexusWidget;
    },
    // Scope to the target user's grid so admin edits don't churn the
    // admin's own homepage cache.
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: ["nexus-widgets", data.user_id] }),
    onError: (e) => toast.error("Couldn't add widget: " + (e as Error).message),
  });
}

/** Update a widget's settings (name, color, config, preview count, …). */
export function useUpdateWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NexusWidgetInput> }) => {
      const { data, error } = await supabase
        .from("nexus_widgets")
        .update(patch)
        .eq("id", id)
        .select("user_id")
        .single();
      if (error) throw error;
      return data as { user_id: string };
    },
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: ["nexus-widgets", data.user_id] }),
    onError: (e) => toast.error("Couldn't save widget: " + (e as Error).message),
  });
}

export function useRemoveWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("nexus_widgets")
        .delete()
        .eq("id", id)
        .select("user_id")
        .single();
      if (error) throw error;
      return data as { user_id: string };
    },
    onSuccess: (data) =>
      qc.invalidateQueries({ queryKey: ["nexus-widgets", data.user_id] }),
    onError: (e) => toast.error("Couldn't remove widget: " + (e as Error).message),
  });
}

/**
 * Pin a widget above the "Your widgets" divider, or unpin it.
 *
 * The two-pin cap lives here rather than in the database (see the
 * migration's note): pinning a third widget is allowed and quietly unpins
 * whichever pin has been up the longest, so the control never rejects a
 * click. Which one that is comes from featured.ts.
 *
 * Returns the name of the widget that lost its slot, if any, so the caller
 * can say so out loud.
 */
export function usePinWidget() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      id,
      featured,
      userId,
    }: {
      id: string;
      featured: boolean;
      /** Page owner; defaults to the signed-in user (admin editor passes it). */
      userId?: string;
    }) => {
      const uid = userId ?? user?.id;
      if (!uid) throw new Error("Not signed in");

      const list = qc.getQueryData<NexusWidget[]>(["nexus-widgets", uid]) ?? [];
      let unpinnedName: string | null = null;

      if (featured) {
        // Make room first, so the page never shows three pins mid-flight.
        const others = list.filter((w) => w.featured && w.id !== id);
        const order = readFeaturedOrder(uid);
        const evicted: NexusWidget[] = [];
        const pool = [...others];
        while (pool.length >= MAX_FEATURED) {
          const oldest = pickOldestFeatured(pool, order);
          if (!oldest) break;
          evicted.push(oldest);
          pool.splice(pool.indexOf(oldest), 1);
        }
        if (evicted.length) {
          const { error } = await supabase
            .from("nexus_widgets")
            .update({ featured: false })
            .in(
              "id",
              evicted.map((w) => w.id),
            );
          if (error) throw error;
          for (const w of evicted) noteUnpinned(uid, w.id);
          unpinnedName = evicted[0].name;
        }
      }

      const { error } = await supabase
        .from("nexus_widgets")
        .update({ featured })
        .eq("id", id);
      if (error) throw error;

      if (featured) notePinned(uid, id);
      else noteUnpinned(uid, id);

      return { userId: uid, featured, unpinnedName };
    },
    onSuccess: (result) =>
      qc.invalidateQueries({ queryKey: ["nexus-widgets", result.userId] }),
    onError: (e) =>
      toast.error("Couldn't change the pin: " + (e as Error).message),
  });
}

/**
 * Persist a drag-reorder atomically via the nexus_reorder_widgets RPC —
 * a single UPDATE server-side, so a partial failure can't leave position
 * collisions (the old Promise.all-of-row-updates could). `userId` is the
 * page owner, used to scope the cache invalidation.
 */
export function useReorderWidgets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ items }: { items: ReorderItem[]; userId?: string }) => {
      const { error } = await supabase.rpc("nexus_reorder_widgets", {
        p_updates: items,
      });
      if (error) throw error;
    },
    onSuccess: (_data, { userId }) =>
      qc.invalidateQueries({ queryKey: ["nexus-widgets", userId] }),
    onError: (e) => toast.error("Couldn't save the new order: " + (e as Error).message),
  });
}

// ── First-visit initialization ───────────────────────────────────────

/**
 * Seeds the signed-in user's Nexus page from the system defaults on
 * first visit (plus a Requests widget if they have pending requests).
 * Server-side idempotent (nexus_user_state marker) and cached for the
 * session here (staleTime: Infinity), so it effectively runs once.
 */
export function useNexusInitialize() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user?.id;
  return useQuery({
    queryKey: ["nexus-initialize", uid],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("nexus_initialize");
      if (error) throw error;
      const result = data as { initialized: boolean; widgets?: number };
      // If we just seeded, make sure the grid refetches with the new rows.
      if (result?.initialized) {
        qc.invalidateQueries({ queryKey: ["nexus-widgets", uid] });
      }
      return result;
    },
    enabled: !!uid,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}

// ── System default layout (admin) ────────────────────────────────────

export function useDefaultWidgets(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["nexus-default-widgets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nexus_default_widgets")
        .select("*")
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((w) => ({
        ...w,
        featured: w.featured === true,
      })) as NexusDefaultWidget[];
    },
    enabled: opts?.enabled ?? true,
  });
}

export function useAddDefaultWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: NexusWidgetInput) => {
      const { data, error } = await supabase
        .from("nexus_default_widgets")
        .insert({ ...input, config: input.config ?? {} })
        .select()
        .single();
      if (error) throw error;
      return data as NexusDefaultWidget;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus-default-widgets"] }),
    onError: (e) => toast.error("Couldn't add default widget: " + (e as Error).message),
  });
}

export function useUpdateDefaultWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<NexusWidgetInput> }) => {
      const { error } = await supabase
        .from("nexus_default_widgets")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus-default-widgets"] }),
    onError: (e) => toast.error("Couldn't save default widget: " + (e as Error).message),
  });
}

export function useRemoveDefaultWidget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("nexus_default_widgets").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus-default-widgets"] }),
    onError: (e) => toast.error("Couldn't remove default widget: " + (e as Error).message),
  });
}

/** Atomic reorder for the system default layout (admin-only RPC). */
export function useReorderDefaultWidgets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: ReorderItem[]) => {
      const { error } = await supabase.rpc("nexus_reorder_default_widgets", {
        p_updates: items,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["nexus-default-widgets"] }),
    onError: (e) => toast.error("Couldn't save the new order: " + (e as Error).message),
  });
}

/** Admin: wipe a user's page and re-copy the current system defaults. */
export function useResetUserNexus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.rpc("nexus_reset_to_default", {
        p_user: userId,
      });
      if (error) throw error;
      return data as { reset: boolean; widgets: number };
    },
    onSuccess: (_data, userId) => {
      qc.invalidateQueries({ queryKey: ["nexus-widgets", userId] });
      qc.invalidateQueries({ queryKey: ["nexus-user-state", userId] });
      toast.success("Nexus page reset to the default layout.");
    },
    onError: (e) => toast.error("Reset failed: " + (e as Error).message),
  });
}

/**
 * Whether a user's Nexus page has ever been initialized (nexus_user_state
 * marker). The admin per-user editor uses this to offer "Initialize now"
 * instead of editing an unseeded page — adding widgets BEFORE the marker
 * exists would get double-seeded on the user's first visit.
 */
export function useNexusUserState(userId?: string) {
  return useQuery({
    queryKey: ["nexus-user-state", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nexus_user_state")
        .select("user_id, initialized_at")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return { initialized: !!data, initialized_at: data?.initialized_at ?? null };
    },
    enabled: !!userId,
  });
}

/** Admin: initialize ANOTHER user's Nexus page (seed from defaults). The
 * RPC is idempotent — a no-op if the user already initialized. */
export function useInitializeUserNexus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.rpc("nexus_initialize", {
        p_user: userId,
      });
      if (error) throw error;
      return data as { initialized: boolean; widgets?: number };
    },
    onSuccess: (data, userId) => {
      qc.invalidateQueries({ queryKey: ["nexus-widgets", userId] });
      qc.invalidateQueries({ queryKey: ["nexus-user-state", userId] });
      toast.success(
        data?.initialized
          ? "Nexus page initialized from the default layout."
          : "Already initialized, nothing to do.",
      );
    },
    onError: (e) =>
      toast.error("Couldn't initialize: " + (e as Error).message),
  });
}
