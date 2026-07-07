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

// ── Input shapes ─────────────────────────────────────────────────────
export interface NexusWidgetInput {
  widget_type: NexusWidgetType;
  name: string;
  position: number;
  color?: NexusWidgetColor | null;
  icon?: string | null;
  preview_count?: PreviewCount;
  config?: NexusWidgetConfig;
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
      return data as NexusWidget[];
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
      return data as NexusDefaultWidget[];
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
          : "Already initialized — nothing to do.",
      );
    },
    onError: (e) =>
      toast.error("Couldn't initialize: " + (e as Error).message),
  });
}
