import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  markSharedActivity,
  lastSharedActivityMs,
  idleDeferralMs,
} from "@/lib/sharedActivity";

/**
 * Idle timeout + auto sign-out.
 *
 * Tracks user activity (mouse, keyboard, touch, focus) and after `idleMs` of
 * no activity, shows a warning. After `warnMs` more of no activity, signs
 * the user out via Supabase auth.
 *
 * Any real activity resets the timers. The warning modal's "Stay signed in"
 * button also resets.
 *
 * ACTIVITY IS SHARED ACROSS TABS (sharedActivity.ts — Margaret's 2026-07-31
 * report). This hook's listeners only see the CURRENT tab, but signOut() is
 * global (it kills the session in every tab via crossTabSession's mirror),
 * so a forgotten background tab used to log out the tab someone was actively
 * working in — its 60s warning invisible in a hidden tab. Now every tab
 * stamps a shared last-activity timestamp, and this hook re-checks that
 * stamp BOTH when the idle timer fires (before warning) and again before the
 * actual sign-out — either check finding activity anywhere defers instead.
 * A genuinely abandoned machine (no tab active anywhere) still logs out.
 *
 * Why auto-logout?
 *   Reps leave the CRM open on shared/unattended laptops. Anyone walking by
 *   would see customer data. 60 min is a reasonable default; admins can
 *   tune per tenant later (spec TODO).
 */
interface UseIdleLogoutArgs {
  idleMs: number;
  warnMs: number;
  enabled?: boolean;
}

interface UseIdleLogoutResult {
  warning: boolean;
  secondsRemaining: number;
  dismissWarning: () => void;
}

const ACTIVITY_EVENTS: string[] = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "visibilitychange",
];

export function useIdleLogout({
  idleMs,
  warnMs,
  enabled = true,
}: UseIdleLogoutArgs): UseIdleLogoutResult {
  const [warning, setWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(
    Math.floor(warnMs / 1000)
  );

  const idleTimerRef = useRef<number | null>(null);
  const warnTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);

  const clearAll = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (warnTimerRef.current) window.clearTimeout(warnTimerRef.current);
    if (countdownRef.current) window.clearInterval(countdownRef.current);
    idleTimerRef.current = null;
    warnTimerRef.current = null;
    countdownRef.current = null;
  }, []);

  const signOutAndRedirect = useCallback(async () => {
    clearAll();
    // scope "local": sign out THIS browser only (Margaret's 2026-07-31
    // follow-up test). Bare signOut() defaults to scope "global", which
    // revokes the user's session in EVERY browser — so her untouched
    // Firefox hitting its 12h idle timer killed the Chrome she was actively
    // working in (and, with all sessions dead, her Meddy presence heartbeat
    // stopped = "shows me as offline"). Cross-BROWSER activity can't be
    // shared (sharedActivity.ts's localStorage is per browser), so the idle
    // logout must only ever take down its own browser. The manual Sign Out
    // button (AuthProvider.signOut) deliberately stays global.
    await supabase.auth.signOut({ scope: "local" });
    // Hard redirect so every in-memory state is blown away.
    window.location.href = "/login?reason=idle";
  }, [clearAll]);

  const startTimers = useCallback(
    (delayMs?: number) => {
      clearAll();
      if (!enabled) return;

      idleTimerRef.current = window.setTimeout(() => {
        // Someone may have been active in ANOTHER tab the whole time this
        // tab sat idle — check the shared stamp before warning, and defer
        // until the shared clock would actually cross the idle window.
        const defer = idleDeferralMs(Date.now(), lastSharedActivityMs(), idleMs);
        if (defer !== null) {
          startTimersRef.current(defer);
          return;
        }

        setWarning(true);
        setSecondsRemaining(Math.floor(warnMs / 1000));

        // Countdown ticker for the modal's "you'll be logged out in N
        // seconds" text. Pure UI — the actual logout fires from warnTimer.
        countdownRef.current = window.setInterval(() => {
          setSecondsRemaining((s) => (s > 0 ? s - 1 : 0));
        }, 1000);

        warnTimerRef.current = window.setTimeout(() => {
          // Last-chance cross-tab check: activity elsewhere during the 60s
          // warning (which the user can't see if THIS tab is backgrounded)
          // must cancel the global sign-out, not lose the race to it.
          const lateDefer = idleDeferralMs(Date.now(), lastSharedActivityMs(), idleMs);
          if (lateDefer !== null) {
            setWarning(false);
            startTimersRef.current(lateDefer);
            return;
          }
          void signOutAndRedirect();
        }, warnMs);
      }, delayMs ?? idleMs);
    },
    [clearAll, enabled, idleMs, warnMs, signOutAndRedirect],
  );

  // Self-reference so the timer callbacks above can restart with a computed
  // delay without adding startTimers to its own dependency list.
  const startTimersRef = useRef(startTimers);
  useEffect(() => {
    startTimersRef.current = startTimers;
  }, [startTimers]);

  const handleActivity = useCallback(() => {
    // While the warning modal is open, ignore passive events — we only
    // reset if the user explicitly clicks "Stay signed in" (which calls
    // dismissWarning below). Otherwise a jittering trackpad could keep
    // the session alive forever on an unattended machine. (Cross-tab this
    // property survives: only the FOCUSED tab receives pointer events, and
    // once its warning is up it stops stamping the shared clock too.)
    if (warning) return;
    markSharedActivity();
    startTimers();
  }, [warning, startTimers]);

  const dismissWarning = useCallback(() => {
    // An explicit "Stay signed in" click is unambiguous human presence —
    // force the stamp past the 30s write throttle so sibling tabs' pending
    // warnings see it immediately.
    markSharedActivity({ force: true });
    setWarning(false);
    startTimers();
  }, [startTimers]);

  // Keep the latest handleActivity in a ref so the listener effect below can
  // depend only on stable values. Previously handleActivity was in that
  // effect's deps, so the moment the warning showed (which recreates
  // handleActivity), the effect tore down and re-ran — clearing the live
  // warn/countdown timers it had just set, so the logout never actually fired.
  const handleActivityRef = useRef(handleActivity);
  useEffect(() => {
    handleActivityRef.current = handleActivity;
  }, [handleActivity]);

  const onActivity = useCallback(() => handleActivityRef.current(), []);

  useEffect(() => {
    if (!enabled) {
      clearAll();
      return;
    }
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, onActivity as EventListener, {
        passive: true,
      });
    }
    startTimers();
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, onActivity as EventListener);
      }
      clearAll();
    };
    // Depends only on config-level values (enabled + the memoized timer fns),
    // NOT on `warning`, so showing the warning can't tear down the timers.
  }, [enabled, onActivity, startTimers, clearAll]);

  return { warning, secondsRemaining, dismissWarning };
}
