import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  PipelineView,
  ActivePipelineRow,
  OpportunityStage,
} from "@/types/crm";

export function usePipelineViews() {
  return useQuery({
    queryKey: ["pipeline_views"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_views")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as PipelineView[];
    },
  });
}

export function useCreatePipelineView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      values: Pick<PipelineView, "name" | "is_shared" | "config">
    ) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("pipeline_views")
        .insert({
          name: values.name,
          is_shared: values.is_shared,
          config: values.config,
          owner_user_id: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PipelineView;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_views"] });
    },
  });
}

export function useUpdatePipelineView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: Partial<Pick<PipelineView, "name" | "is_shared" | "config">> & {
      id: string;
    }) => {
      const { data, error } = await supabase
        .from("pipeline_views")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as PipelineView;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_views"] });
    },
  });
}

export function useDeletePipelineView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pipeline_views")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pipeline_views"] });
    },
  });
}

interface CustomPipelineFilters {
  stages: OpportunityStage[];
  team_filter?: string;
  kind_filter?: string;
  owner_user_id?: string;
}

export function useCustomPipeline(filters: CustomPipelineFilters) {
  return useQuery({
    queryKey: ["pipeline", "custom", filters],
    queryFn: async () => {
      let query = supabase
        .from("opportunities")
        .select(
          "id, name, team, kind, stage, amount, expected_close_date, owner_user_id, account_id, account:accounts!account_id(name)"
        )
        .is("archived_at", null)
        .in("stage", filters.stages);

      if (filters.team_filter) {
        query = query.eq("team", filters.team_filter);
      }
      if (filters.kind_filter) {
        query = query.eq("kind", filters.kind_filter);
      }
      if (filters.owner_user_id) {
        query = query.eq("owner_user_id", filters.owner_user_id);
      }

      const { data, error } = await query.order("amount", {
        ascending: false,
      });
      if (error) throw error;

      return (data as Array<Record<string, unknown>>).map((row) => ({
        id: row.id as string,
        name: row.name as string,
        team: row.team as string,
        kind: row.kind as string,
        stage: row.stage as OpportunityStage,
        amount: row.amount as number,
        expected_close_date: row.expected_close_date as string | null,
        owner_user_id: row.owner_user_id as string | null,
        account_id: row.account_id as string,
        account_name: (row.account as { name: string } | null)?.name ?? "",
      })) as ActivePipelineRow[];
    },
    enabled: filters.stages.length > 0,
  });
}
