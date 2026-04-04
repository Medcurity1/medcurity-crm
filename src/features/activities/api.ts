import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Activity } from "@/types/crm";

interface ActivityFilters {
  account_id?: string;
  contact_id?: string;
  opportunity_id?: string;
}

export function useActivities(filters?: ActivityFilters) {
  return useQuery({
    queryKey: ["activities", filters],
    queryFn: async () => {
      let query = supabase
        .from("activities")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)")
        .order("created_at", { ascending: false });

      if (filters?.account_id) {
        query = query.eq("account_id", filters.account_id);
      }
      if (filters?.contact_id) {
        query = query.eq("contact_id", filters.contact_id);
      }
      if (filters?.opportunity_id) {
        query = query.eq("opportunity_id", filters.opportunity_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Activity[];
    },
    enabled:
      !!filters?.account_id ||
      !!filters?.contact_id ||
      !!filters?.opportunity_id,
  });
}

interface CreateActivityInput {
  account_id?: string | null;
  contact_id?: string | null;
  opportunity_id?: string | null;
  owner_user_id?: string | null;
  activity_type: string;
  subject: string;
  body?: string;
  due_at?: string | null;
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateActivityInput) => {
      const { data, error } = await supabase
        .from("activities")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useCompleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase
        .from("activities")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

interface TaskFilters {
  account_id?: string;
  contact_id?: string;
  opportunity_id?: string;
}

export function useTasks(filters: TaskFilters) {
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: async () => {
      let query = supabase
        .from("activities")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)")
        .eq("activity_type", "task")
        .order("due_at", { ascending: true, nullsFirst: false });

      if (filters.account_id) query = query.eq("account_id", filters.account_id);
      if (filters.contact_id) query = query.eq("contact_id", filters.contact_id);
      if (filters.opportunity_id) query = query.eq("opportunity_id", filters.opportunity_id);

      const { data, error } = await query;
      if (error) throw error;
      const all = data as Activity[];
      return {
        open: all.filter((t) => !t.completed_at),
        completed: all.filter((t) => !!t.completed_at),
      };
    },
    enabled:
      !!filters.account_id ||
      !!filters.contact_id ||
      !!filters.opportunity_id,
  });
}
