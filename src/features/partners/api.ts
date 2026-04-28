import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Account } from "@/types/crm";

interface PartnerFilters {
  search?: string;
  status?: string | string[];
  // "umbrella" = partners that have members under them
  // "member"   = accounts that are a member of someone
  // "top_level"= umbrella AND not a member of anyone else
  // "all"      = default (any partner-flagged account)
  partnerRole?: "umbrella" | "member" | "top_level" | "all";
  page?: number;
  pageSize?: number;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc";
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
      // Fetch both sides of the join table so we know who's an
      // umbrella (has members) vs a member (is under someone) vs
      // top-level (umbrella AND not a member of anyone).
      const { data: joinRows, error: joinErr } = await supabase
        .from("account_partners")
        .select("partner_account_id, member_account_id");
      if (joinErr) throw joinErr;
      const umbrellaIds = new Set<string>();
      const memberIds = new Set<string>();
      // memberCount is also useful for the list page table — we
      // only compute it here since we already have the data in
      // hand.
      const memberCount = new Map<string, number>();
      for (const r of joinRows ?? []) {
        umbrellaIds.add(r.partner_account_id);
        memberIds.add(r.member_account_id);
        memberCount.set(
          r.partner_account_id,
          (memberCount.get(r.partner_account_id) ?? 0) + 1
        );
      }

      // Skip legacy partner_account text aggregation for now — it's
      // ~5600-row scan that was making the page take >10s and
      // sometimes timing out. The members count is approximate without
      // it; we'll wire a Postgres view for legacy partner counts in a
      // follow-up so we don't have to fetch every account row.
      // Keeping the variables defined so the rest of the function
      // doesn't break.
      const topLevelIds = new Set(
        Array.from(umbrellaIds).filter((id) => !memberIds.has(id))
      );

      const role = filters?.partnerRole ?? "all";

      // Determine the id set the query should constrain on.
      // - "all" (default): no id constraint; just use the broad
      //   partner filter (account_type, partner_account text, etc.)
      // - "umbrella" / "member" / "top_level": strict id list from
      //   the join table
      let constrainIds: string[] | null = null;
      if (role === "umbrella") constrainIds = Array.from(umbrellaIds);
      else if (role === "member") constrainIds = Array.from(memberIds);
      else if (role === "top_level") constrainIds = Array.from(topLevelIds);

      // "all" uses the historical OR: explicit Partner account_type,
      // legacy partner_account text, partner_prospect flag, OR any
      // umbrella (anyone who has members). Catches everything that
      // could be considered a partner.
      const orParts = [
        "partner_account.not.is.null",
        "partner_prospect.eq.true",
        "account_type.eq.Partner",
      ];
      if (role === "all" && umbrellaIds.size > 0) {
        orParts.push(`id.in.(${Array.from(umbrellaIds).join(",")})`);
      }

      const sortCol = filters?.sortColumn ?? "name";
      const sortAsc = (filters?.sortDirection ?? "asc") === "asc";
      let query = supabase
        .from("accounts")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "exact" })
        .order(sortCol, { ascending: sortAsc, nullsFirst: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (constrainIds) {
        // Specific role filter — override the broad OR entirely.
        // An empty id list means no results for that role (e.g. no
        // umbrellas yet in a fresh DB).
        if (constrainIds.length === 0) {
          return { data: [], count: 0, memberCount };
        }
        query = query.in("id", constrainIds);
      } else {
        query = query.or(orParts.join(","));
      }

      if (filters?.search) {
        query = query.ilike("name", `%${filters.search}%`);
      }
      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          if (filters.status.length > 0) query = query.in("status", filters.status);
        } else {
          query = query.eq("status", filters.status);
        }
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data as Account[], count: count ?? 0, memberCount };
    },
  });
}
