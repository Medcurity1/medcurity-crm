// React Query read + merge-upsert for user_list_column_prefs. Cloned from the
// canonical per-user jsonb-prefs pattern in notifications/prefs-api.ts
// (read-merge-upsert + a serialized mutation scope to avoid lost updates).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { toast } from "sonner";

export interface ColumnConfig {
  /** Deny-list of column keys the user has hidden for this list. */
  hidden?: string[];
  /** Reserved for a future reorder feature; unused in v1. */
  order?: string[];
}

export function useListColumnPrefs(listKey: string) {
  const { user } = useAuth();
  return useQuery<ColumnConfig>({
    queryKey: ["list-column-prefs", listKey, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_list_column_prefs")
        .select("config")
        .eq("user_id", user!.id)
        .eq("list_key", listKey)
        .maybeSingle();
      if (error) throw error;
      return (data?.config ?? {}) as ColumnConfig;
    },
  });
}

export function useUpdateListColumnPrefs(listKey: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    // Serialize writes for this list so a quick second toggle never reads the
    // row before the first upsert commits (lost-update fix, per prefs-api.ts).
    scope: { id: `list-column-prefs:${listKey}` },
    mutationFn: async (patch: ColumnConfig) => {
      const { data: existing, error: readErr } = await supabase
        .from("user_list_column_prefs")
        .select("config")
        .eq("user_id", user!.id)
        .eq("list_key", listKey)
        .maybeSingle();
      if (readErr) throw readErr;
      const merged = { ...((existing?.config ?? {}) as ColumnConfig), ...patch };
      const { error } = await supabase
        .from("user_list_column_prefs")
        .upsert(
          { user_id: user!.id, list_key: listKey, config: merged },
          { onConflict: "user_id,list_key" },
        );
      if (error) throw error;
      return merged;
    },
    onSuccess: (merged) => {
      qc.setQueryData(["list-column-prefs", listKey, user?.id], merged);
    },
    onError: (err) => toast.error((err as Error).message),
  });
}
