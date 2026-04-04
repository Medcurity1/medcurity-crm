import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

interface RequiredFieldEntry {
  field_key: string;
  is_required: boolean;
}

export function useRequiredFields(entity: string) {
  return useQuery({
    queryKey: ["required_fields", entity],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("required_field_config")
        .select("field_key, is_required")
        .eq("entity", entity)
        .eq("is_required", true);
      if (error) {
        // Table may not exist yet, return empty
        console.warn("required_field_config query failed:", error.message);
        return [] as RequiredFieldEntry[];
      }
      return data as RequiredFieldEntry[];
    },
  });
}
