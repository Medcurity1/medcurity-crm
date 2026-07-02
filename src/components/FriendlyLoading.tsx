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

export function FriendlyLoading() {
  // Random starting line so it isn't the same one every navigation;
  // rotates only if loading actually takes a while.
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * LINES.length));
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % LINES.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex h-64 items-center justify-center">
      <div className="motion-safe:animate-pulse text-sm text-muted-foreground">
        {LINES[idx]}
      </div>
    </div>
  );
}
