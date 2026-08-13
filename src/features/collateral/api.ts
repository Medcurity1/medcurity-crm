// Collateral data hooks (Jordan's v1.1 spec, 2026-08-11).
//
// Pulse is a VIEWER of the SharePoint Sales Collateral library: items
// arrive only via the collateral-sync edge fn (Status = Current, verbatim
// columns) and the tab exposes no create/edit/delete path (§3). The only
// client writes left: the admin pin toggle, per-user default segments,
// and Copy Link usage breadcrumbs. Visibility stays a CONFIG value
// (collateral_settings.visible_to_roles), enforced by RLS.

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
  stage: string | null;
  status: string | null;
  last_reviewed: string | null;
  owner_name: string | null;
  web_url: string;
  sharepoint_item_id: string | null;
  pinned: boolean;
  sort_order: number;
  archived_at: string | null;
  synced_at: string | null;
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
          "id, title, asset_type, products, segments, uses, stage, status, last_reviewed, owner_name, web_url, sharepoint_item_id, pinned, sort_order, archived_at, synced_at",
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
// v1.1 §3: NO create/edit/archive path exists. Pinning is Pulse-side
// display curation (a flag on our mirror row), not a library write.

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

/** Kick the SharePoint sync (a READ-side refresh: §3). Fail-soft: an
 * unconfigured sync says so instead of erroring (the Azure app
 * registration is a human step that may not have happened yet). */
export function useSyncCollateral() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("collateral-sync", {
        body: {},
      });
      if (error) throw error;
      return data as {
        ok: boolean;
        configured: boolean;
        synced?: number;
        removed?: number;
        skippedNotCurrent?: number;
        message?: string;
      };
    },
    onSuccess: (res) => {
      if (!res?.configured) {
        toast.info(
          res?.message ??
            "SharePoint sync isn't connected yet. The Graph app registration is pending.",
        );
        return;
      }
      qc.invalidateQueries({ queryKey: ITEMS_KEY });
      const parts = [`${res.synced ?? 0} Current asset${(res.synced ?? 0) === 1 ? "" : "s"}`];
      if (res.removed) parts.push(`${res.removed} removed`);
      toast.success(`Library synced: ${parts.join(" · ")}`);
    },
    onError: (e) => toast.error("Sync failed: " + (e as Error).message),
  });
}
