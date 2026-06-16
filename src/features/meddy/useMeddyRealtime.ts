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

  // Heartbeat while the Meddy tab is mounted.
  useEffect(() => {
    let cancelled = false;
    const beat = () => {
      staffAction("heartbeat")
        .then(() => {
          if (!cancelled) {
            qc.invalidateQueries({ queryKey: ["meddy-team"] });
            if (qc.isMutating({ mutationKey: ["meddy-set-availability"] }) === 0) {
              qc.invalidateQueries({ queryKey: ["meddy-availability"] });
            }
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

  // Live presence: the sturdy "who's online" signal.
  //
  // Each open Meddy tab rides a websocket presence channel. The server fires a
  // `leave` within seconds when an agent's LAST tab drops off (closed tab,
  // laptop sleep, lost network) — far faster than the 60s heartbeat going
  // stale and the 2-min sweep noticing. A still-connected teammate reacts to
  // that leave by marking the departed agent away (peer_offline). The heartbeat
  // + sweep above stay as the fallback for the case where the departing tab is
  // the only one open (nobody left to notice) or a deeply frozen tab.
  useEffect(() => {
    let cancelled = false;
    let myId: string | null = null;
    // Who we currently believe is present, so we can spot who dropped off.
    let present = new Set<string>();

    const presence = supabase.channel("meddy:presence");

    const reconcile = () => {
      if (cancelled) return;
      const state = presence.presenceState() as Record<
        string,
        Array<{ user_id?: string }>
      >;
      const now = new Set<string>();
      for (const entries of Object.values(state)) {
        for (const e of entries) if (e.user_id) now.add(e.user_id);
      }
      // Anyone who was here and is now gone (and isn't us) dropped off — mark
      // them away fast. Redundant calls from multiple peers are harmless (the
      // server only flips a still-Available row, then no-ops).
      for (const uid of present) {
        if (!now.has(uid) && uid !== myId) {
          staffAction("peer_offline", { user_id: uid }).catch(() => {});
        }
      }
      present = now;
      qc.invalidateQueries({ queryKey: ["meddy-team"] });
    };

    presence
      .on("presence", { event: "sync" }, reconcile)
      .on("presence", { event: "join" }, reconcile)
      .on("presence", { event: "leave" }, reconcile);

    supabase.auth.getUser().then(({ data }) => {
      if (cancelled) return;
      myId = data.user?.id ?? null;
      if (!myId) return;
      presence.subscribe((status) => {
        if (status === "SUBSCRIBED" && myId) {
          void presence.track({ user_id: myId });
          // Re-affirm Available immediately on (re)connect so a brief network
          // blip that dropped us from presence doesn't leave us stale.
          staffAction("heartbeat").catch(() => {});
        }
      });
    });

    return () => {
      cancelled = true;
      supabase.removeChannel(presence);
    };
  }, [qc]);
}
