import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { LeadList, LeadListMember } from "@/types/crm";

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
    }) => {
      const { data, error } = await supabase
        .from("lead_lists")
        .insert({
          name: values.name,
          description: values.description ?? null,
          owner_user_id: values.owner_user_id,
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
