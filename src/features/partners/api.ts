import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { PartnerAccount } from "@/types/crm";

interface PartnerFilters {
  search?: string;
  // Account Status (customer_status: client/prospect/former_client) — the
  // partners list surfaces this in place of the retired accounts.status field.
  customerStatus?: string | string[];
  // "umbrella" = partners that have members under them
  // "member"   = accounts that are a member of someone
  // "top_level"= umbrella AND not a member of anyone else
  // "all"      = default (any partner-flagged account)
  partnerRole?: "umbrella" | "member" | "top_level" | "all";
  /** Filter by partner_type picklist values. The special value "__none__"
   *  matches partners with NO type set (Rachel's cleanup view). */
  partnerType?: string[];
  page?: number;
  pageSize?: number;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc";
}

export interface PartnersResult {
  data: PartnerAccount[];
  count: number;
  /** account_id -> most-recent interaction timestamp, for the page shown. */
  lastContact: Map<string, string>;
}

export function usePartners(filters?: PartnerFilters) {
  return useQuery<PartnersResult>({
    queryKey: ["partners", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;
      const role = filters?.partnerRole ?? "all";
      const sortCol = filters?.sortColumn ?? "name";
      const sortAsc = (filters?.sortDirection ?? "asc") === "asc";

      // All the partner identification + member-count + umbrella/member
      // rollups now live in the v_partner_accounts view, so the page
      // paginates server-side instead of pulling the whole partnership
      // table into the browser and OR-ing ids into the URL. A 15s timeout
      // turns a hung request into a normal error (with a Retry button)
      // rather than a forever-loading page.
      let query = supabase
        .from("v_partner_accounts")
        .select("*", { count: "exact" })
        .order(sortCol, { ascending: sortAsc, nullsFirst: false })
        // Stable tiebreaker so offset paging can't duplicate/skip rows
        // that tie on sortCol at page boundaries.
        .order("id", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      // Role buckets are mutually exclusive flags on the view.
      if (role === "umbrella") query = query.eq("is_umbrella", true);
      else if (role === "member") query = query.eq("is_member", true);
      else if (role === "top_level") query = query.eq("is_top_level", true);

      if (filters?.search) {
        query = query.ilike("name", `%${filters.search}%`);
      }
      if (filters?.customerStatus) {
        if (Array.isArray(filters.customerStatus)) {
          if (filters.customerStatus.length > 0)
            query = query.in("customer_status", filters.customerStatus);
        } else {
          query = query.eq("customer_status", filters.customerStatus);
        }
      }
      if (filters?.partnerType && filters.partnerType.length > 0) {
        // "__none__" = partners with no type yet (the cleanup bucket). It can
        // be combined with real values, so build an OR of is-null + in-list.
        const wantNone = filters.partnerType.includes("__none__");
        const values = filters.partnerType.filter((v) => v !== "__none__");
        const parts: string[] = [];
        if (wantNone) parts.push("partner_type.is.null");
        if (values.length > 0) {
          // Quote each value — picklist labels can contain spaces/commas.
          parts.push(`partner_type.in.(${values.map((v) => `"${v.replace(/"/g, "")}"`).join(",")})`);
        }
        if (parts.length > 0) query = query.or(parts.join(","));
      }

      const { data, error, count } = await query.abortSignal(
        AbortSignal.timeout(15000),
      );
      if (error) throw error;

      const accountsPage = (data ?? []) as unknown as PartnerAccount[];

      // Last Contact for just the visible page — scoped to these ids so we
      // never aggregate the whole activities table on every render.
      const lastContact = new Map<string, string>();
      const pageIds = accountsPage.map((a) => a.id);
      if (pageIds.length > 0) {
        const { data: la } = await supabase
          .from("v_account_last_activity")
          .select("account_id, last_activity_at")
          .in("account_id", pageIds)
          .abortSignal(AbortSignal.timeout(15000));
        for (const r of la ?? []) {
          if (r.last_activity_at) {
            lastContact.set(r.account_id as string, r.last_activity_at as string);
          }
        }
      }

      return { data: accountsPage, count: count ?? 0, lastContact };
    },
  });
}
