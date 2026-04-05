import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { EmailTemplate } from "@/types/crm";

export function useEmailTemplates() {
  return useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EmailTemplate[];
    },
  });
}

export function useEmailTemplate(id: string | undefined) {
  return useQuery({
    queryKey: ["email-templates", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as EmailTemplate;
    },
    enabled: !!id,
  });
}

export interface CreateEmailTemplateInput {
  name: string;
  subject: string;
  body: string;
  category?: string | null;
  is_shared?: boolean;
  owner_user_id: string;
}

export function useCreateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateEmailTemplateInput) => {
      const { data, error } = await supabase
        .from("email_templates")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data as EmailTemplate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
    },
  });
}

export interface UpdateEmailTemplateInput {
  id: string;
  name?: string;
  subject?: string;
  body?: string;
  category?: string | null;
  is_shared?: boolean;
}

export function useUpdateEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateEmailTemplateInput) => {
      const { data, error } = await supabase
        .from("email_templates")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as EmailTemplate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
    },
  });
}

export function useDeleteEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
    },
  });
}

export function useIncrementUsage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Read current value then increment (simple approach)
      const { data: current, error: readErr } = await supabase
        .from("email_templates")
        .select("usage_count")
        .eq("id", id)
        .single();
      if (readErr) throw readErr;
      const nextCount = (current?.usage_count ?? 0) + 1;
      const { error } = await supabase
        .from("email_templates")
        .update({ usage_count: nextCount })
        .eq("id", id);
      if (error) throw error;
      return nextCount;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["email-templates"] });
    },
  });
}
