import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Account, AccountContract } from "@/types/crm";

interface AccountFilters {
  search?: string;
  lifecycle_status?: string;
  status?: string;
  /** Filter to a specific owner's accounts. "mine" = current user. */
  ownerId?: string | "mine";
  /** Filter to a specific industry_category enum value. */
  industryCategory?: string;
  /** Filter to only verified or only unverified accounts. */
  verified?: "true" | "false";
  page?: number;
  pageSize?: number;
}

export function useAccounts(filters?: AccountFilters) {
  return useQuery({
    queryKey: ["accounts", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;
      let query = supabase
        .from("accounts")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "estimated" })
        .order("name")
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (filters?.search) {
        // Search covers name + free-text industry column. Note:
        // industry_category is an enum which PostgREST can't ilike; to
        // search by industry use the Industry dropdown filter instead.
        query = query.or(
          `name.ilike.%${filters.search}%,industry.ilike.%${filters.search}%`
        );
      }
      if (filters?.lifecycle_status) {
        query = query.eq("lifecycle_status", filters.lifecycle_status);
      }
      if (filters?.status) {
        query = query.eq("status", filters.status);
      }
      if (filters?.ownerId && filters.ownerId !== "mine") {
        query = query.eq("owner_user_id", filters.ownerId);
      } else if (filters?.ownerId === "mine") {
        // Resolve "mine" to current auth user id at query time.
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user?.id) {
          query = query.eq("owner_user_id", userData.user.id);
        }
      }
      if (filters?.industryCategory) {
        query = query.eq("industry_category", filters.industryCategory);
      }
      if (filters?.verified === "true") {
        query = query.eq("verified", true);
      } else if (filters?.verified === "false") {
        query = query.eq("verified", false);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data as Account[], count: count ?? 0 };
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
      const promises = ids.map((id) =>
        supabase.from("accounts").update({ owner_user_id }).eq("id", id)
      );
      await Promise.all(promises);
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
