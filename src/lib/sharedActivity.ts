/**
 * Cross-tab "someone is using Pulse" heartbeat (Margaret's 2026-07-31 report:
 * "Pulse is logging me off even though I'm still active on other tabs").
 *
 * useIdleLogout used to measure activity PER TAB (window-level listeners
 * only), but its sign-out is GLOBAL (supabase signOut + the crossTabSession
 * mirror wipe every tab). So one forgotten background tab crossing its 12h
 * idle mark — warning modal invisible in a hidden tab — logged out the tab
 * the user was actively typing in. Laptop sleep made it fire right after
 * wake, i.e. exactly when people start working.
 *
 * Fix: every tab stamps a shared last-activity timestamp (throttled), and
 * useIdleLogout consults it at BOTH decision points (before showing the
 * warning, and again before actually signing out). A truly abandoned machine
 * still logs out — no tab anywhere has stamped within the idle window — but
 * a working person can never be kicked by a stale sibling tab.
 *
 * Why localStorage and not the crossTabSession BroadcastChannel: the read
 * happens at DECISION time, synchronously, and localStorage survives tab
 * freezing/discard (a frozen tab misses channel messages but reads fresh
 * state the moment it resumes and its timer fires). The value is just a
 * timestamp — deliberately no session data. If storage is blocked (Safari
 * Lockdown), everything degrades to the old per-tab behavior rather than
 * breaking.
 */

// Deliberately NOT env.ts (it throws at import when the VITE vars are
// missing — fail-fast is right for the app boot path via supabase.ts, but a
// storage KEY must never be able to crash an importer, incl. vitest's node
// env). Missing env just namespaces the stamp under "default".
function projectRef(): string {
  try {
    const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined;
    return url ? new URL(url).host.split(".")[0] || "default" : "default";
  } catch {
    return "default";
  }
}

export const SHARED_ACTIVITY_KEY = `pulse-last-activity-${projectRef()}`;

/** Don't rewrite the stamp more than ~every 30s — mousemove fires constantly
 *  and same-key localStorage writes also fire `storage` events in every
 *  sibling tab. */
const WRITE_THROTTLE_MS = 30_000;

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // Safari "Block All Cookies" throws on the property itself
  }
}

let lastWriteMs = 0;

/** Stamp "a human did something in a Pulse tab just now". Throttled unless
 *  `force` (used for explicit clicks like "Stay signed in", which must never
 *  be swallowed by the throttle). Store injectable for tests. */
export function markSharedActivity(
  opts: { force?: boolean; nowMs?: number; store?: Storage | null } = {},
): void {
  const now = opts.nowMs ?? Date.now();
  if (!opts.force && now - lastWriteMs < WRITE_THROTTLE_MS) return;
  const store = opts.store !== undefined ? opts.store : safeLocalStorage();
  if (!store) return;
  try {
    store.setItem(SHARED_ACTIVITY_KEY, String(now));
    lastWriteMs = now;
  } catch {
    /* storage full/blocked — degrade to per-tab behavior */
  }
}

/** Most recent shared activity stamp in ms, 0 when unknown/unreadable —
 *  callers treat 0 as "no cross-tab signal" and fall back to their own
 *  per-tab timers. */
export function lastSharedActivityMs(store?: Storage | null): number {
  const s = store !== undefined ? store : safeLocalStorage();
  if (!s) return 0;
  try {
    const n = Number(s.getItem(SHARED_ACTIVITY_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** The idle-logout decision, pure for tests (tests/idleSharedActivity.test.ts):
 *  given "now", the shared stamp, and the idle window — null means nobody
 *  anywhere was active within the window, so this tab may proceed (warn, or
 *  sign out); a number means someone WAS active, and it's how long this tab
 *  should wait before re-checking (when the shared clock would cross the
 *  window). Floored at 60s so a stamp landing mid-check can't schedule a
 *  tight re-fire loop; a future-dated stamp (clock weirdness) just defers a
 *  full window rather than going negative. */
export function idleDeferralMs(
  nowMs: number,
  sharedLastMs: number,
  idleMs: number,
): number | null {
  if (!sharedLastMs) return null;
  const elapsed = nowMs - sharedLastMs;
  if (elapsed >= idleMs) return null;
  if (elapsed < 0) return idleMs;
  return Math.max(60_000, idleMs - elapsed);
}
