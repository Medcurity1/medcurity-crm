import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Contact } from "@/types/crm";

interface ContactFilters {
  search?: string;
  account_id?: string;
  ownerId?: string | "mine" | string[];
  verified?: "true" | "false";
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
      let query = supabase
        .from("contacts")
        .select("*, account:accounts!account_id(id, name), owner:user_profiles!owner_user_id(id, full_name)", { count: "estimated" })
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

      if (filters?.search) {
        // Search contact fields AND parent account name.
        const term = filters.search;
        const { data: matchedAccounts } = await supabase
          .from("accounts")
          .select("id")
          .ilike("name", `%${term}%`)
          .limit(200);
        const acctIds = (matchedAccounts ?? []).map((a) => a.id as string);
        const safe = term.replace(/[(),]/g, " ");
        const orParts = [
          `first_name.ilike.%${safe}%`,
          `last_name.ilike.%${safe}%`,
          `email.ilike.%${safe}%`,
          `title.ilike.%${safe}%`,
        ];
        if (acctIds.length > 0) {
          orParts.push(`account_id.in.(${acctIds.join(",")})`);
        }
        query = query.or(orParts.join(","));
      }
      if (filters?.account_id) {
        query = query.eq("account_id", filters.account_id);
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
      return { data: data as Contact[], count: count ?? 0 };
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
      const promises = ids.map((id) =>
        supabase.from("contacts").update({ owner_user_id }).eq("id", id)
      );
      await Promise.all(promises);
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
    },
  });
}
