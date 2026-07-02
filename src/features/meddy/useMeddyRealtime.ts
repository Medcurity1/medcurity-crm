// Realtime plumbing for the Meddy DASHBOARD UI (the /meddy page only).
//
// One broadcast channel ("meddy:dashboard") carries every staff-facing event
// the edge functions emit (new messages, conversation updates, dings) and
// refreshes the dashboard's queries. This mounts only while viewing Meddy.
//
// Availability (the heartbeat + presence that keep a user "available" for
// website chats) is NOT here — it lives in useMeddyPresence, mounted app-wide
// in AppLayout so a user stays available while working anywhere in the CRM.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

type DashboardEvent = {
  conversationId?: string;
  role?: string;
  internal?: boolean;
  [key: string]: unknown;
};

type Handlers = {
  /** Visitor message arrived for a conversation (unread tracking). */
  onVisitorMessage?: (conversationId: string) => void;
  /** Ding for agents who joined a conversation (Phase E sound hook). */
  onChatMessageDing?: (conversationId: string, agentIds: string[]) => void;
};

export function useMeddyRealtime(handlers: Handlers = {}) {
  const qc = useQueryClient();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const invalidateLists = () => {
      qc.invalidateQueries({ queryKey: ["meddy-conversations"] });
      qc.invalidateQueries({ queryKey: ["meddy-history"] });
    };
    const invalidateConversation = (id?: string) => {
      if (!id) return;
      qc.invalidateQueries({ queryKey: ["meddy-messages", id] });
      qc.invalidateQueries({ queryKey: ["meddy-conversation", id] });
      qc.invalidateQueries({ queryKey: ["meddy-conv-agents", id] });
    };

    const channel = supabase.channel("meddy:dashboard", {
      // private: carries visitor message previews + staff names, so
      // subscribers must pass the realtime authorization policy (active
      // staff only — 20260702000005). The bare anon key can no longer
      // listen in.
      config: { broadcast: { self: false }, private: true },
    });

    channel
      .on("broadcast", { event: "new-message" }, ({ payload }) => {
        const p = (payload ?? {}) as DashboardEvent;
        invalidateConversation(p.conversationId);
        invalidateLists();
        if (p.role === "visitor" && p.conversationId) {
          handlersRef.current.onVisitorMessage?.(p.conversationId);
        }
      })
      .on("broadcast", { event: "chat_message_ding" }, ({ payload }) => {
        const p = (payload ?? {}) as { conversationId?: string; agentIds?: string[] };
        if (p.conversationId) {
          handlersRef.current.onChatMessageDing?.(p.conversationId, p.agentIds ?? []);
        }
      })
      .on("broadcast", { event: "team_status_changed" }, () => {
        qc.invalidateQueries({ queryKey: ["meddy-team"] });
        // Skip while our own toggle is mid-flight — a refetch here would
        // briefly snap the pill back to the old server value.
        if (qc.isMutating({ mutationKey: ["meddy-set-availability"] }) === 0) {
          qc.invalidateQueries({ queryKey: ["meddy-availability"] });
        }
      })
      .on("broadcast", { event: "visitor_url" }, ({ payload }) => {
        const p = (payload ?? {}) as DashboardEvent;
        if (p.conversationId) {
          qc.invalidateQueries({ queryKey: ["meddy-url-history", p.conversationId] });
          qc.invalidateQueries({ queryKey: ["meddy-conversation", p.conversationId] });
        }
        invalidateLists();
      });

    // Everything else just refreshes the lists + the touched conversation.
    const listEvents = [
      "new_conversation",
      "human_requested",
      "contact_submitted",
      "buying_intent",
      "missed_chat",
      "conversation_taken_over",
      "conversation_agents_updated",
      "conversation_closed",
      "conversation_reopened",
      "refresh",
    ];
    for (const event of listEvents) {
      channel.on("broadcast", { event }, ({ payload }) => {
        const p = (payload ?? {}) as DashboardEvent;
        invalidateConversation(p.conversationId);
        invalidateLists();
      });
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
