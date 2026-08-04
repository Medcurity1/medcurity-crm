// Collateral data hooks (Jordan's 2026-08-04 spec).
//
// Items live in collateral_items — filled by admins by hand and/or the
// collateral-sync edge fn mirroring the SharePoint library. Visibility is
// a CONFIG value (collateral_settings.visible_to_roles), enforced by RLS
// and read here so record tabs and the sidebar can show/hide without a
// deploy when the flag opens to sales.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

export interface CollateralItem {
  id: string;
  title: string;
  asset_type: string | null;
  products: string[];
  segments: string[];
  uses: string[];
  web_url: string;
  sharepoint_item_id: string | null;
  pinned: boolean;
  sort_order: number;
  source: "manual" | "sync";
  archived_at: string | null;
  synced_at: string | null;
}

export interface CollateralItemInput {
  title: string;
  asset_type: string | null;
  products: string[];
  segments: string[];
  uses: string[];
  web_url: string;
  pinned: boolean;
}

const ITEMS_KEY = ["collateral", "items"] as const;

export function useCollateralItems() {
  return useQuery({
    queryKey: ITEMS_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collateral_items")
        .select(
          "id, title, asset_type, products, segments, uses, web_url, sharepoint_item_id, pinned, sort_order, source, archived_at, synced_at",
        )
        .is("archived_at", null)
        .order("pinned", { ascending: false })
        .order("sort_order")
        .order("title");
      if (error) throw error;
      return (data ?? []) as CollateralItem[];
    },
  });
}

/** Role flag: which roles can see collateral at all. Readable by everyone
 * signed in so tabs know whether to render; RLS enforces the real gate. */
export function useCollateralVisibility() {
  const { profile } = useAuth();
  const role = (profile as { role?: string } | null)?.role ?? null;
  const query = useQuery({
    queryKey: ["collateral", "settings"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collateral_settings")
        .select("visible_to_roles")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return (data?.visible_to_roles ?? []) as string[];
    },
  });
  return {
    ...query,
    visible: !!role && (query.data ?? []).includes(role),
  };
}

export function useMyCollateralPrefs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["collateral", "prefs", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collateral_user_prefs")
        .select("default_segments")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.default_segments ?? []) as string[];
    },
  });
}

export function useSaveMyCollateralPrefs() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (segments: string[]) => {
      const { error } = await supabase.from("collateral_user_prefs").upsert({
        user_id: user!.id,
        default_segments: segments,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collateral", "prefs"] });
      toast.success("Saved as your default view");
    },
    onError: (e) => toast.error("Couldn't save your default: " + (e as Error).message),
  });
}

/** Item 10: fire-and-forget usage breadcrumb per Copy Link click. */
export function useLogCopyEvent() {
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (itemId: string) => {
      if (!user?.id) return;
      await supabase
        .from("collateral_copy_events")
        .insert({ item_id: itemId, user_id: user.id });
    },
  });
}

// ── Admin mutations ──────────────────────────────────────────────────

export function useSaveCollateralItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CollateralItemInput & { id?: string }) => {
      const { id, ...fields } = input;
      if (id) {
        const { error } = await supabase
          .from("collateral_items")
          .update(fields)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("collateral_items")
          .insert({ ...fields, source: "manual" });
        if (error) throw error;
      }
    },
    onSuccess: (_r, input) => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
      toast.success(input.id ? "Asset updated" : "Asset added");
    },
    onError: (e) => toast.error("Couldn't save: " + (e as Error).message),
  });
}

export function useTogglePinned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase
        .from("collateral_items")
        .update({ pinned })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_r, { pinned }) => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
      toast.success(pinned ? "Pinned to the top row" : "Unpinned");
    },
    onError: (e) => toast.error("Couldn't update pin: " + (e as Error).message),
  });
}

export function useArchiveCollateralItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("collateral_items")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
      toast.success("Asset archived");
    },
    onError: (e) => toast.error("Couldn't archive: " + (e as Error).message),
  });
}

/** Kick the SharePoint sync. Fail-soft: an unconfigured sync says so
 * instead of erroring (the fn ships before the Graph app registration). */
export function useSyncCollateral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("collateral-sync", {
        body: {},
      });
      if (error) throw error;
      return data as { ok: boolean; configured: boolean; synced?: number; archived?: number; message?: string };
    },
    onSuccess: (res) => {
      if (!res?.configured) {
        toast.info(
          res?.message ??
            "SharePoint sync isn't connected yet. Assets can be added manually meanwhile.",
        );
        return;
      }
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
      toast.success(`Synced ${res.synced ?? 0} assets from SharePoint`);
    },
    onError: (e) => toast.error("Sync failed: " + (e as Error).message),
  });
}
