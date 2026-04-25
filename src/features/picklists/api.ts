import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export interface PicklistOption {
  id: string;
  field_key: string;
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Fetch all picklist options grouped by field_key. Cached for the whole
 * session — picklists rarely change and every form needs them.
 */
export function usePicklistOptions() {
  return useQuery({
    queryKey: ["picklist_options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picklist_options")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      const byField = new Map<string, PicklistOption[]>();
      for (const opt of (data ?? []) as PicklistOption[]) {
        const list = byField.get(opt.field_key) ?? [];
        list.push(opt);
        byField.set(opt.field_key, list);
      }
      return byField;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Convenience: get the active options for a single field. */
export function usePicklistOptionsFor(fieldKey: string): {
  options: PicklistOption[];
  isLoading: boolean;
} {
  const q = usePicklistOptions();
  const all = q.data?.get(fieldKey) ?? [];
  return {
    options: all.filter((o) => o.is_active),
    isLoading: q.isLoading,
  };
}

export function useCreatePicklistOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      field_key: string;
      value: string;
      label: string;
      sort_order?: number;
      description?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("picklist_options")
        .insert({ ...input, sort_order: input.sort_order ?? 100 })
        .select()
        .single();
      if (error) throw error;
      return data as PicklistOption;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["picklist_options"] }),
  });
}

export function useUpdatePicklistOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<Omit<PicklistOption, "id" | "field_key" | "created_at">>;
    }) => {
      const { data, error } = await supabase
        .from("picklist_options")
        .update(input.patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as PicklistOption;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["picklist_options"] }),
  });
}

export function useDeletePicklistOption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("picklist_options").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["picklist_options"] }),
  });
}
