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

// ---------------------------------------------------------------------------
// Smart lists v2 (2026-07-20, contact-based). A smart list stores RULES in
// lead_lists.filter_config (is_dynamic = true) and resolves membership live
// at read time — tag someone and they appear in every matching smart list
// instantly. No lead_list_members rows; "freeze" materializes into a
// regular list. Query composition mirrors useContacts' proven patterns
// (contact_tags!inner embed; accounts!inner for customer_status).
// ---------------------------------------------------------------------------

export interface SmartListRules {
  /** Has ANY of these tags. */
  tag_ids?: string[];
  /** contacts.mailing_state in (state codes). */
  states?: string[];
  /** contacts.owner_user_id in. */
  owner_ids?: string[];
  /** Account relationship (via the account join). */
  customer_status?: string[];
  has_phone?: boolean;
  has_email?: boolean;
}

export interface SmartMemberRow {
  id: string;
  first_name: string | null;
  last_name: string;
  email: string | null;
  phone: string | null;
  account: { name: string } | null;
}

export function parseSmartRules(list: LeadList): SmartListRules {
  return ((list.filter_config ?? {}) as SmartListRules) || {};
}

/** Human chips for the rules summary. Resolvers are passed in so this
 * stays a pure helper. */
export function smartRuleChips(
  rules: SmartListRules,
  tagName: (id: string) => string,
  userName: (id: string) => string,
  statusLabel: (v: string) => string,
): string[] {
  const chips: string[] = [];
  if (rules.tag_ids?.length) chips.push(`Tag: ${rules.tag_ids.map(tagName).join(" or ")}`);
  if (rules.states?.length) chips.push(`State: ${rules.states.join(", ")}`);
  if (rules.owner_ids?.length) chips.push(`Owner: ${rules.owner_ids.map(userName).join(", ")}`);
  if (rules.customer_status?.length)
    chips.push(`Status: ${rules.customer_status.map(statusLabel).join(" or ")}`);
  if (rules.has_phone) chips.push("Has a phone");
  if (rules.has_email) chips.push("Has an email");
  return chips;
}

const SMART_FETCH_CAP = 2000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildSmartQuery(rules: SmartListRules, selectCols: string): any {
  const needsTags = !!rules.tag_ids?.length;
  const needsAccount = !!rules.customer_status?.length;
  const select =
    selectCols +
    (needsTags ? ", contact_tags!inner(tag_id)" : "") +
    (needsAccount ? ", accounts!account_id!inner(customer_status)" : "");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from("contacts")
    .select(select)
    .is("archived_at", null)
    .is("import_status", null);
  if (needsTags) q = q.in("contact_tags.tag_id", rules.tag_ids);
  if (needsAccount) q = q.in("accounts.customer_status", rules.customer_status);
  if (rules.states?.length) q = q.in("mailing_state", rules.states);
  if (rules.owner_ids?.length) q = q.in("owner_user_id", rules.owner_ids);
  if (rules.has_phone) q = q.not("phone", "is", null);
  if (rules.has_email) q = q.not("email", "is", null);
  return q;
}

/** A smart list needs at least one rule — an empty rule set would be
 * "every contact in the CRM", which is never what someone meant. */
export function smartRulesEmpty(rules: SmartListRules): boolean {
  return (
    !rules.tag_ids?.length &&
    !rules.states?.length &&
    !rules.owner_ids?.length &&
    !rules.customer_status?.length &&
    !rules.has_phone &&
    !rules.has_email
  );
}

/** Live members of a smart list (deduped — a multi-tag match returns one
 * row per matching tag through the inner embed). Capped at SMART_FETCH_CAP;
 * `capped` tells the UI to say "2,000+". */
export function useSmartListMembers(list: LeadList | null) {
  const rules = list ? parseSmartRules(list) : null;
  return useQuery({
    queryKey: ["smart-list-members", list?.id, rules],
    enabled: !!list && list.is_dynamic,
    queryFn: async () => {
      if (!rules || smartRulesEmpty(rules)) {
        return { rows: [] as SmartMemberRow[], capped: false };
      }
      const { data, error } = await buildSmartQuery(
        rules,
        "id, first_name, last_name, email, phone, account:accounts!account_id(name)",
      )
        .order("last_name", { ascending: true, nullsFirst: false })
        .limit(SMART_FETCH_CAP);
      if (error) throw error;
      const seen = new Set<string>();
      const rows: SmartMemberRow[] = [];
      for (const r of (data ?? []) as unknown as SmartMemberRow[]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        rows.push(r);
      }
      return { rows, capped: (data ?? []).length >= SMART_FETCH_CAP };
    },
  });
}

/** Additive-only Sales-Status activation for ACTIVE smart lists: flips
 * matching accounts to actively-worked (never off — a rule change must
 * not mass-deactivate). Fired when an active smart list is opened or its
 * rules change; idempotent and cheap. */
export function useActivateAccountsForContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (contactIds: string[]) => {
      if (!contactIds.length) return 0;
      const { data, error } = await supabase.rpc("activate_accounts_for_contacts", {
        p_contact_ids: contactIds,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

/** Freeze a smart list: materialize its CURRENT members into a brand-new
 * regular list you can hand-edit ("start with a full group"). */
export function useFreezeSmartList() {
  const qc = useQueryClient();
  const createList = useCreateLeadList();
  const bulkAdd = useBulkAddContactsToList();
  return useMutation({
    mutationFn: async (list: LeadList) => {
      const rules = parseSmartRules(list);
      if (smartRulesEmpty(rules)) throw new Error("This smart list has no rules yet.");
      const { data, error } = await buildSmartQuery(rules, "id").limit(SMART_FETCH_CAP);
      if (error) throw error;
      const ids = [...new Set(((data ?? []) as { id: string }[]).map((r) => r.id))];
      if (!ids.length) throw new Error("No contacts match this smart list right now.");
      const { data: auth } = await supabase.auth.getUser();
      const frozen = await createList.mutateAsync({
        name: `${list.name} (frozen ${new Date().toLocaleDateString()})`,
        description: `Snapshot of smart list "${list.name}"`,
        owner_user_id: auth.user!.id,
        is_dynamic: false,
        // An ACTIVE smart list freezes into an ACTIVE (working) regular
        // list — "take over manually" keeps driving status (review fix).
        is_working_list: list.is_working_list,
      });
      for (let i = 0; i < ids.length; i += 500) {
        await bulkAdd.mutateAsync({ list_id: frozen.id, contact_ids: ids.slice(i, i + 500) });
      }
      return { list: frozen, added: ids.length };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
    },
  });
}


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
      // Chunked (review fix): "Save as list" can hand this tens of
      // thousands of ids — one giant upsert would run a huge statement
      // and fire the working-list trigger per row inside it.
      let added = 0;
      for (let i = 0; i < contact_ids.length; i += 500) {
        const rows = contact_ids
          .slice(i, i + 500)
          .map((contact_id) => ({ list_id, contact_id }));
        const { error, count } = await supabase
          .from("lead_list_members")
          .upsert(rows, {
            onConflict: "list_id,contact_id",
            ignoreDuplicates: true,
            count: "exact",
          });
        if (error) throw error;
        added += count ?? 0;
      }
      return { added, requested: contact_ids.length };
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
