import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BUILD_ID } from "@/lib/buildInfo";

/**
 * "Pulse was updated" nudge for long-lived tabs. We deploy several times a
 * day; a tab left open (or resurrected by Safari's back-forward cache) can
 * be running a build whose lazy-route chunks no longer exist on the server.
 * Rather than force-reloading a healthy tab (and risking in-progress work),
 * this checks the server's /version.json when a tab is restored from
 * bfcache or becomes visible after a long time hidden, and offers a
 * one-click refresh when the build has moved on. Broken tabs don't need
 * this — the recovery paths in index.html/main.tsx handle those.
 */
const HIDDEN_BEFORE_CHECK_MS = 15 * 60_000;

async function fetchServerBuild(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?_=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: string };
    return body.build ?? null;
  } catch {
    return null; // offline — never nag on a guess
  }
}

export function UpdateBanner() {
  const [stale, setStale] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (BUILD_ID.startsWith("local")) return; // dev builds have no version.json
    let cancelled = false;
    let checking = false;

    const check = async () => {
      if (checking) return;
      checking = true;
      const server = await fetchServerBuild();
      checking = false;
      if (!cancelled && server && server !== BUILD_ID) setStale(true);
    };

    const onPageShow = (e: PageTransitionEvent) => {
      // bfcache restore — the classic Safari way a stale page comes back.
      if (e.persisted) void check();
    };

    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt > HIDDEN_BEFORE_CHECK_MS) {
        void check();
      }
    };

    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  if (!stale || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border bg-card text-card-foreground shadow-lg px-4 py-3">
      <span className="text-sm">Pulse was updated while this tab was open.</span>
      <Button
        size="sm"
        onClick={() => {
          const url = new URL(window.location.href);
          url.searchParams.set("_r", String(Date.now()));
          window.location.replace(url.toString());
        }}
      >
        <RefreshCw className="h-4 w-4 mr-1" />
        Refresh
      </Button>
      <button
        type="button"
        aria-label="Dismiss"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setDismissed(true)}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
