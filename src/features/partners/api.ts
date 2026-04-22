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

      // Two ways an account qualifies as a partner:
      //   1. Explicitly flagged via account_type = 'Partner' (also
      //      catches the SF-imported partners + accounts using the
      //      legacy partner_account text / partner_prospect bool)
      //   2. At least one row in account_partners where it's the
      //      partner side (i.e. someone is its member)
      // We pull (2) as a separate id list and OR it into the main
      // query — keeps the SQL simple and lets PostgREST paginate
      // normally.
      const { data: derivedRows, error: derivedErr } = await supabase
        .from("account_partners")
        .select("partner_account_id");
      if (derivedErr) throw derivedErr;
      const derivedIds = Array.from(
        new Set((derivedRows ?? []).map((r) => r.partner_account_id))
      );

      // Build the OR clause. partner_account.not.is.null and
      // partner_prospect.eq.true are kept for back-compat with the
      // legacy text-based partner field. The `id.in.(…)` clause
      // pulls in everything from the new join table.
      const orParts = [
        "partner_account.not.is.null",
        "partner_prospect.eq.true",
        "account_type.eq.Partner",
      ];
      if (derivedIds.length > 0) {
        orParts.push(`id.in.(${derivedIds.join(",")})`);
      }

      let query = supabase
        .from("accounts")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "exact" })
        .or(orParts.join(","))
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
