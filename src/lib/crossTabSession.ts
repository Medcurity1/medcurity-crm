import { env } from "./env";

/**
 * Per-tab auth session with cross-tab sharing.
 *
 * Goal (Nathan, 2026-06-16): closing EVERY CRM tab on a machine (or shutting
 * the machine off) should log the user out, so they sign in again next time.
 * Closing ONE of several open tabs must NOT log them out. An idle-but-open tab
 * stays logged in (the long idle backstop handles that separately).
 *
 * How it works (and why this shape):
 *  - The session lives in `sessionStorage`, which the browser clears when the
 *    tab closes and on browser/computer close. That alone gives "close the
 *    last tab => logged out", because nothing persists.
 *  - sessionStorage is per-tab, so two things are needed for multi-tab:
 *      1. A fresh tab borrows the session from an open sibling at boot.
 *      2. Storage WRITES are mirrored to siblings so each tab's sessionStorage
 *         stays current. This matters because supabase-js's auto-refresh
 *         re-reads storage before refreshing (_autoRefreshTokenTick ->
 *         _useSession -> __loadSession), so a sibling that has the current
 *         token in its own sessionStorage refreshes correctly and is never
 *         kicked by refresh-token rotation. We deliberately only mirror the
 *         STORED VALUE — we never call setSession (that would hit the network
 *         and ping-pong forever, since setSession re-serializes the session
 *         with a fresh timestamp). supabase-js's own BroadcastChannel already
 *         keeps each tab's React UI in sync (sign-in / refresh / sign-out
 *         events), so we don't touch the in-memory client at all.
 *  - One-time migration: existing users have their session in localStorage
 *    (the old model). On first load we move it into sessionStorage and delete
 *    the localStorage copy, so the switch doesn't log everyone out.
 *  - Fallback: if BroadcastChannel is unavailable (rare; old webviews), we
 *    fall back to localStorage (the original model) so multi-tab and refresh
 *    still work — we just lose close-all-tabs logout on that browser rather
 *    than stranding a second tab at the login screen.
 *
 * Known limitation: a browser set to "reopen tabs on startup" can restore
 * sessionStorage after a reboot, so that user may not be logged out by a
 * restart. The robust fix for that is server-side session max-age in Supabase;
 * tracked separately.
 */

function projectRef(): string {
  try {
    return new URL(env.supabaseUrl).host.split(".")[0] || "default";
  } catch {
    return "default";
  }
}

const REF = projectRef();

// The key Supabase reads/writes the session under (its default format). We key
// the cross-tab logic and the legacy migration off this exact name.
export const AUTH_STORAGE_KEY = `sb-${REF}-auth-token`;

const channel: BroadcastChannel | null =
  typeof window !== "undefined" && "BroadcastChannel" in window
    ? (() => {
        try {
          return new BroadcastChannel(`pulse-auth-mirror-${REF}`);
        } catch {
          return null;
        }
      })()
    : null;

// When we have a channel we use per-tab sessionStorage (with mirroring).
// Without one, fall back to localStorage so nothing breaks.
const useSessionStore = !!channel;

function backing(): Storage {
  return useSessionStore ? sessionStorage : localStorage;
}

// Last value we wrote per key, so a mirrored write we then persist doesn't echo
// back out and loop.
const lastSeen: Record<string, string | null> = {};

// expires_at (epoch seconds) of a serialized session, for recency checks.
function sessionExpiresAt(value: string | null): number {
  if (!value) return 0;
  try {
    return Number((JSON.parse(value) as { expires_at?: number })?.expires_at) || 0;
  } catch {
    return 0;
  }
}

// Wall-clock ms of the most recent sign-out this tab saw. A mirrored 'set' that
// lands within the tombstone window right after a sign-out is ignored, so a
// race between a sibling's in-flight refresh and a sign-out can't resurrect a
// signed-out session. Cleared by a genuine local sign-in write.
let signedOutAt = 0;
const SIGNOUT_TOMBSTONE_MS = 2000;

/** Supabase `auth.storage` adapter. */
export const crossTabStorage = {
  getItem(key: string): string | null {
    try {
      return backing().getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      backing().setItem(key, value);
    } catch {
      /* storage blocked/full */
    }
    if (key === AUTH_STORAGE_KEY) signedOutAt = 0; // a real local sign-in/refresh
    if (useSessionStore && lastSeen[key] !== value) {
      lastSeen[key] = value;
      channel?.postMessage({ type: "set", key, value });
    }
  },
  removeItem(key: string): void {
    try {
      backing().removeItem(key);
    } catch {
      /* ignore */
    }
    if (key === AUTH_STORAGE_KEY) signedOutAt = Date.now();
    if (useSessionStore) {
      lastSeen[key] = null;
      channel?.postMessage({ type: "remove", key });
    }
  },
};

// Keep each tab's sessionStorage byte-current with its siblings. We only touch
// STORAGE here — never the in-memory supabase client — so there is no network
// call and no feedback loop. supabase-js's own channel handles the UI events.
channel?.addEventListener("message", (e: MessageEvent) => {
  const msg = e.data as { type?: string; key?: string; value?: string } | null;
  if (!msg || !msg.type) return;

  // A booting tab is asking for the session — share ours if we hold it.
  // (getItem wrapped: Safari's strictest privacy modes throw on ANY storage
  // touch, and an exception inside this handler would kill the mirror.)
  if (msg.type === "request") {
    let v: string | null = null;
    try {
      v = sessionStorage.getItem(AUTH_STORAGE_KEY);
    } catch {
      /* storage blocked */
    }
    if (v) channel?.postMessage({ type: "set", key: AUTH_STORAGE_KEY, value: v });
    return;
  }

  if (msg.type === "set" && msg.key) {
    let current: string | null = null;
    try {
      current = sessionStorage.getItem(msg.key);
    } catch {
      /* storage blocked */
    }
    if (msg.key === AUTH_STORAGE_KEY) {
      // Don't resurrect a session right after a sign-out, and never overwrite a
      // newer session with an older one (a stale 'set' that raced a refresh).
      if (Date.now() - signedOutAt < SIGNOUT_TOMBSTONE_MS) return;
      if (sessionExpiresAt(msg.value ?? null) < sessionExpiresAt(current)) return;
    }
    if (current === msg.value) return; // already in sync
    lastSeen[msg.key] = msg.value ?? null; // suppress echo on the write below
    try {
      sessionStorage.setItem(msg.key, msg.value as string);
    } catch {
      /* ignore */
    }
    return;
  }

  if (msg.type === "remove" && msg.key) {
    if (msg.key === AUTH_STORAGE_KEY) signedOutAt = Date.now();
    lastSeen[msg.key] = null;
    try {
      sessionStorage.removeItem(msg.key);
    } catch {
      /* ignore */
    }
    return;
  }
});

/**
 * Run ONCE at boot, before the Supabase client reads the session. If this tab
 * has no session yet, (1) migrate a legacy localStorage session, else (2)
 * borrow it from an open sibling tab.
 */
export async function initCrossTabSession(): Promise<void> {
  if (typeof window === "undefined") return;
  if (!useSessionStore) return; // localStorage fallback: nothing to coordinate
  try {
    if (sessionStorage.getItem(AUTH_STORAGE_KEY)) return; // tab already has one
  } catch {
    // Storage blocked (Safari "Block All Cookies"/Lockdown) — boot
    // signed-out rather than dying before first paint.
    return;
  }

  // 1. One-time legacy migration (deploy day): move the old localStorage
  // session into sessionStorage and delete it, so we don't keep falling back
  // to it (which would defeat close-all-tabs logout). Synchronous => existing
  // users boot with no delay and stay logged in through the switch.
  try {
    const legacy = localStorage.getItem(AUTH_STORAGE_KEY);
    if (legacy) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, legacy);
      lastSeen[AUTH_STORAGE_KEY] = legacy;
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return;
    }
  } catch {
    /* ignore */
  }

  // 2. Otherwise borrow from a sibling tab (the multi-tab case). Short wait;
  // resolves instantly if a sibling answers, falls through to login if not.
  const ch = channel;
  if (!ch) return;
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      ch.removeEventListener("message", once);
      resolve();
    }, 600);
    function once(e: MessageEvent) {
      const m = e.data as { type?: string; key?: string; value?: string };
      if (m?.type === "set" && m.key === AUTH_STORAGE_KEY && m.value) {
        window.clearTimeout(timer);
        ch.removeEventListener("message", once);
        lastSeen[AUTH_STORAGE_KEY] = m.value;
        try {
          sessionStorage.setItem(AUTH_STORAGE_KEY, m.value);
        } catch {
          /* ignore */
        }
        resolve();
      }
    }
    ch.addEventListener("message", once);
    ch.postMessage({ type: "request" });
  });
}
