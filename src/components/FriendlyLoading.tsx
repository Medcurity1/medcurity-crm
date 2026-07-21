import { useEffect, useState } from "react";

// Friendly rotating loading lines (Nathan's delight batch, 2026-07-02) —
// tiny personality instead of a bare "Loading...". Shown in the route
// Suspense fallback, so keep every line workplace-safe and short.
const LINES = [
  "Rounding up your deals…",
  "Warming up the pipeline…",
  "Feeding Meddy…",
  "Counting the commas…",
  "Shaking hands with the database…",
  "Herding spreadsheets…",
  "Brewing fresh data…",
  "Filing the paperwork…",
  "Untangling the phone cords…",
  "Rolling out the red carpet…",
  "Double-checking the math…",
  "Finding a good pen…",
  "Putting on the headset…",
  "Straightening the name tags…",
];

// If a mid-session lazy route import STALLS (captive portal, flaky mobile, a
// proxy holding the connection open) the import() promise never rejects, so
// none of main.tsx's error/preloadError recovery listeners fire and this
// fallback would spin forever. The index.html boot watchdog is boot-only
// (guarded by __appBooted), so it can't help here. After ~20s (aligned with
// that boot watchdog) we surface a manual reload instead of an endless spinner.
const WATCHDOG_MS = 20_000;

export function FriendlyLoading() {
  // Random starting line so it isn't the same one every navigation;
  // rotates only if loading actually takes a while.
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * LINES.length));
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % LINES.length), 2200);
    return () => clearInterval(t);
  }, []);
  // Cleaned up on unmount so a brief (normal) load never flashes the button.
  useEffect(() => {
    const t = setTimeout(() => setStalled(true), WATCHDOG_MS);
    return () => clearTimeout(t);
  }, []);

  if (stalled) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <div className="text-sm text-muted-foreground">Still loading…</div>
        <button
          type="button"
          onClick={() => window.__pulseBootRecover?.() ?? location.reload()}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
        >
          Tap to reload
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-64 items-center justify-center">
      <div className="motion-safe:animate-pulse text-sm text-muted-foreground">
        {LINES[idx]}
      </div>
    </div>
  );
}
