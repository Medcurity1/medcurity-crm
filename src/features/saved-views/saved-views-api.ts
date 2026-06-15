// Saved views (#15) — per-user named snapshots of a list's filter/search/
// sort state, stored as the URL query params under a name. Generic across
// the main entity lists; RLS scopes every row to the current user.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

export type SavedViewEntity = "accounts" | "contacts" | "opportunities" | "leads";

export interface SavedView {
  id: string;
  user_id: string;
  entity: SavedViewEntity;
  name: string;
  params: Record<string, string>;
  created_at: string;
}

export function useSavedViews(entity: SavedViewEntity) {
  const { user } = useAuth();
  return useQuery<SavedView[]>({
    queryKey: ["saved-views", entity, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_views")
        .select("*")
        .eq("entity", entity)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SavedView[];
    },
  });
}

export function useSaveView(entity: SavedViewEntity) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ name, params }: { name: string; params: Record<string, string> }) => {
      const { data, error } = await supabase
        .from("saved_views")
        .insert({ user_id: user!.id, entity, name: name.trim(), params })
        .select("*")
        .single();
      if (error) throw error;
      return data as SavedView;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-views", entity] });
      toast.success("View saved");
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useDeleteSavedView(entity: SavedViewEntity) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_views").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved-views", entity] });
      toast.success("View deleted");
    },
    onError: (err) => toast.error((err as Error).message),
  });
}
