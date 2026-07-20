import { createClient } from "@supabase/supabase-js";
import { env } from "./env";
import { crossTabStorage } from "./crossTabSession";

// supabase-js's default Web Locks wrapper waits FOREVER to acquire the
// cross-tab auth lock. Safari freezes background tabs aggressively, and a
// frozen tab can hold the lock indefinitely — every other tab then hangs on
// "Loading..." because getSession() never resolves. This wrapper caps the
// wait; on timeout we run WITHOUT the lock, which is exactly how supabase-js
// behaves in browsers with no Web Locks at all. Worst case is a redundant
// concurrent token refresh, which Supabase's refresh-reuse grace window
// absorbs — strictly better than an infinite spinner.
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;

async function timeoutNavigatorLock<R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return await fn();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCK_ACQUIRE_TIMEOUT_MS);
  try {
    return (await locks.request(
      name,
      { mode: "exclusive", signal: controller.signal },
      async () => {
        // Granted — the timeout must only bound acquisition, never fn itself.
        clearTimeout(timer);
        return await fn();
      },
    )) as R;
  } catch (err) {
    if ((err as DOMException | null)?.name === "AbortError") {
      console.warn(
        "[auth] session lock not acquired after 10s (a frozen sibling tab may hold it) — proceeding without it",
      );
      return await fn();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // Session lives in per-tab sessionStorage (mirrored across tabs by
    // crossTabSession) so closing the last tab / shutting down logs the user
    // out, while extra open tabs keep them in. Falls back to localStorage when
    // BroadcastChannel is unavailable. See crossTabSession.ts.
    storage: crossTabStorage,
    lock: timeoutNavigatorLock,
  },
});
