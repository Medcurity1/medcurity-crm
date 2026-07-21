import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { DEFAULT_DURATIONS, useNotifPrefs } from "@/features/notifications/prefs-api";
import {
  durationTypeFromSeconds,
  playScheduled,
  resolveNotifSound,
} from "@/lib/notification-sounds";
import { celebrateHighFive } from "@/lib/confetti";

/**
 * The notification delivery engine — banners, sounds, and OS
 * notifications, gated by per-user preferences from My Settings →
 * Notifications. Ports the battle-tested Nexus pipeline (research:
 * PULSE-GAME-PLAN/meddy-port/04-notify-availability.md §2.5):
 *
 *  - Realtime postgres_changes INSERT on the user's notifications rows
 *    gives instant delivery; the 30s poll stays as the fallback path.
 *    Both feed one deliver() gate deduped by id, so nothing fires twice.
 *  - Per-type prefs: `<key>` (banner), `sound_<key>`, `soundtype_<key>`,
 *    `duration_<key>`. Unset = enabled (`!== false`), Nexus semantics.
 *  - Prefs not loaded yet → badge updates only, no banner/sound (the
 *    Nexus "don't default to enabled" fix).
 *  - Hidden tab → OS notification only; foreground → sound + toast +
 *    OS notification (shared tag so the OS dedupes).
 *  - Multi-tab dedup via BroadcastChannel("pulse-notif-dedup").
 *  - Agent ding: a visitor message in a conversation this agent has
 *    joined chimes anywhere in the app unless they're viewing it.
 */
interface NotificationRow {
  id: string;
  type?: string | null;
  title: string;
  message: string | null;
  link: string | null;
  conversation_id?: string | null;
  created_at: string;
}

const URGENT_TYPES = new Set([
  "meddy_human_requested",
  "meddy_missed_chat",
  // Platform (Meddy Support) escalations are just as urgent as website ones.
  "support_human_requested",
]);

// Bound the dedup memory: this hook lives for the whole signed-in session, so an
// always-open multi-day tab would otherwise grow seenIds forever. Keep only the
// most recent ids — far more than any realistic backlog of unread notifications.
const MAX_SEEN_IDS = 500;
function rememberSeen(set: Set<string>, id: string) {
  set.add(id);
  while (set.size > MAX_SEEN_IDS) {
    // Set preserves insertion order, so values().next() is the oldest entry.
    set.delete(set.values().next().value as string);
  }
}

function showOsNotification(title: string, body: string, tag: string, urgent: boolean) {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    new Notification(title, { body, tag, requireInteraction: urgent, silent: false });
  } catch {
    // some browsers require a service worker — in-app toast still covers it
  }
}

export function useNotificationToasts() {
  const { user } = useAuth();
  const location = useLocation();
  const qc = useQueryClient();
  const primed = useRef(false);
  const seenIds = useRef<Set<string>>(new Set());

  // Prefs live in a ref so the realtime/poll closures always read fresh.
  const { data: prefsData } = useNotifPrefs();
  const prefsRef = useRef<Record<string, unknown> | null>(null);
  useEffect(() => {
    prefsRef.current = prefsData ? prefsData.prefs : null;
  }, [prefsData]);

  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    // Cross-tab dedup: another tab already banner'd this id.
    const dedupChannel =
      "BroadcastChannel" in window ? new BroadcastChannel("pulse-notif-dedup") : null;
    if (dedupChannel) {
      dedupChannel.onmessage = (e) => {
        if (e.data?.id) rememberSeen(seenIds.current, String(e.data.id));
      };
    }

    function deliver(n: NotificationRow) {
      if (seenIds.current.has(n.id)) return;
      rememberSeen(seenIds.current, n.id);
      dedupChannel?.postMessage({ id: n.id });

      // High-fives are pure delight: confetti rains + ONE short chime + a quick
      // toast naming who. Never a bell entry, OS notification, or the long
      // meddy-style alert. Fires anywhere in the app (this hook is app-wide).
      if (n.type === "deal_high_five") {
        celebrateHighFive();
        const hfPrefs = prefsRef.current;
        if (!hfPrefs || hfPrefs["sound_deal_high_five"] !== false) {
          playScheduled(
            resolveNotifSound(
              "deal_high_five",
              hfPrefs?.["soundtype_deal_high_five"] as string | undefined,
            ),
            "short", // one short play — never the looping/long alert
          );
        }
        toast("🎉 " + (n.message ?? n.title ?? "You got a high-five!"), {
          duration: 5000,
        });
        // Keep it out of the bell entirely — mark read, then refresh counts.
        supabase
          .from("notifications")
          .update({ is_read: true })
          .eq("id", n.id)
          .then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));
        return;
      }

      qc.invalidateQueries({ queryKey: ["notifications"] });

      const prefs = prefsRef.current;
      if (!prefs) return; // prefs not loaded — badge only, don't default to enabled

      const key = n.type ?? "system";
      const bannerOn = prefs[key] !== false;
      const soundOn = prefs[`sound_${key}`] !== false;
      const urgent = URGENT_TYPES.has(key);
      const link =
        n.conversation_id && key.startsWith("meddy_")
          ? `/meddy?conversation=${n.conversation_id}`
          : n.conversation_id && key.startsWith("support_")
            ? `/support?conversation=${n.conversation_id}`
            : n.link;

      if (document.hidden) {
        if (bannerOn || soundOn) {
          showOsNotification(n.title, n.message ?? "", `pulse-${n.id}`, urgent);
        }
        return;
      }
      const durVal = Number(prefs[`duration_${key}`] ?? DEFAULT_DURATIONS[key] ?? 5);
      if (soundOn) {
        // resolveNotifSound retires old saved sound names the same way the
        // settings picker does, so what plays always matches what's shown.
        playScheduled(
          resolveNotifSound(key, prefs[`soundtype_${key}`] as string | undefined),
          durationTypeFromSeconds(durVal),
        );
      }
      if (bannerOn) {
        toast(n.title, {
          description: n.message ?? undefined,
          duration: (durVal > 0 ? durVal : 2) * 1000,
          action: link
            ? {
                label: "Open",
                onClick: () => {
                  window.location.href = link;
                },
              }
            : undefined,
        });
        showOsNotification(n.title, n.message ?? "", `pulse-${n.id}`, urgent);
      }
    }

    async function prime() {
      // Record current unread ids as "already seen" so only notifications
      // created AFTER this moment fire banners.
      const { data } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", user!.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(50);
      for (const r of data ?? []) rememberSeen(seenIds.current, r.id);
      primed.current = true;
    }

    async function tick() {
      if (!primed.current || cancelled) return;
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, title, message, link, conversation_id, created_at")
        .eq("user_id", user!.id)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error || cancelled) return;
      for (const n of ((data ?? []) as NotificationRow[]).reverse()) deliver(n);
    }

    // Realtime: instant delivery on INSERT (poll remains the fallback).
    const notifChannel = supabase
      .channel(`pulse-notifs:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (primed.current && !cancelled) deliver(payload.new as NotificationRow);
        },
      )
      .subscribe();

    // Agent ding: visitor message in a conversation this agent joined →
    // short chime + 3s toast unless they're viewing that conversation
    // (Nexus index.html:12250-12266; gated on meddy_new_chat prefs).
    const dingChannel = supabase
      .channel(`pulse-meddy-ding:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "meddy_messages" },
        async (payload) => {
          if (cancelled) return;
          const m = payload.new as {
            conversation_id: string;
            role: string;
            content: string;
          };
          if (m.role !== "visitor") return;
          const loc = locationRef.current;
          const viewing =
            loc.pathname.startsWith("/meddy") &&
            new URLSearchParams(loc.search).get("conversation") === m.conversation_id &&
            !document.hidden;
          if (viewing) return;
          const prefs = prefsRef.current;
          if (!prefs || prefs["meddy_new_chat"] === false) return;
          const { data: member } = await supabase
            .from("meddy_conversation_agents")
            .select("user_id")
            .eq("conversation_id", m.conversation_id)
            .eq("user_id", user!.id)
            .maybeSingle();
          if (!member || cancelled) return;
          if (document.hidden) {
            showOsNotification(
              "New message from visitor",
              m.content.slice(0, 120),
              `pulse-meddy-msg-${m.conversation_id}`,
              false,
            );
          } else {
            if (prefs["sound_meddy_new_chat"] !== false) {
              playScheduled(
                resolveNotifSound(
                  "meddy_new_chat",
                  prefs["soundtype_meddy_new_chat"] as string | undefined,
                ),
                "short",
              );
            }
            toast("New visitor message", {
              description: m.content.slice(0, 120),
              duration: 3000,
              action: {
                label: "Open",
                onClick: () => {
                  window.location.href = `/meddy?conversation=${m.conversation_id}`;
                },
              },
            });
          }
        },
      )
      .subscribe();

    void prime();
    const interval = window.setInterval(tick, 30_000);
    const initial = window.setTimeout(tick, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(initial);
      dedupChannel?.close();
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(dingChannel);
    };
  }, [user?.id, qc]);
}
