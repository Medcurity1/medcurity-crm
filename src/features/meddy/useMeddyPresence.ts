// App-wide Meddy availability + presence.
//
// Mounted in the app shell (AppLayout), so it runs on EVERY CRM page — not just
// the Meddy tab. A signed-in user stays "available" for website chats while
// they work anywhere in the CRM (Accounts, Contacts, Home, wherever). They only
// become unavailable if they manually toggle Away (which sticks via
// away_manual) or their session ends (close the last tab / shut down / the 12h
// idle backstop).
//
// Previously this lived in useMeddyRealtime, which mounts only on /meddy, so
// people flipped to "away" the moment they navigated off the Meddy page. That
// was the bug Nathan caught: availability has to be site-wide.
//
// Two signals:
//   - a 60s heartbeat that keeps meddy_agent_status.last_seen fresh and flips
//     Available back on unless the user chose Away (away_manual);
//   - a websocket presence channel so a teammate marks someone away within
//     seconds of their last tab dropping off. The pg_cron sweep (every minute)
//     + heartbeat staleness are the dependable fallback.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { staffAction } from "./api";

export function useMeddyPresence(enabled: boolean) {
  const qc = useQueryClient();

  // 60s heartbeat — keeps the user "available" while the CRM is open anywhere.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const beat = () => {
      // Don't burn a heartbeat (auth.getUser round-trip + writes) on hidden/
      // background tabs. onVisible re-beats the instant the tab is foregrounded,
      // and the pg_cron sweep + presence channel cover a genuinely gone session.
      if (document.visibilityState !== "visible") return;
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
  }, [qc, enabled]);

  // Live presence: fast away-on-disconnect (closed tab / sleep / lost network).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let myId: string | null = null;
    // Who we currently believe is present, so we can spot who dropped off.
    let present = new Set<string>();
    // Pending "mark away" timers per user_id. We DEBOUNCE a presence `leave`:
    // wait ~12s and only mark the agent away if they're STILL gone. A brief
    // network flap rejoins within a second or two and cancels the timer, so a
    // healthy agent is never knocked out of routing.
    const pending = new Map<string, number>();

    const presence = supabase.channel("meddy:presence");

    const currentSet = () => {
      const state = presence.presenceState() as Record<
        string,
        Array<{ user_id?: string }>
      >;
      const s = new Set<string>();
      for (const entries of Object.values(state)) {
        for (const e of entries) if (e.user_id) s.add(e.user_id);
      }
      return s;
    };

    const reconcile = () => {
      if (cancelled) return;
      const now = currentSet();
      // Present again -> cancel any pending away timer (it was a flap).
      for (const uid of now) {
        const t = pending.get(uid);
        if (t !== undefined) {
          window.clearTimeout(t);
          pending.delete(uid);
        }
      }
      // Dropped off (and isn't us) -> schedule a debounced away mark.
      for (const uid of present) {
        if (!now.has(uid) && uid !== myId && !pending.has(uid)) {
          const t = window.setTimeout(() => {
            pending.delete(uid);
            if (cancelled) return;
            // Only if STILL gone right now. Redundant calls from multiple
            // peers are harmless (the server only flips a still-Available row).
            if (!currentSet().has(uid)) {
              staffAction("peer_offline", { user_id: uid }).catch(() => {});
            }
          }, 12_000);
          pending.set(uid, t);
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
      for (const t of pending.values()) window.clearTimeout(t);
      pending.clear();
      supabase.removeChannel(presence);
    };
  }, [qc, enabled]);
}
