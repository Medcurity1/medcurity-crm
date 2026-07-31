/**
 * A repeating tick that keeps firing in BACKGROUND tabs.
 *
 * Why this exists (Margaret's 2026-07-31 availability report, root-caused to
 * the 2026-07-21 perf sweep): browsers throttle a hidden page's own timers —
 * Chrome's intensive throttling can clamp them to one wake per minute (or
 * worse under Energy Saver), Safari can freeze the page entirely — so a
 * plain setInterval is not a dependable heartbeat source for anything a
 * SERVER sweeps on staleness (meddy_agent_status.last_seen, swept every
 * minute). A dedicated Web Worker runs on its own thread and its timers are
 * NOT subject to page timer throttling; the page-side onmessage handler is
 * event-driven and runs fine while hidden. Net effect: an open-but-
 * backgrounded tab keeps ticking; a tab the browser has truly frozen or
 * discarded stops — which is the correct signal, because a frozen tab can't
 * play notification sounds or take a chat either.
 *
 * Falls back to plain setInterval when Workers/Blob URLs are unavailable
 * (old webviews, exotic privacy modes) — degraded, never broken.
 *
 * Deps are injectable so vitest (node, no Worker/DOM) can exercise both
 * paths — tests/backgroundTicker.test.ts.
 */

interface WorkerLike {
  onmessage: ((ev: MessageEvent) => void) | null;
  terminate(): void;
}

export interface BackgroundTickerDeps {
  createWorker: (intervalMs: number) => WorkerLike;
  setIntervalFn: (fn: () => void, ms: number) => number;
  clearIntervalFn: (id: number) => void;
}

function defaultCreateWorker(intervalMs: number): WorkerLike {
  // Inline worker via Blob URL — no separate file to serve, no CSP configured
  // on this app to forbid it. The worker does exactly one thing.
  const src = `setInterval(function () { postMessage(0); }, ${intervalMs});`;
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  try {
    const w = new Worker(url);
    // The worker holds its own reference to the compiled script; the URL can
    // be released immediately either way.
    URL.revokeObjectURL(url);
    return w;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

/**
 * Start ticking every `intervalMs`. Returns a stop function. Never throws —
 * any Worker failure falls back to setInterval.
 */
export function startBackgroundTicker(
  intervalMs: number,
  onTick: () => void,
  deps?: Partial<BackgroundTickerDeps>,
): () => void {
  const createWorker = deps?.createWorker ?? defaultCreateWorker;
  const setIntervalFn =
    deps?.setIntervalFn ?? ((fn: () => void, ms: number) => window.setInterval(fn, ms));
  const clearIntervalFn = deps?.clearIntervalFn ?? ((id: number) => window.clearInterval(id));

  try {
    const worker = createWorker(intervalMs);
    worker.onmessage = () => onTick();
    return () => {
      worker.onmessage = null;
      worker.terminate();
    };
  } catch {
    const id = setIntervalFn(onTick, intervalMs);
    return () => clearIntervalFn(id);
  }
}
