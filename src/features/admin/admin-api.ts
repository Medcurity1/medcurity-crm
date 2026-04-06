import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { CustomFieldDefinition, UserProfile } from "@/types/crm";

// ── Custom Field Definitions ──────────────────────────────────────

export function useCustomFieldDefinitions(entity: CustomFieldDefinition["entity"]) {
  return useQuery({
    queryKey: ["custom_field_definitions", entity],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_field_definitions")
        .select("*")
        .eq("entity", entity)
        .order("sort_order");
      if (error) throw error;
      return data as CustomFieldDefinition[];
    },
  });
}

export function useCreateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Omit<CustomFieldDefinition, "id" | "created_at" | "updated_at">) => {
      const { data, error } = await supabase
        .from("custom_field_definitions")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as CustomFieldDefinition;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["custom_field_definitions", vars.entity] });
    },
  });
}

export function useUpdateCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: Partial<CustomFieldDefinition> & { id: string }) => {
      const { data, error } = await supabase
        .from("custom_field_definitions")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as CustomFieldDefinition;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["custom_field_definitions"] });
      if (vars.entity) {
        qc.invalidateQueries({ queryKey: ["custom_field_definitions", vars.entity] });
      }
    },
  });
}

export function useDeleteCustomField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("custom_field_definitions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["custom_field_definitions"] });
    },
  });
}

// ── User Profiles ─────────────────────────────────────────────────

export function useAllUsers() {
  return useQuery({
    queryKey: ["admin_users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .order("full_name");
      if (error) throw error;
      return data as UserProfile[];
    },
  });
}

export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      email: string;
      password: string;
      full_name: string;
      role: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("invite-user", {
        body: payload,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; user: { id: string; email: string; full_name: string; role: string } };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_users"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useUpdateUserProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...values
    }: Partial<UserProfile> & { id: string }) => {
      const { data, error } = await supabase
        .from("user_profiles")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as UserProfile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin_users"] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}
