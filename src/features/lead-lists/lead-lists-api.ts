import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { LeadList, LeadListMember, Lead } from "@/types/crm";

// Shape of filter_config for dynamic ("smart") lists. Each key maps 1:1
// to a column on `leads`; arrays are translated to `in (...)`. Stored as
// jsonb on lead_lists.filter_config — kept loose on purpose so we can
// add more facets later without a schema migration.
export interface LeadListFilterConfig {
  status?: string[];
  source?: string[];
  qualification?: string[];
  rating?: string[];
  industry_category?: string[];
  owner_user_id?: string[];
  do_not_market_to?: boolean;
  /** Free-text filter applied to first/last/company/email. */
  search?: string;
}

// ---------------------------------------------------------------------------
// Lead Lists CRUD
// ---------------------------------------------------------------------------

export function useLeadLists() {
  return useQuery({
    queryKey: ["lead-lists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_lists")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LeadList[];
    },
  });
}

export function useCreateLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      name: string;
      description?: string;
      owner_user_id: string;
      is_dynamic?: boolean;
      filter_config?: LeadListFilterConfig | null;
    }) => {
      const { data, error } = await supabase
        .from("lead_lists")
        .insert({
          name: values.name,
          description: values.description ?? null,
          owner_user_id: values.owner_user_id,
          is_dynamic: values.is_dynamic ?? false,
          filter_config: values.filter_config ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
    },
  });
}

/** Update a list (rename, redescribe, or change smart-list filters). */
export function useUpdateLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      id: string;
      name?: string;
      description?: string | null;
      is_dynamic?: boolean;
      filter_config?: LeadListFilterConfig | null;
    }) => {
      const { id, ...patch } = values;
      const { data, error } = await supabase
        .from("lead_lists")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      qc.invalidateQueries({ queryKey: ["lead-list-members", vars.id] });
      qc.invalidateQueries({ queryKey: ["smart-list-leads", vars.id] });
    },
  });
}

export function useDeleteLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("lead_lists")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Lead List Members
// ---------------------------------------------------------------------------

export function useLeadListMembers(listId: string | undefined) {
  return useQuery({
    queryKey: ["lead-list-members", listId],
    queryFn: async () => {
      if (!listId) throw new Error("Missing list ID");
      const { data, error } = await supabase
        .from("lead_list_members")
        .select(
          "*, lead:leads(id, first_name, last_name, email, company, status, phone), contact:contacts(id, first_name, last_name, email, phone, account:accounts(name))"
        )
        .eq("list_id", listId)
        .order("added_at", { ascending: false });
      if (error) throw error;
      return data as unknown as LeadListMember[];
    },
    enabled: !!listId,
  });
}

export function useLeadListMemberCount() {
  return useQuery({
    queryKey: ["lead-list-member-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_list_members")
        .select("list_id");
      if (error) throw error;

      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.list_id] = (counts[row.list_id] ?? 0) + 1;
      }
      return counts;
    },
  });
}

export function useAddToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      list_id: string;
      lead_id?: string | null;
      contact_id?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("lead_list_members")
        .insert({
          list_id: values.list_id,
          lead_id: values.lead_id ?? null,
          contact_id: values.contact_id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.list_id],
      });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
    },
  });
}

export function useRemoveFromList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      memberId,
      listId,
    }: {
      memberId: string;
      listId: string;
    }) => {
      const { error } = await supabase
        .from("lead_list_members")
        .delete()
        .eq("id", memberId);
      if (error) throw error;
      return listId;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.listId],
      });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Smart (dynamic) lists — live-query leads from the filter_config rather
// than reading the membership join. Re-runs whenever filter_config or
// any underlying lead changes (since query key includes config + we
// invalidate on lead updates).
// ---------------------------------------------------------------------------

export function useSmartListLeads(
  listId: string | undefined,
  filterConfig: LeadListFilterConfig | null | undefined,
) {
  return useQuery({
    queryKey: ["smart-list-leads", listId, filterConfig],
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select(
          "id, first_name, last_name, email, phone, company, status, qualification, rating, source, industry_category, owner_user_id, do_not_market_to, owner:user_profiles!owner_user_id(id, full_name)",
        )
        .is("archived_at", null)
        .order("last_name", { ascending: true, nullsFirst: false })
        .limit(500);

      if (filterConfig?.status?.length) q = q.in("status", filterConfig.status);
      if (filterConfig?.source?.length) q = q.in("source", filterConfig.source);
      if (filterConfig?.qualification?.length)
        q = q.in("qualification", filterConfig.qualification);
      if (filterConfig?.rating?.length) q = q.in("rating", filterConfig.rating);
      if (filterConfig?.industry_category?.length)
        q = q.in("industry_category", filterConfig.industry_category);
      if (filterConfig?.owner_user_id?.length)
        q = q.in("owner_user_id", filterConfig.owner_user_id);
      if (typeof filterConfig?.do_not_market_to === "boolean")
        q = q.eq("do_not_market_to", filterConfig.do_not_market_to);
      if (filterConfig?.search) {
        const safe = filterConfig.search.replace(/[(),]/g, " ");
        q = q.or(
          `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`,
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
    enabled: !!listId,
  });
}

// ---------------------------------------------------------------------------
// Search leads for adding to lists
// ---------------------------------------------------------------------------

export function useSearchLeadsForList(search: string) {
  return useQuery({
    queryKey: ["lead-search-for-list", search],
    queryFn: async () => {
      if (!search || search.length < 2) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, email, company, status")
        .is("archived_at", null)
        .or(
          `first_name.ilike.%${search}%,last_name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%`
        )
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: search.length >= 2,
  });
}

// ---------------------------------------------------------------------------
// Filtered leads for bulk-add into a static list. Mirrors the smart-list
// query shape but doesn't require a list id, so the static-list "Add Leads"
// dialog can let users pick by criteria the same way smart lists do.
// ---------------------------------------------------------------------------

export function useLeadsByFilter(
  filterConfig: LeadListFilterConfig,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["leads-by-filter", filterConfig],
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select(
          "id, first_name, last_name, email, phone, company, status, qualification, rating, source, industry_category, owner_user_id, do_not_market_to",
        )
        .is("archived_at", null)
        .order("last_name", { ascending: true, nullsFirst: false })
        .limit(200);

      if (filterConfig.status?.length) q = q.in("status", filterConfig.status);
      if (filterConfig.source?.length) q = q.in("source", filterConfig.source);
      if (filterConfig.qualification?.length)
        q = q.in("qualification", filterConfig.qualification);
      if (filterConfig.rating?.length) q = q.in("rating", filterConfig.rating);
      if (filterConfig.industry_category?.length)
        q = q.in("industry_category", filterConfig.industry_category);
      if (filterConfig.owner_user_id?.length)
        q = q.in("owner_user_id", filterConfig.owner_user_id);
      if (typeof filterConfig.do_not_market_to === "boolean")
        q = q.eq("do_not_market_to", filterConfig.do_not_market_to);
      if (filterConfig.search) {
        const safe = filterConfig.search.replace(/[(),]/g, " ");
        q = q.or(
          `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%`,
        );
      }

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as Lead[];
    },
    enabled,
  });
}

// Bulk add many leads to a static list in one call. Skips duplicates
// silently (unique constraint on (list_id, lead_id)) so the dialog can
// re-add a result set without erroring on already-included leads.
export function useBulkAddToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      list_id,
      lead_ids,
    }: {
      list_id: string;
      lead_ids: string[];
    }) => {
      if (!lead_ids.length) return { added: 0 };
      const rows = lead_ids.map((lead_id) => ({ list_id, lead_id }));
      // upsert on (list_id, lead_id) so duplicates no-op cleanly. The
      // membership table has a unique index on this pair.
      const { error, count } = await supabase
        .from("lead_list_members")
        .upsert(rows, {
          onConflict: "list_id,lead_id",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (error) throw error;
      return { added: count ?? 0 };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.list_id],
      });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
    },
  });
}
