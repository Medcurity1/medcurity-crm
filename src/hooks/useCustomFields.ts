import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { CustomFieldDefinition } from "@/types/crm";

export function useCustomFieldDefinitions(entity: string) {
  return useQuery({
    queryKey: ["custom_field_definitions", entity],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_field_definitions")
        .select("*")
        .eq("entity", entity)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as CustomFieldDefinition[];
    },
  });
}
