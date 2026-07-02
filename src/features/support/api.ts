import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { SupportConversation, SupportMessage } from "./types";

// Meddy Support (platform Coach escalations) — data layer.
//
// Reads go straight to the support_* tables (staff-read RLS). ALL writes go
// through the SECURITY DEFINER RPCs from 20260701000001 so takeover stays
// atomic and ownership rules are enforced server-side. Realtime is
// postgres_changes on the two tables (they're in the supabase_realtime
// publication) — no broadcast channels needed because the platform Coach
// POLLS the meddy-support edge function; only this console needs push.

// NOTE: the per-alias filters below (.eq("last.is_internal", …) etc.) are
// scoped to the "last" alias only — the msg_count embed of the same table
// counts ALL rows and must not pick up those filters.
const CONV_SELECT =
  "*, assigned:user_profiles!assigned_to(id, full_name), last:support_messages(content, role, created_at), msg_count:support_messages(count)";

export function useSupportConversations() {
  return useQuery({
    queryKey: ["support-conversations"],
    // 30s poll as a safety net behind realtime (mirrors the meddy console).
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_conversations")
        .select(CONV_SELECT)
        // Preview = the latest REAL chat line: skip internal notes and
        // system control rows (agent_joined / handed_back / …), which
        // otherwise show raw codes in the sidebar.
        .eq("last.is_internal", false)
        .neq("last.role", "system")
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false, referencedTable: "last" })
        .limit(1, { referencedTable: "last" })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as unknown as SupportConversation[];
    },
  });
}

/** Single-conversation fetch — deep-link fallback when the id isn't in
 * the (top-200) list query, e.g. an old notification link. */
export function useSupportConversation(id: string | null) {
  return useQuery({
    queryKey: ["support-conversation", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_conversations")
        .select(CONV_SELECT)
        .eq("last.is_internal", false)
        .neq("last.role", "system")
        .order("created_at", { ascending: false, referencedTable: "last" })
        .limit(1, { referencedTable: "last" })
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as SupportConversation | null;
    },
  });
}

export function useSupportMessages(conversationId: string | null) {
  return useQuery({
    queryKey: ["support-messages", conversationId],
    enabled: !!conversationId,
    // Fallback behind realtime: a silently dropped socket must not freeze
    // an open transcript mid-conversation.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SupportMessage[];
    },
  });
}

/** Live updates: any change to conversations/messages refreshes the console.
 * onCustomerMessage fires per incoming CUSTOMER message (unread dots). */
export function useSupportRealtime(onCustomerMessage?: (conversationId: string) => void) {
  const qc = useQueryClient();
  // Ref so the subscription binds once but always calls the fresh callback.
  const cbRef = useRef(onCustomerMessage);
  cbRef.current = onCustomerMessage;
  useEffect(() => {
    const channel = supabase
      .channel("support:console")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_conversations" },
        () => {
          qc.invalidateQueries({ queryKey: ["support-conversations"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages" },
        (payload) => {
          const row = payload.new as { conversation_id?: string; role?: string };
          if (row?.conversation_id) {
            qc.invalidateQueries({ queryKey: ["support-messages", row.conversation_id] });
            if (row.role === "customer") cbRef.current?.(row.conversation_id);
          }
          qc.invalidateQueries({ queryKey: ["support-conversations"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

function useSupportRpc(
  fn: string,
  successMsg: string | null,
  errPrefix: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: Record<string, unknown>) => {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ["support-conversations"] });
      const convId = args?.p_conversation_id;
      if (convId) qc.invalidateQueries({ queryKey: ["support-messages", convId] });
      if (successMsg) toast.success(successMsg);
    },
    onError: (e) => toast.error(`${errPrefix}: ${(e as Error).message}`),
  });
}

/** Atomic claim. Returns false (with a toast) if a teammate beat you to it. */
export function useTakeOverSupport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string }) => {
      const { data, error } = await supabase.rpc("support_claim_conversation", {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: (claimed, vars) => {
      qc.invalidateQueries({ queryKey: ["support-conversations"] });
      qc.invalidateQueries({ queryKey: ["support-messages", vars.conversationId] });
      if (claimed) toast.success("You're driving — the AI is muted until you hand back.");
      else toast.info("Already taken over by another agent.");
    },
    onError: (e) => toast.error("Couldn't take over: " + (e as Error).message),
  });
}

export function useHandBackSupport() {
  const m = useSupportRpc("support_hand_back", "Handed back to Meddy — the AI resumes on the customer's next message.", "Couldn't hand back");
  return {
    ...m,
    handBack: (conversationId: string) => m.mutate({ p_conversation_id: conversationId }),
  };
}

export function useSendSupportMessage() {
  const m = useSupportRpc("support_send_agent_message", null, "Couldn't send");
  return {
    ...m,
    send: (conversationId: string, content: string, internal = false) =>
      m.mutateAsync({ p_conversation_id: conversationId, p_content: content, p_internal: internal }),
  };
}

export function useCloseSupport() {
  const m = useSupportRpc("support_close_conversation", "Chat ended.", "Couldn't end chat");
  return {
    ...m,
    close: (conversationId: string) => m.mutate({ p_conversation_id: conversationId }),
  };
}
