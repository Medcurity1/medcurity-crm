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

// PostgREST/GoTrue REST fetches have no default timeout, so a stalled (not
// failed) socket — laptop sleep/wake, wifi handoff, captive portal, cold edge
// function, dropped VPN packet — leaves the request pending forever. TanStack's
// retry only fires on rejection, so it never engages and the UI sits on a
// spinner (or a save mutation spins with the form still up) until a full
// browser refresh. This wrapper imposes a floor timeout that COMBINES with any
// caller-provided signal (e.g. partners/api.ts passes AbortSignal.timeout), so
// callers already aborting still get the floor and a hung request now rejects —
// re-engaging the normal QueryError/MutationCache error+retry+toast paths.
// Only REST/auth fetches flow through here; Realtime runs over WebSocket and is
// untouched.
//
// Edge-function invocations (/functions/v1/) get a longer 180s ceiling: AI
// calls (ask-ai, playbook-ai, meddy-crawl) and email sync legitimately run
// 20-150s (the platform kills functions at 150s), so the bound only has to
// beat a truly hung socket, not a slow-but-working call.
const FETCH_TIMEOUT_MS = 20_000;
const FUNCTIONS_FETCH_TIMEOUT_MS = 180_000;

function fetchTimeoutFor(input: RequestInfo | URL): number {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return url.includes("/functions/v1/")
    ? FUNCTIONS_FETCH_TIMEOUT_MS
    : FETCH_TIMEOUT_MS;
}

function timeoutFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const timeoutMs = fetchTimeoutFor(input);
  const callerSignal = init.signal ?? undefined;

  // Fast path: modern engines (Chrome 103+/Safari 16+) get a self-cleaning
  // combined signal — AbortSignal.timeout's timer is GC-managed, no leak.
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function" &&
    typeof AbortSignal.any === "function"
  ) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal;
    return fetch(input, { ...init, signal });
  }

  // Fallback for engines lacking AbortSignal.timeout/any: build the timeout by
  // hand and clear the timer once the request settles so no timer leaks. Honor
  // a caller signal by forwarding its abort onto our controller.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
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
  global: { fetch: timeoutFetch },
});
