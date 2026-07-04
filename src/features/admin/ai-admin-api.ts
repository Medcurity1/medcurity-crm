import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The nine read-only capabilities the Ask AI assistant can be granted. These
 * names MUST stay in sync with the ai_settings.enabled_capabilities defaults in
 * supabase/migrations/20260704000000_ask_ai.sql and the edge-function tool
 * allowlist.
 */
export type AiCapability =
  | "search_accounts"
  | "get_account"
  | "search_contacts"
  | "get_contact"
  | "search_opportunities"
  | "pipeline_summary"
  | "list_renewals"
  | "list_my_tasks"
  | "how_do_i";

export const AI_CAPABILITIES: AiCapability[] = [
  "search_accounts",
  "get_account",
  "search_contacts",
  "get_contact",
  "search_opportunities",
  "pipeline_summary",
  "list_renewals",
  "list_my_tasks",
  "how_do_i",
];

/** Model choices offered in the admin panel. */
export type AiModel =
  | "claude-sonnet-5"
  | "claude-haiku-4-5-20251001"
  | "claude-opus-4-8";

export interface AiSettings {
  id: boolean;
  enabled_capabilities: string[];
  rate_limit_per_hour: number;
  model: string;
  updated_at: string;
  updated_by: string | null;
}

export type AiSettingsUpdate = Partial<
  Pick<AiSettings, "enabled_capabilities" | "rate_limit_per_hour" | "model">
>;

export interface AiQueryLogRow {
  id: number;
  user_id: string;
  question: string;
  tools_called: string[];
  answer_chars: number;
  ok: boolean;
  created_at: string;
  asker_name: string | null;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/** Read the singleton ai_settings row (id = true). */
export function useAiSettings() {
  return useQuery({
    queryKey: ["ai_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_settings")
        .select("*")
        .eq("id", true)
        .single();
      if (error) throw error;
      return data as AiSettings;
    },
  });
}

/**
 * Update the ai_settings singleton. Stamps updated_by/updated_at, toasts on
 * success/error, and invalidates the cache.
 */
export function useUpdateAiSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: AiSettingsUpdate) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("ai_settings")
        .update({
          ...values,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", true)
        .select()
        .single();
      if (error) throw error;
      return data as AiSettings;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai_settings"] });
      toast.success("Ask AI settings saved");
    },
    onError: (err: Error) => {
      toast.error("Failed to save settings", { description: err.message });
    },
  });
}

/**
 * Read the most recent ai_query_log rows, joined to user_profiles for the
 * asker's display name. Admins see everyone; RLS scopes non-admins to their own.
 */
export function useRecentAiQueries(limit = 20) {
  return useQuery({
    queryKey: ["ai_query_log", limit],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_query_log")
        .select(
          "id, user_id, question, tools_called, answer_chars, ok, created_at, asker:user_profiles!user_id(full_name)"
        )
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((row) => {
        // Supabase types embedded relations as an array; the FK is 1:1 so we
        // read the first (and only) row.
        const asker = row.asker as
          | { full_name: string | null }
          | { full_name: string | null }[]
          | null;
        const askerName = Array.isArray(asker)
          ? (asker[0]?.full_name ?? null)
          : (asker?.full_name ?? null);
        return {
          id: row.id,
          user_id: row.user_id,
          question: row.question,
          tools_called: row.tools_called ?? [],
          answer_chars: row.answer_chars,
          ok: row.ok,
          created_at: row.created_at,
          asker_name: askerName,
        } as AiQueryLogRow;
      });
    },
  });
}
