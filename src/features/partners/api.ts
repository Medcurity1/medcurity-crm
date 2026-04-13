import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Account } from "@/types/crm";

interface PartnerFilters {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export function usePartners(filters?: PartnerFilters) {
  return useQuery({
    queryKey: ["partners", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;

      let query = supabase
        .from("accounts")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "exact" })
        .or("partner_account.not.is.null,partner_prospect.eq.true,account_type.eq.Partner")
        .order("name")
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (filters?.search) {
        query = query.ilike("name", `%${filters.search}%`);
      }
      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data as Account[], count: count ?? 0 };
    },
  });
}
