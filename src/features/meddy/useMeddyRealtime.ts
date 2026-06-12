// Realtime plumbing for the Meddy dashboard.
//
// One broadcast channel ("meddy:dashboard") carries every staff-facing
// event the edge functions emit (the Supabase replacement for Nexus's
// dashboard WebSocket). A 60s heartbeat keeps meddy_agent_status.last_seen
// fresh — the sweep marks agents away after 2 missed beats, and the beat
// flips Available back on after a reconnect unless the user chose Away
// (the away_manual design).

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { staffAction } from "./api";

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
      config: { broadcast: { self: false } },
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
        qc.invalidateQueries({ queryKey: ["meddy-availability"] });
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

  // Heartbeat while the Meddy tab is mounted.
  useEffect(() => {
    let cancelled = false;
    const beat = () => {
      staffAction("heartbeat")
        .then(() => {
          if (!cancelled) {
            qc.invalidateQueries({ queryKey: ["meddy-team"] });
            qc.invalidateQueries({ queryKey: ["meddy-availability"] });
          }
        })
        .catch(() => {
          // transient network errors are fine; the next beat retries
        });
    };
    beat();
    const interval = setInterval(beat, 60_000);
    const onVisible = () => {
      if (!document.hidden) beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qc]);
}
