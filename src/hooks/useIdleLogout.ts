import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

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
    await supabase.auth.signOut();
    // Hard redirect so every in-memory state is blown away.
    window.location.href = "/login?reason=idle";
  }, [clearAll]);

  const startTimers = useCallback(() => {
    clearAll();
    if (!enabled) return;

    idleTimerRef.current = window.setTimeout(() => {
      setWarning(true);
      setSecondsRemaining(Math.floor(warnMs / 1000));

      // Countdown ticker for the modal's "you'll be logged out in N
      // seconds" text. Pure UI — the actual logout fires from warnTimer.
      countdownRef.current = window.setInterval(() => {
        setSecondsRemaining((s) => (s > 0 ? s - 1 : 0));
      }, 1000);

      warnTimerRef.current = window.setTimeout(() => {
        void signOutAndRedirect();
      }, warnMs);
    }, idleMs);
  }, [clearAll, enabled, idleMs, warnMs, signOutAndRedirect]);

  const handleActivity = useCallback(() => {
    // While the warning modal is open, ignore passive events — we only
    // reset if the user explicitly clicks "Stay signed in" (which calls
    // dismissWarning below). Otherwise a jittering trackpad could keep
    // the session alive forever on an unattended machine.
    if (warning) return;
    startTimers();
  }, [warning, startTimers]);

  const dismissWarning = useCallback(() => {
    setWarning(false);
    startTimers();
  }, [startTimers]);

  useEffect(() => {
    if (!enabled) {
      clearAll();
      return;
    }
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handleActivity as EventListener, {
        passive: true,
      });
    }
    startTimers();
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, handleActivity as EventListener);
      }
      clearAll();
    };
  }, [enabled, handleActivity, startTimers, clearAll]);

  return { warning, secondsRemaining, dismissWarning };
}
