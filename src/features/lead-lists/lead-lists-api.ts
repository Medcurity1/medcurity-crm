import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { LeadList, LeadListMember } from "@/types/crm";
import { buildPersonSearchClause } from "@/lib/search-clause";

// (Smart-list filter machinery removed 2026-07-20 with the lead type —
// lists are static contact lists; filter_config is inert history.)

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
      is_working_list?: boolean;
      filter_config?: Record<string, unknown> | null;
    }) => {
      const { data, error } = await supabase
        .from("lead_lists")
        .insert({
          name: values.name,
          description: values.description ?? null,
          owner_user_id: values.owner_user_id,
          is_dynamic: values.is_dynamic ?? false,
          is_working_list: values.is_working_list ?? false,
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
      is_working_list?: boolean;
      filter_config?: Record<string, unknown> | null;
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
      // Contact-only since the lead-type retirement (2026-07-20): migration
      // 20260720150000 repointed promoted-lead members and dropped the rest.
      const { data, error } = await supabase
        .from("lead_list_members")
        .select(
          "*, contact:contacts(id, first_name, last_name, email, phone, account:accounts(name))",
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

// (useAddToList removed 2026-07-20 — pen/lists are contact-only; use
// useBulkAddContactsToList.)

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

// (Smart-list + lead-side hooks removed 2026-07-20 with the lead type;
// v_lead_last_activity was dropped in migration 20260720170000.)

export interface ContactListCandidate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  title: string | null;
  account: { name: string } | null;
}

/**
 * Search contacts by name/email for adding to a list. Over-fetches (50)
 * then excludes contacts already on `listId` client-side, returning up
 * to 20 — a NOT IN clause with a long membership list would blow up the
 * PostgREST URL.
 */
export function useSearchContactsForList(search: string, listId?: string) {
  return useQuery({
    queryKey: ["contact-search-for-list", search, listId],
    queryFn: async () => {
      if (!search || search.length < 2) return [];
      const orClause = buildPersonSearchClause(search, [
        "first_name",
        "last_name",
        "email",
      ]);
      let q = supabase
        .from("contacts")
        .select(
          "id, first_name, last_name, email, title, account:accounts!account_id(name)",
        )
        .is("archived_at", null)
        // Pending imports stay in the pen until promoted — a call list
        // should never pull someone whose email isn't cleaned yet.
        .is("import_status", null);
      if (orClause) q = q.or(orClause);
      const [{ data, error }, membersRes] = await Promise.all([
        q.order("last_name", { ascending: true, nullsFirst: false }).limit(50),
        listId
          ? supabase
              .from("lead_list_members")
              .select("contact_id")
              .eq("list_id", listId)
              .not("contact_id", "is", null)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (error) throw error;
      if (membersRes.error) throw membersRes.error;
      const existing = new Set(
        (membersRes.data ?? []).map(
          (r) => (r as { contact_id: string | null }).contact_id,
        ),
      );
      return ((data ?? []) as unknown as ContactListCandidate[])
        .filter((c) => !existing.has(c.id))
        .slice(0, 20);
    },
    enabled: search.length >= 2,
  });
}

// Bulk add contacts to a static list. Duplicates no-op cleanly via the
// unique index on (list_id, contact_id); `added` reflects only new rows
// so callers can report "added N (M already on list)".
export function useBulkAddContactsToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      list_id,
      contact_ids,
    }: {
      list_id: string;
      contact_ids: string[];
    }) => {
      if (!contact_ids.length) return { added: 0, requested: 0 };
      const rows = contact_ids.map((contact_id) => ({ list_id, contact_id }));
      const { error, count } = await supabase
        .from("lead_list_members")
        .upsert(rows, {
          onConflict: "list_id,contact_id",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (error) throw error;
      return { added: count ?? 0, requested: contact_ids.length };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.list_id],
      });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
      qc.invalidateQueries({ queryKey: ["contact-search-for-list"] });
    },
  });
}

// Move a contact member to another list. Insert-then-delete ordering is
// deliberate: a DB trigger deactivates an account when its contacts leave
// ALL lists, so the contact must land on the target list before leaving
// the source to avoid a transient "on no lists" state.
export function useMoveContactMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      memberId,
      toListId,
      contactId,
    }: {
      memberId: string;
      fromListId: string;
      toListId: string;
      contactId: string;
    }) => {
      const { error: insertError, count } = await supabase
        .from("lead_list_members")
        .upsert([{ list_id: toListId, contact_id: contactId }], {
          onConflict: "list_id,contact_id",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (insertError) throw insertError;
      const { error: deleteError } = await supabase
        .from("lead_list_members")
        .delete()
        .eq("id", memberId);
      if (deleteError) throw deleteError;
      return { alreadyInTarget: (count ?? 0) === 0 };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.fromListId],
      });
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.toListId],
      });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
    },
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
