import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Account, AccountContract } from "@/types/crm";
import { buildPersonSearchClause } from "@/lib/search-clause";

interface AccountFilters {
  search?: string;
  /** Automatic customer status: client | prospect | former_client. */
  customerStatus?: string | string[];
  /** Sales working state: "true" = actively worked, "false" = not. */
  salesActive?: "true" | "false";
  /** Filter to one or many sales_status values. */
  salesStatus?: string[];
  /** next_follow_up_date window: due = set and within 7 days (includes
   *  overdue), overdue = set and strictly before today. */
  followUp?: "due" | "overdue";
  /** Filter to one or many owners. "mine" = current user. Arrays do an IN. */
  ownerId?: string | "mine" | string[];
  /** Single industry (legacy) or array of industries (multi-select). */
  industryCategory?: string | string[];
  /** Filter to accounts whose billing_state is one of these values. */
  billingState?: string[];
  /** Filter to only verified or only unverified accounts. */
  verified?: "true" | "false";
  page?: number;
  pageSize?: number;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc";
}

export function useAccounts(filters?: AccountFilters) {
  return useQuery({
    queryKey: ["accounts", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;
      const sortCol = filters?.sortColumn ?? "name";
      const sortAsc = (filters?.sortDirection ?? "asc") === "asc";
      let query = supabase
        .from("accounts")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "estimated" })
        .order(sortCol, { ascending: sortAsc, nullsFirst: false })
        // Stable tiebreaker so offset paging is deterministic — without a
        // unique final sort key, rows tied on sortCol can repeat at page
        // boundaries (the "same record on two pages" bug).
        .order("id", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (filters?.search) {
        // Search covers account name + free-text industry column AND any
        // account whose primary/associated contact matches the query.
        // SF behavior: typing a contact's name in the accounts list
        // surfaces their parent account (e.g. "Mari Harris" → Healthline
        // Medical Group). Without this, reps have to remember the
        // company name when they only know the person.
        // Note: industry_category is an enum which PostgREST can't
        // ilike; to filter by category use the Industry dropdown.
        const term = filters.search;
        const safe = term.replace(/[(),%]/g, " ");
        const contactClause = buildPersonSearchClause(term, [
          "first_name",
          "last_name",
          "email",
        ]);
        let contactAccountIds: string[] = [];
        if (contactClause) {
          const { data: matchedContacts } = await supabase
            .from("contacts")
            .select("account_id")
            .is("archived_at", null)
            .not("account_id", "is", null)
            .or(contactClause)
            .limit(500);
          contactAccountIds = Array.from(
            new Set(
              (matchedContacts ?? [])
                .map((c) => c.account_id as string | null)
                .filter((v): v is string => !!v),
            ),
          );
        }
        const orParts = [
          `name.ilike.%${safe}%`,
          `industry.ilike.%${safe}%`,
        ];
        if (contactAccountIds.length > 0) {
          // Cap the ids we OR into the request URL so a search term that matches
          // hundreds of contacts can't blow past PostgREST's URL-length limit
          // (each UUID is ~37 chars). 150 is plenty for a search box.
          const capped = contactAccountIds.slice(0, 150);
          orParts.push(`id.in.(${capped.join(",")})`);
        }
        query = query.or(orParts.join(","));
      }
      if (filters?.customerStatus) {
        if (Array.isArray(filters.customerStatus)) {
          if (filters.customerStatus.length > 0)
            query = query.in("customer_status", filters.customerStatus);
        } else {
          query = query.eq("customer_status", filters.customerStatus);
        }
      }
      if (filters?.salesActive === "true") {
        query = query.eq("sales_active", true);
      } else if (filters?.salesActive === "false") {
        query = query.eq("sales_active", false);
      }
      if (filters?.salesStatus && filters.salesStatus.length > 0) {
        query = query.in("sales_status", filters.salesStatus);
      }
      if (filters?.followUp) {
        // Local calendar date (not UTC) — follow-ups are day-granular and
        // reps think in their own timezone.
        const localIso = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const today = new Date();
        query = query.not("next_follow_up_date", "is", null);
        if (filters.followUp === "due") {
          const plus7 = new Date(today);
          plus7.setDate(plus7.getDate() + 7);
          query = query.lte("next_follow_up_date", localIso(plus7));
        } else {
          query = query.lt("next_follow_up_date", localIso(today));
        }
      }
      if (Array.isArray(filters?.ownerId)) {
        // Multi-owner filter. Resolve any "mine" tokens to the user id.
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
        if (userData.user?.id) {
          query = query.eq("owner_user_id", userData.user.id);
        }
      }
      if (filters?.industryCategory) {
        if (Array.isArray(filters.industryCategory)) {
          if (filters.industryCategory.length > 0)
            query = query.in("industry_category", filters.industryCategory);
        } else {
          query = query.eq("industry_category", filters.industryCategory);
        }
      }
      if (filters?.billingState && filters.billingState.length > 0) {
        query = query.in("billing_state", filters.billingState);
      }
      if (filters?.verified === "true") {
        query = query.eq("verified", true);
      } else if (filters?.verified === "false") {
        query = query.eq("verified", false);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Account[];

      // "Last Touch" + "Primary Contact" for just the visible page — scoped to
      // these ids so we never aggregate the whole activities/contacts table on
      // every render (same pattern as useOpportunities' last-touch hydration
      // and the Partners "Last Contact" column). Neither query below checks
      // `error` — that's deliberate: v_account_last_activity may not exist
      // yet on every environment, and a missing view/join must leave the
      // columns blank instead of breaking the whole list.
      const ids = rows.map((a) => a.id);
      if (ids.length > 0) {
        const { data: la } = await supabase
          .from("v_account_last_activity")
          .select("account_id, last_activity_at")
          .in("account_id", ids);
        const lastByAccount = new Map<string, string>();
        for (const r of la ?? []) {
          if (r.last_activity_at) {
            lastByAccount.set(r.account_id as string, r.last_activity_at as string);
          }
        }
        for (const a of rows) a.last_activity_at = lastByAccount.get(a.id) ?? null;

        const { data: pc } = await supabase
          .from("contacts")
          .select("id, first_name, last_name, account_id")
          .in("account_id", ids)
          .eq("is_primary", true)
          .is("archived_at", null);
        const primaryByAccount = new Map<string, { id: string; first_name: string; last_name: string }>();
        for (const c of pc ?? []) {
          if (c.account_id) {
            primaryByAccount.set(c.account_id as string, {
              id: c.id as string,
              first_name: c.first_name as string,
              last_name: c.last_name as string,
            });
          }
        }
        for (const a of rows) a.primary_contact = primaryByAccount.get(a.id) ?? null;
      }

      return { data: rows, count: count ?? 0 };
    },
  });
}

/**
 * Distinct billing/mailing states present in the data, with counts — powers
 * the "State" filter dropdown on the Accounts and Contacts lists. Derived
 * from real values (not a fixed 50-state list) so the dropdown matches the
 * migrated data exactly and only offers states that actually have records.
 */
export function useStatesInUse(entity: "accounts" | "contacts") {
  return useQuery({
    queryKey: ["states_in_use", entity],
    // States change rarely; keep them cached across list interactions.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_states_in_use", {
        p_entity: entity,
      });
      if (error) throw error;
      return (data ?? []) as { state: string; n: number }[];
    },
  });
}

export function useAccount(id: string | undefined) {
  return useQuery({
    queryKey: ["accounts", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing account ID");
      const { data, error } = await supabase
        .from("accounts")
        .select("*, owner:user_profiles!owner_user_id(id, full_name), creator:user_profiles!created_by(id, full_name), updater:user_profiles!updated_by(id, full_name), parent_account:accounts!parent_account_id(id, name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Account;
    },
    enabled: !!id,
  });
}

export function useCreateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Account>) => {
      const { data, error } = await supabase
        .from("accounts")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useUpdateAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Account> & { id: string }) => {
      const { data, error } = await supabase
        .from("accounts")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts", vars.id] });
    },
  });
}

export function useBulkDeleteAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from("accounts").delete().in("id", batch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useArchiveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("archive_record", {
        target_table: "accounts",
        target_id: id,
        reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      // Opp-detail and account contact panels read account-contacts; refresh
      // so an archived account's related lists don't show stale rows.
      qc.invalidateQueries({ queryKey: ["account-contacts"] });
    },
  });
}

/**
 * Hard-delete an account. Admin-only. Mirrors useDeleteOpportunity:
 * prefer Archive for "I might want this back" — Delete is irreversible
 * and cascades through related records via existing FK on-delete
 * rules.
 */
export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.from("accounts").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["account-contacts"] });
    },
  });
}

/**
 * Clear a manual Customer Status override so the account goes back to fully
 * automatic (derived from deal history). The override is normally set by the
 * closed-lost "still a client?" prompt; this is the undo. Server-side the RPC
 * requires a CRM write role.
 */
export function useClearCustomerStatusOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await supabase.rpc("set_account_customer_status_override", {
        p_account_id: accountId,
        p_override: null,
        p_reason: null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, accountId) => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["accounts", accountId] });
    },
  });
}

export function useAccountContracts(accountId: string | undefined) {
  return useQuery({
    queryKey: ["account_contracts", accountId],
    queryFn: async () => {
      if (!accountId) throw new Error("Missing account ID");
      const { data, error } = await supabase
        .from("account_contracts")
        .select("*")
        .eq("account_id", accountId)
        .order("contract_year", { ascending: false });
      if (error) throw error;
      return data as AccountContract[];
    },
    enabled: !!accountId,
  });
}

export function useBulkUpdateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, owner_user_id }: { ids: string[]; owner_user_id: string }) => {
      // One bulk UPDATE per chunk, then verify the affected-row count. A
      // per-row RLS denial or missing id doesn't throw — PostgREST just
      // doesn't match the row — so the old Promise.all(per-row) reported
      // success even when nothing changed. Compare returned ids to catch it.
      // De-dup first: the verify compares DISTINCT rows updated against the
      // input length, so a duplicate id would otherwise look like a failure.
      const uniqueIds = Array.from(new Set(ids));
      const CHUNK = 100;
      let updated = 0;
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const batch = uniqueIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("accounts")
          .update({ owner_user_id })
          .in("id", batch)
          .select("id");
        if (error) throw error;
        updated += (data ?? []).length;
      }
      if (updated < uniqueIds.length) {
        throw new Error(
          `Reassigned ${updated} of ${uniqueIds.length}. ${uniqueIds.length - updated} could not be updated (permission denied or no longer exist).`
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useAccountsList() {
  return useQuery({
    queryKey: ["accounts_list"],
    queryFn: async () => {
      // Page through ALL non-archived accounts. PostgREST caps a
      // single response at 1000 rows by default, so without explicit
      // pagination the dropdown only shows ~A through (somewhere
      // before the rest of the alphabet). Loop until we've fetched
      // every page.
      const PAGE = 1000;
      const all: { id: string; name: string }[] = [];
      let page = 0;
      // Hard cap to avoid runaway loops (10k accounts = 10 round trips).
      while (page < 20) {
        const from = page * PAGE;
        const to = from + PAGE - 1;
        const { data, error } = await supabase
          .from("accounts")
          .select("id, name")
          .is("archived_at", null)
          .order("name")
          .range(from, to);
        if (error) throw error;
        const rows = (data ?? []) as { id: string; name: string }[];
        all.push(...rows);
        if (rows.length < PAGE) break;
        page += 1;
      }
      return all;
    },
  });
}

export function useUsers(includeInactive = false) {
  return useQuery({
    queryKey: ["users", { includeInactive }],
    queryFn: async () => {
      let query = supabase
        .from("user_profiles")
        .select("*")
        .order("full_name");
      if (!includeInactive) {
        query = query.eq("is_active", true);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });
}
