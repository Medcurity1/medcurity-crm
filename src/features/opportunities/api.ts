import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Opportunity, ActivePipelineRow, OpportunityStageHistory, OpportunityProduct } from "@/types/crm";

interface OppFilters {
  search?: string;
  stage?: string;
  team?: string;
  kind?: string;
  account_id?: string;
  page?: number;
  pageSize?: number;
}

export function useOpportunities(filters?: OppFilters) {
  return useQuery({
    queryKey: ["opportunities", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;
      let query = supabase
        .from("opportunities")
        .select("*, account:accounts!account_id(id, name), owner:user_profiles!owner_user_id(id, full_name)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (filters?.search) {
        query = query.ilike("name", `%${filters.search}%`);
      }
      if (filters?.stage) query = query.eq("stage", filters.stage);
      if (filters?.team) query = query.eq("team", filters.team);
      if (filters?.kind) query = query.eq("kind", filters.kind);
      if (filters?.account_id) query = query.eq("account_id", filters.account_id);

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data as Opportunity[], count: count ?? 0 };
    },
  });
}

export function useOpportunity(id: string | undefined) {
  return useQuery({
    queryKey: ["opportunities", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing opportunity ID");
      const { data, error } = await supabase
        .from("opportunities")
        .select("*, account:accounts!account_id(id, name, fte_range, fte_count, lead_source, partner_account), owner:user_profiles!owner_user_id(id, full_name), primary_contact:contacts!primary_contact_id(id, first_name, last_name), assigned_assessor:user_profiles!assigned_assessor_id(id, full_name), original_sales_rep:user_profiles!original_sales_rep_id(id, full_name), creator:user_profiles!created_by(id, full_name), updater:user_profiles!updated_by(id, full_name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Opportunity;
    },
    enabled: !!id,
  });
}

export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Opportunity>) => {
      const { data, error } = await supabase
        .from("opportunities")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

export function useUpdateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Opportunity> & { id: string }) => {
      const { data, error } = await supabase
        .from("opportunities")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["opportunities", vars.id] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

export function useBulkUpdateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, owner_user_id }: { ids: string[]; owner_user_id: string }) => {
      const promises = ids.map((id) =>
        supabase.from("opportunities").update({ owner_user_id }).eq("id", id)
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

export function useBulkDeleteOpportunities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from("opportunities").delete().in("id", batch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}

export function useArchiveOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("archive_record", {
        target_table: "opportunities",
        target_id: id,
        reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

export function useActivePipeline(filters?: { team?: string; owner_user_id?: string }) {
  return useQuery({
    queryKey: ["pipeline", filters],
    queryFn: async () => {
      let query = supabase.from("active_pipeline").select("*");
      if (filters?.team) query = query.eq("team", filters.team);
      if (filters?.owner_user_id) query = query.eq("owner_user_id", filters.owner_user_id);
      const { data, error } = await query.order("amount", { ascending: false });
      if (error) throw error;
      return data as ActivePipelineRow[];
    },
  });
}

export function useStageHistory(opportunityId: string | undefined) {
  return useQuery({
    queryKey: ["stage_history", opportunityId],
    queryFn: async () => {
      if (!opportunityId) throw new Error("Missing opportunity ID");
      const { data, error } = await supabase
        .from("opportunity_stage_history")
        .select("*, changer:user_profiles!changed_by(full_name)")
        .eq("opportunity_id", opportunityId)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data as OpportunityStageHistory[];
    },
    enabled: !!opportunityId,
  });
}

export function useOpportunityProducts(opportunityId: string | undefined) {
  return useQuery({
    queryKey: ["opportunity_products", opportunityId],
    queryFn: async () => {
      if (!opportunityId) throw new Error("Missing opportunity ID");
      const { data, error } = await supabase
        .from("opportunity_products")
        .select("*, product:products!product_id(*)")
        .eq("opportunity_id", opportunityId);
      if (error) throw error;
      return data as OpportunityProduct[];
    },
    enabled: !!opportunityId,
  });
}

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useAddOpportunityProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { opportunity_id: string; product_id: string; quantity: number; unit_price: number; arr_amount: number }) => {
      const { data, error } = await supabase
        .from("opportunity_products")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["opportunity_products", vars.opportunity_id] });
    },
  });
}

export function useRemoveOpportunityProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, opportunityId }: { id: string; opportunityId: string }) => {
      const { error } = await supabase.from("opportunity_products").delete().eq("id", id);
      if (error) throw error;
      return opportunityId;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["opportunity_products", vars.opportunityId] });
    },
  });
}
