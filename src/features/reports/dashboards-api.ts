import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Dashboard, DashboardLayoutWidget } from "@/types/crm";

/**
 * Dashboard CRUD. RLS-gated so each user only sees their own + public.
 */

export function useDashboards() {
  return useQuery({
    queryKey: ["dashboards"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dashboards")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Dashboard[];
    },
  });
}

export function useDashboard(id: string | undefined) {
  return useQuery({
    queryKey: ["dashboards", id],
    queryFn: async () => {
      if (!id) throw new Error("missing id");
      const { data, error } = await supabase
        .from("dashboards")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Dashboard;
    },
    enabled: !!id,
  });
}

export function useCreateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      name: string;
      description?: string | null;
      is_public?: boolean;
      layout?: DashboardLayoutWidget[];
    }) => {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("not signed in");
      const { data, error } = await supabase
        .from("dashboards")
        .insert({
          name: input.name,
          description: input.description ?? null,
          is_public: input.is_public ?? false,
          owner_user_id: user.id,
          layout: input.layout ?? [],
        })
        .select()
        .single();
      if (error) throw error;
      return data as Dashboard;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboards"] }),
  });
}

export function useUpdateDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: Partial<Dashboard> & { id: string }) => {
      const { data, error } = await supabase
        .from("dashboards")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Dashboard;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["dashboards"] });
      qc.invalidateQueries({ queryKey: ["dashboards", vars.id] });
    },
  });
}

export function useDeleteDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dashboards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboards"] }),
  });
}
