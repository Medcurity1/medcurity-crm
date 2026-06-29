// Meddy dashboard data layer. Reads go straight to Postgres (staff-read
// RLS); every conversation mutation goes through the meddy-staff-action
// edge function so takeover stays atomic and the widget gets its
// realtime broadcasts. Saved bookmarks are the one direct write (own-row
// RLS on meddy_saved_conversations).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import type {
  ConversationLists,
  MeddyConversation,
  MeddyMessage,
  MeddyUrlEntry,
  QuickReply,
  TeamMember,
} from "./types";

// Embeds: assigned agent name, latest message preview, message count, and the
// linked CRM account name (so staff see WHICH company is chatting without
// looking it up by ID — Rachel's request). The company comes via the linked
// contact's account; falls back to the visitor-typed company (see companyName()).
//
// Access note: this embeds contacts→accounts. Today the CRM read model is FLAT
// (contacts/accounts policy = "active rows visible to any authenticated user"),
// so embedding exposes nothing a staff user couldn't already read at /accounts.
// PostgREST does NOT re-apply embedded-table RLS row-by-row, so IF per-team or
// per-region read restrictions are ever added to contacts/accounts, this embed
// (and the Meddy read policy) must be revisited to avoid leaking restricted
// company names. Keep this in mind before tightening CRM read RLS.
const CONV_SELECT =
  "*, assigned:user_profiles!meddy_conversations_assigned_to_fkey(full_name), " +
  "crm_contact:contacts!crm_contact_id(account:accounts!account_id(id, name)), " +
  "last:meddy_messages(content, role, created_at, is_internal), " +
  "msg_count:meddy_messages(count)";

function applyConvEmbedOptions<
  T extends {
    order: (col: string, opts: Record<string, unknown>) => T;
    limit: (n: number, opts: Record<string, unknown>) => T;
    eq: (col: string, val: unknown) => T;
  },
>(q: T): T {
  return q
    .eq("last.is_internal", false) // previews never show whispers/alerts
    .order("created_at", { referencedTable: "last", ascending: false })
    .limit(1, { referencedTable: "last" });
}

/** All staff writes funnel through the meddy-staff-action edge function. */
export async function staffAction(
  action: string,
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("meddy-staff-action", {
    body: { action, ...body },
  });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        if (j?.error) msg = j.error;
      }
    } catch {
      // keep the generic message
    }
    throw new Error(msg);
  }
  return (data ?? {}) as Record<string, unknown>;
}

// ── Conversation lists (Active / Recent / Saved) ─────────────────────
// Nexus partition rules (server.js:5571-5572): Active = touched within
// 15 min and not closed; Recent = touched 15min-24h ago and open, OR
// closed within the last 24h; Saved = per-user bookmarks (any age).

export function useMeddyConversations() {
  const { user } = useAuth();
  return useQuery<ConversationLists>({
    queryKey: ["meddy-conversations", user?.id],
    enabled: !!user?.id,
    refetchInterval: 30_000, // safety net behind realtime
    queryFn: async () => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const recentQuery = applyConvEmbedOptions(
        supabase
          .from("meddy_conversations")
          .select(CONV_SELECT)
          .gte("updated_at", dayAgo)
          .order("updated_at", { ascending: false }),
      );

      const [{ data: dayRows, error: dayErr }, { data: savedRows, error: savedErr }] =
        await Promise.all([
          recentQuery,
          supabase
            .from("meddy_saved_conversations")
            .select("conversation_id")
            .eq("user_id", user!.id),
        ]);
      if (dayErr) throw dayErr;
      if (savedErr) throw savedErr;

      const savedIds = new Set((savedRows ?? []).map((r) => r.conversation_id as string));

      // Saved conversations can be older than 24h — fetch the missing ones.
      const have = new Set(
        ((dayRows ?? []) as unknown as MeddyConversation[]).map((r) => r.id),
      );
      const missingSaved = [...savedIds].filter((id) => !have.has(id));
      let savedExtra: MeddyConversation[] = [];
      if (missingSaved.length > 0) {
        const { data, error } = await applyConvEmbedOptions(
          supabase
            .from("meddy_conversations")
            .select(CONV_SELECT)
            .in("id", missingSaved)
            .order("updated_at", { ascending: false }),
        );
        if (error) throw error;
        savedExtra = (data ?? []) as unknown as MeddyConversation[];
      }

      const rows = (dayRows ?? []) as unknown as MeddyConversation[];
      const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
      const active = rows.filter(
        (c) => c.status !== "closed" && new Date(c.updated_at).getTime() >= fifteenMinAgo,
      );
      const recent = rows.filter(
        (c) => !(c.status !== "closed" && new Date(c.updated_at).getTime() >= fifteenMinAgo),
      );
      const byId = new Map(rows.map((c) => [c.id, c]));
      for (const c of savedExtra) byId.set(c.id, c);
      const saved = [...savedIds]
        .map((id) => byId.get(id))
        .filter((c): c is MeddyConversation => !!c)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

      return { active, recent, saved, savedIds };
    },
  });
}

/** Single conversation (deep links to ones outside the 24h window). */
export function useMeddyConversation(id: string | null) {
  return useQuery<MeddyConversation | null>({
    queryKey: ["meddy-conversation", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await applyConvEmbedOptions(
        supabase.from("meddy_conversations").select(CONV_SELECT).eq("id", id!),
      ).maybeSingle();
      if (error) throw error;
      return (data as unknown as MeddyConversation) ?? null;
    },
  });
}

// ── Messages / URL trail / membership for the selected conversation ──

export function useMeddyMessages(conversationId: string | null, enabled = true) {
  return useQuery<MeddyMessage[]>({
    queryKey: ["meddy-messages", conversationId],
    enabled: !!conversationId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meddy_messages")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MeddyMessage[];
    },
  });
}

export function useMeddyUrlHistory(conversationId: string | null, enabled = true) {
  return useQuery<MeddyUrlEntry[]>({
    queryKey: ["meddy-url-history", conversationId],
    enabled: !!conversationId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meddy_url_history")
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as MeddyUrlEntry[];
    },
  });
}

export function useConvAgents(conversationId: string | null) {
  return useQuery<string[]>({
    queryKey: ["meddy-conv-agents", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meddy_conversation_agents")
        .select("user_id")
        .eq("conversation_id", conversationId!);
      if (error) throw error;
      return (data ?? []).map((r) => r.user_id as string);
    },
  });
}

// ── Team availability ────────────────────────────────────────────────

export function useTeamStatus() {
  return useQuery<TeamMember[]>({
    queryKey: ["meddy-team"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("id, full_name, role, status:meddy_agent_status(available, last_seen)")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      const members = (data ?? []).map((r) => {
        const raw = r.status as
          | { available: boolean; last_seen: string | null }
          | { available: boolean; last_seen: string | null }[]
          | null;
        const status = Array.isArray(raw) ? raw[0] : raw;
        return {
          id: r.id as string,
          full_name: r.full_name as string | null,
          role: r.role as string,
          available: status?.available ?? false,
          last_seen: status?.last_seen ?? null,
        };
      });
      // Available first, then alphabetical (Nexus team-status ordering).
      return members.sort(
        (a, b) =>
          Number(b.available) - Number(a.available) ||
          (a.full_name ?? "").localeCompare(b.full_name ?? ""),
      );
    },
  });
}

export function useMyAvailability() {
  const { user } = useAuth();
  return useQuery<boolean>({
    queryKey: ["meddy-availability", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meddy_agent_status")
        .select("available")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.available ?? false;
    },
  });
}

export function useSetAvailability() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    // The key lets realtime/heartbeat invalidations skip while a toggle
    // is in flight (see useMeddyRealtime); scope serializes rapid
    // opposite clicks so the last click always wins server-side.
    mutationKey: ["meddy-set-availability"],
    scope: { id: "meddy-availability" },
    mutationFn: (available: boolean) => staffAction("availability", { available }),
    // Optimistic: flip the pill instantly, roll back if the server says no.
    onMutate: async (available) => {
      await qc.cancelQueries({ queryKey: ["meddy-availability", user?.id] });
      const previous = qc.getQueryData<boolean>(["meddy-availability", user?.id]);
      qc.setQueryData(["meddy-availability", user?.id], available);
      // Keep the Team panel's own row in step with the pill.
      qc.setQueryData<TeamMember[] | undefined>(["meddy-team"], (team) =>
        team?.map((m) => (m.id === user?.id ? { ...m, available } : m)),
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      qc.setQueryData(["meddy-availability", user?.id], context?.previous ?? false);
      toast.error((err as Error).message);
    },
    onSettled: () => {
      // Self-correcting on success too — never depend on the broadcast.
      qc.invalidateQueries({ queryKey: ["meddy-team"] });
      qc.invalidateQueries({ queryKey: ["meddy-availability", user?.id] });
    },
  });
}

// ── Quick replies ────────────────────────────────────────────────────

export const QUICK_REPLY_CATEGORY_ORDER = [
  "forms",
  "greeting",
  "sales",
  "support",
  "closing",
  "general",
];

export function useQuickReplies() {
  return useQuery<QuickReply[]>({
    queryKey: ["meddy-quick-replies"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meddy_quick_replies")
        .select("id, title, content, category")
        .order("category")
        .order("title");
      if (error) throw error;
      return (data ?? []) as QuickReply[];
    },
  });
}

// ── Mutations (all via meddy-staff-action) ───────────────────────────

function useConvAction(
  action: string,
  opts: { successToast?: string; extraKeys?: (convId: string) => unknown[][] } = {},
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { conversationId: string } & Record<string, unknown>) =>
      staffAction(action, vars),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["meddy-conversations"] });
      qc.invalidateQueries({ queryKey: ["meddy-conversation", vars.conversationId] });
      qc.invalidateQueries({ queryKey: ["meddy-messages", vars.conversationId] });
      qc.invalidateQueries({ queryKey: ["meddy-conv-agents", vars.conversationId] });
      for (const key of opts.extraKeys?.(vars.conversationId) ?? []) {
        qc.invalidateQueries({ queryKey: key });
      }
      if (opts.successToast) toast.success(opts.successToast);
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useSendStaffMessage() {
  return useConvAction("message");
}
export function useTakeover() {
  return useConvAction("takeover", { successToast: "You're handling this conversation" });
}
export function useJoinConversation() {
  return useConvAction("join", { successToast: "Joined the conversation" });
}
export function useCloseConversation() {
  return useConvAction("close", { successToast: "Conversation ended" });
}
export function useReopenConversation() {
  return useConvAction("reopen", { successToast: "Conversation reopened" });
}
export function useHideLead() {
  return useConvAction("hide_lead", {
    successToast: "Lead hidden",
    extraKeys: () => [["meddy-history"], ["meddy-stats"]],
  });
}

/** Star toggle — direct write, own-row RLS. Saving pins the conversation
 * past the retention purge (Nexus parity). */
export function useToggleSave() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      conversationId,
      save,
    }: {
      conversationId: string;
      save: boolean;
    }) => {
      if (save) {
        const { error } = await supabase
          .from("meddy_saved_conversations")
          .upsert(
            { user_id: user!.id, conversation_id: conversationId },
            { onConflict: "user_id,conversation_id", ignoreDuplicates: true },
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("meddy_saved_conversations")
          .delete()
          .eq("user_id", user!.id)
          .eq("conversation_id", conversationId);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["meddy-conversations"] });
      qc.invalidateQueries({ queryKey: ["meddy-saved-ids"] });
      qc.invalidateQueries({ queryKey: ["meddy-history"] });
      toast.success(vars.save ? "Conversation saved" : "Conversation unsaved");
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

// ── History tab ──────────────────────────────────────────────────────

export type HistoryFilter = "all" | "contact" | "today" | "week" | "takeover" | "saved";

export function useMeddyHistory(filter: HistoryFilter, search: string) {
  const { user } = useAuth();
  return useQuery<MeddyConversation[]>({
    queryKey: ["meddy-history", filter, search, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      let q = supabase.from("meddy_conversations").select(CONV_SELECT);

      // Nexus filter SQL (server.js:6191-6215) translated to PostgREST.
      if (filter === "contact") {
        q = q.not("visitor_email", "is", null).neq("visitor_email", "").eq("hidden_from_leads", false);
      } else if (filter === "today") {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        q = q.gte("created_at", start.toISOString());
      } else if (filter === "week") {
        q = q.gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
      } else if (filter === "takeover") {
        q = q.eq("is_human_takeover", true);
      } else if (filter === "saved") {
        const { data: savedRows, error: savedErr } = await supabase
          .from("meddy_saved_conversations")
          .select("conversation_id")
          .eq("user_id", user!.id);
        if (savedErr) throw savedErr;
        const ids = (savedRows ?? []).map((r) => r.conversation_id as string);
        if (ids.length === 0) return [];
        q = q.in("id", ids);
      }
      const s = search.trim();
      if (s) {
        // Escape LIKE wildcards so "_" and "%" match literally; strip the
        // characters PostgREST's or() syntax can't carry safely.
        const esc = s.replace(/[\\%_]/g, (ch) => `\\${ch}`).replace(/[,()]/g, "");
        q = q.or(`visitor_name.ilike.%${esc}%,visitor_email.ilike.%${esc}%`);
      }
      const { data, error } = await applyConvEmbedOptions(
        q.order("updated_at", { ascending: false }).limit(200),
      );
      if (error) throw error;
      return (data ?? []) as unknown as MeddyConversation[];
    },
  });
}

export function useSavedIds() {
  const { user } = useAuth();
  return useQuery<Set<string>>({
    queryKey: ["meddy-saved-ids"],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meddy_saved_conversations")
        .select("conversation_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.conversation_id as string));
    },
  });
}

export type MeddyStats = {
  conversations: number;
  messages: number;
  leads: number;
  takeovers: number;
};

export function useMeddyStats() {
  return useQuery<MeddyStats>({
    queryKey: ["meddy-stats"],
    queryFn: async () => {
      const [conv, msg, leads, takeovers] = await Promise.all([
        supabase.from("meddy_conversations").select("id", { count: "exact", head: true }),
        supabase.from("meddy_messages").select("id", { count: "exact", head: true }),
        supabase
          .from("meddy_conversations")
          .select("id", { count: "exact", head: true })
          .not("visitor_email", "is", null)
          .neq("visitor_email", "")
          .eq("hidden_from_leads", false),
        supabase
          .from("meddy_conversations")
          .select("id", { count: "exact", head: true })
          .eq("is_human_takeover", true),
      ]);
      for (const r of [conv, msg, leads, takeovers]) {
        if (r.error) throw r.error;
      }
      return {
        conversations: conv.count ?? 0,
        messages: msg.count ?? 0,
        leads: leads.count ?? 0,
        takeovers: takeovers.count ?? 0,
      };
    },
  });
}
