import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Account } from "@/types/crm";

interface PartnerFilters {
  search?: string;
  status?: string;
  // "umbrella" = partners that have members under them
  // "member"   = accounts that are a member of someone
  // "top_level"= umbrella AND not a member of anyone else
  // "all"      = default (any partner-flagged account)
  partnerRole?: "umbrella" | "member" | "top_level" | "all";
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

      // ALSO include legacy partner_account text relationships. Many
      // SF-imported accounts didn't get a row in account_partners; they
      // just have `partner_account = '<umbrella name>'` as a free-text
      // field. Build a name → id map so we can attribute those member
      // counts to the right umbrella account.
      //
      // We page through ALL accounts (not just ones with partner_account
      // set) once so we can resolve names → ids. The result is cached
      // by react-query so this is a single fetch per session.
      const { data: legacyRows, error: legacyErr } = await supabase
        .from("accounts")
        .select("id, name, partner_account")
        .not("partner_account", "is", null);
      if (legacyErr) throw legacyErr;

      // umbrella name (lowercased) → set of umbrella account IDs that
      // share that name. Most names will map to exactly 1 id.
      const nameToUmbrellaIds = new Map<string, Set<string>>();
      for (const r of legacyRows ?? []) {
        const nm = (r.name ?? "").trim().toLowerCase();
        if (!nm) continue;
        if (!nameToUmbrellaIds.has(nm)) nameToUmbrellaIds.set(nm, new Set());
        nameToUmbrellaIds.get(nm)!.add(r.id);
      }
      // For accounts that have `partner_account` text set, increment
      // the matching umbrella's member count.
      for (const r of legacyRows ?? []) {
        const partnerName = (r.partner_account ?? "").trim().toLowerCase();
        if (!partnerName) continue;
        const umbrellaIdSet = nameToUmbrellaIds.get(partnerName);
        if (!umbrellaIdSet) continue;
        for (const umbrellaId of umbrellaIdSet) {
          if (umbrellaId === r.id) continue; // can't be its own member
          umbrellaIds.add(umbrellaId);
          memberIds.add(r.id);
          memberCount.set(
            umbrellaId,
            (memberCount.get(umbrellaId) ?? 0) + 1
          );
        }
      }
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

      let query = supabase
        .from("accounts")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "exact" })
        .order("name")
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
        query = query.eq("status", filters.status);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data as Account[], count: count ?? 0, memberCount };
    },
  });
}
