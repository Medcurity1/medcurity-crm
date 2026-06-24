import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Contact } from "@/types/crm";
import { buildPersonSearchClause } from "@/lib/search-clause";

interface ContactFilters {
  search?: string;
  account_id?: string;
  ownerId?: string | "mine" | string[];
  verified?: "true" | "false";
  /** Archive visibility. Omit to preserve legacy behavior (show all). */
  archived?: "active" | "archived" | "all";
  /** Filter to contacts carrying ANY of these tag ids (custom lists). */
  tagIds?: string[];
  page?: number;
  pageSize?: number;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc";
}

export function useContacts(filters?: ContactFilters) {
  return useQuery({
    queryKey: ["contacts", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;
      const sortCol = filters?.sortColumn ?? "last_name";
      const sortAsc = (filters?.sortDirection ?? "asc") === "asc";
      const hasTagFilter = !!(filters?.tagIds && filters.tagIds.length > 0);
      // Tag filter = "build a custom list". Use an INNER-JOIN embed on
      // contact_tags so the filter runs server-side: no 1,000-row resolve
      // cap, no giant id list in the URL, and an exact count for the list.
      const tagJoin = hasTagFilter ? ", contact_tags!inner(tag_id)" : "";
      let query = supabase
        .from("contacts")
        .select(
          "*, account:accounts!account_id(id, name), owner:user_profiles!owner_user_id(id, full_name)" +
            tagJoin,
          { count: hasTagFilter ? "exact" : "estimated" },
        )
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (sortCol.startsWith("account.")) {
        const innerCol = sortCol.slice("account.".length);
        query = query.order(innerCol, {
          ascending: sortAsc,
          nullsFirst: false,
          referencedTable: "account",
        });
      } else {
        query = query.order(sortCol, { ascending: sortAsc, nullsFirst: false });
      }
      // Stable tiebreaker so offset paging can't duplicate/skip rows that
      // tie on sortCol at page boundaries.
      query = query.order("id", { ascending: true });

      // Archive visibility. Undefined => no filter (legacy: e.g. ReportBuilder
      // wants every contact). The list passes "active" so archived contacts
      // don't add noise; admins can switch to "archived"/"all".
      if (filters?.archived === "active") {
        query = query.is("archived_at", null);
      } else if (filters?.archived === "archived") {
        query = query.not("archived_at", "is", null);
      }

      if (filters?.search) {
        // Search contact fields AND parent account name. Multi-word
        // queries also match across (first_name, last_name) — see
        // `buildPersonSearchClause`.
        const term = filters.search;
        const { data: matchedAccounts } = await supabase
          .from("accounts")
          .select("id")
          .ilike("name", `%${term.replace(/[(),%]/g, " ")}%`)
          .limit(200);
        const acctIds = (matchedAccounts ?? []).map((a) => a.id as string);
        const baseClause = buildPersonSearchClause(term, [
          "first_name",
          "last_name",
          "email",
          "email2",
          "email3",
          "title",
        ]);
        const parts: string[] = [];
        if (baseClause) parts.push(baseClause);
        if (acctIds.length > 0) {
          parts.push(`account_id.in.(${acctIds.join(",")})`);
        }
        if (parts.length > 0) query = query.or(parts.join(","));
      }
      if (filters?.account_id) {
        query = query.eq("account_id", filters.account_id);
      }
      // Constrain to contacts carrying ANY of the chosen tags via the
      // inner-join embed declared above. Runs server-side; a real query
      // error now surfaces (it used to be swallowed, masking failures as
      // an empty list).
      if (hasTagFilter) {
        query = query.in("contact_tags.tag_id", filters!.tagIds!);
      }
      if (Array.isArray(filters?.ownerId)) {
        const ids = filters!.ownerId;
        if (ids.includes("mine")) {
          const { data: userData } = await supabase.auth.getUser();
          if (userData.user?.id) {
            const resolved = Array.from(
              new Set(ids.map((v) => (v === "mine" ? userData.user!.id : v))),
            );
            if (resolved.length > 0) query = query.in("owner_user_id", resolved);
          } else if (ids.length > 1) {
            const noMine = ids.filter((v) => v !== "mine");
            if (noMine.length > 0) query = query.in("owner_user_id", noMine);
          }
        } else if (ids.length > 0) {
          query = query.in("owner_user_id", ids);
        }
      } else if (filters?.ownerId && filters.ownerId !== "mine") {
        query = query.eq("owner_user_id", filters.ownerId);
      } else if (filters?.ownerId === "mine") {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user?.id) query = query.eq("owner_user_id", userData.user.id);
      }
      if (filters?.verified === "true") query = query.eq("verified", true);
      else if (filters?.verified === "false") query = query.eq("verified", false);

      const { data, error, count } = await query;
      if (error) throw error;
      // `as unknown` first: the optional contact_tags!inner embed makes
      // PostgREST's inferred row type diverge from Contact.
      return { data: data as unknown as Contact[], count: count ?? 0 };
    },
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: ["contacts", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing contact ID");
      const { data, error } = await supabase
        .from("contacts")
        .select("*, account:accounts!account_id(id, name), owner:user_profiles!owner_user_id(id, full_name), creator:user_profiles!created_by(id, full_name), updater:user_profiles!updated_by(id, full_name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Contact;
    },
    enabled: !!id,
  });
}

/**
 * Find the lead (if any) that converted INTO this contact. Returns the
 * tombstone row from `leads` where leads.converted_contact_id = contact.id.
 *
 * Used on the ContactDetail page so reps can click back to the
 * original lead's history (UTM source, MQL date, original sales notes).
 * Mirrors Salesforce's "Converted from Lead" affordance.
 */
export function useOriginatingLead(contactId: string | undefined) {
  return useQuery({
    queryKey: ["contacts", contactId, "originating_lead"],
    queryFn: async () => {
      if (!contactId) return null;
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, company, source, converted_at, created_at")
        .eq("converted_contact_id", contactId)
        .maybeSingle();
      if (error) throw error;
      return data as
        | {
            id: string;
            first_name: string | null;
            last_name: string | null;
            company: string | null;
            source: string | null;
            converted_at: string | null;
            created_at: string;
          }
        | null;
    },
    enabled: !!contactId,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Contact>) => {
      const { data, error } = await supabase
        .from("contacts")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Contact> & { id: string }) => {
      const { data, error } = await supabase
        .from("contacts")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contacts", vars.id] });
    },
  });
}

export function useBulkUpdateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, owner_user_id }: { ids: string[]; owner_user_id: string }) => {
      // Bulk UPDATE per chunk + verify affected count. A per-row RLS denial
      // or missing id doesn't throw (PostgREST just won't match it), so the
      // old Promise.all(per-row) reported success even when nothing changed.
      const CHUNK = 100;
      let updated = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("contacts")
          .update({ owner_user_id })
          .in("id", batch)
          .select("id");
        if (error) throw error;
        updated += (data ?? []).length;
      }
      if (updated < ids.length) {
        throw new Error(
          `Reassigned ${updated} of ${ids.length}. ${ids.length - updated} could not be updated (permission denied or no longer exist).`
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useBulkDeleteContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from("contacts").delete().in("id", batch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
  });
}

export function useArchiveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("archive_record", {
        target_table: "contacts",
        target_id: id,
        reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["account-contacts"] });
    },
  });
}

/**
 * Mark a contact as the account's primary. One primary per account, so this
 * demotes every other contact on the same account, then promotes this one.
 */
export function useSetPrimaryContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accountId }: { id: string; accountId: string }) => {
      const { error: demoteErr } = await supabase
        .from("contacts")
        .update({ is_primary: false })
        .eq("account_id", accountId)
        .neq("id", id);
      if (demoteErr) throw demoteErr;
      const { error: promoteErr } = await supabase
        .from("contacts")
        .update({ is_primary: true })
        .eq("id", id);
      if (promoteErr) throw promoteErr;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contacts", vars.id] });
      qc.invalidateQueries({ queryKey: ["account-contacts"] });
    },
  });
}
