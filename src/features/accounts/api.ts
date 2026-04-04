import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Account, AccountContract } from "@/types/crm";

interface AccountFilters {
  search?: string;
  lifecycle_status?: string;
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
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "exact" })
        .order("name")
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (filters?.search) {
        query = query.ilike("name", `%${filters.search}%`);
      }
      if (filters?.lifecycle_status) {
        query = query.eq("lifecycle_status", filters.lifecycle_status);
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
        .select("*, owner:user_profiles!owner_user_id(id, full_name)")
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

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
}
