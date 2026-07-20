import React from "react";
import ReactDOM from "react-dom/client";
import "./app.css";
import { initTheme } from "./hooks/useTheme";
import { initCrossTabSession } from "./lib/crossTabSession";

// Apply saved light/dark theme before first paint to avoid flash.
initTheme();

// Storage helpers that survive Safari privacy modes ("Block All Cookies" /
// Lockdown) where ANY storage touch throws — the recovery paths below must
// never die on their own loop guard.
function safeSessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}
function safeSessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

/**
 * Stale-chunk recovery.
 *
 * Azure SWA ships each build with hashed JS filenames. When a user has
 * the old index.html cached and we deploy, their browser tries to load
 * e.g. AccountsList-C8V-kSdP.js — which no longer exists on the CDN.
 * Vite surfaces this as "Failed to fetch dynamically imported module"
 * and our ErrorBoundary shows "Something went wrong." A hard refresh
 * fixes it (loads the new index.html + the new chunk names).
 *
 * This listener auto-refreshes ONCE on the first chunk-load failure,
 * using a session-storage guard so we don't hit a reload loop if the
 * fresh build is genuinely broken. (The worst case — this very file's
 * chunk being the dead one — is covered by the inline recovery script
 * in index.html, which runs even when main.tsx never loads.)
 */
const RELOAD_KEY = "__stale_chunk_reloaded";

function reloadOnceForStaleChunk(): void {
  if (safeSessionGet(RELOAD_KEY)) return;
  safeSessionSet(RELOAD_KEY, "1");
  // Add a cache-buster so the new index.html is fetched even if the
  // browser aggressively caches.
  const url = new URL(window.location.href);
  url.searchParams.set("_r", String(Date.now()));
  window.location.replace(url.toString());
}

if (typeof window !== "undefined") {
  // Deliberately does NOT match Safari's generic fetch failure ("Load
  // failed") — that fires for any offline API call, and a full reload on
  // those would toss in-progress work. Safari reports a failed dynamic
  // import as "Importing a module script failed", which IS matched.
  const isChunkError = (msg: string) =>
    /failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk|importing a module script failed|chunkloaderror/i.test(
      msg
    );

  window.addEventListener("error", (e) => {
    const msg = (e.error?.message ?? e.message ?? "") as string;
    if (isChunkError(msg)) reloadOnceForStaleChunk();
  });

  window.addEventListener("unhandledrejection", (e) => {
    const msg = ((e.reason && (e.reason.message ?? e.reason)) ?? "") as string;
    if (isChunkError(String(msg))) reloadOnceForStaleChunk();
  });

  // Vite's own signal for a failed lazy-route preload — fires in browsers
  // whose generic error events carry no usable message for these.
  window.addEventListener("vite:preloadError", () => {
    reloadOnceForStaleChunk();
  });

  // Clear the guard once we successfully render past the initial boot.
  // Next stale-chunk incident (e.g. after another deploy later in the
  // session) will be allowed to reload again.
  setTimeout(() => {
    safeSessionRemove(RELOAD_KEY);
  }, 10_000);
}

/**
 * Last-resort boundary around the whole tree (AuthProvider included) — the
 * per-route ErrorBoundary inside AppLayout can't catch failures above it.
 * Deliberately built with inline styles and no UI-kit imports: those live
 * in the App chunk, and pulling them here would bloat the entry bundle.
 */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("RootErrorBoundary caught:", error);
    const msg = (error?.message ?? "").toLowerCase();
    if (
      /failed to fetch dynamically imported module|loading chunk|chunkloaderror|importing a module script failed|networkerror|load failed/.test(
        msg
      )
    ) {
      reloadOnceForStaleChunk();
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            fontFamily: "system-ui, -apple-system, sans-serif",
            textAlign: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>
              Something went wrong
            </div>
            <div
              style={{
                fontSize: 14,
                opacity: 0.7,
                marginBottom: 16,
                maxWidth: 360,
              }}
            >
              Reloading usually fixes this. If it keeps happening, let the
              team know.
            </div>
            <button
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set("_r", String(Date.now()));
                window.location.replace(url.toString());
              }}
              style={{
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                background: "#127ebf",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Adopt the session (from a sibling tab or the legacy localStorage migration)
// BEFORE App — and therefore the Supabase client — loads and reads storage.
// App is imported dynamically so its supabase client constructs only after
// sessionStorage is populated. The wait is ~0ms for a tab that already has a
// session (or an existing user migrating from localStorage) and at most 600ms
// for a brand-new tab borrowing from a sibling.
void initCrossTabSession()
  .catch((err) => {
    // A failed sibling borrow just means we boot signed-out — never fatal.
    console.warn("initCrossTabSession failed:", err);
  })
  .then(async () => {
    const { default: App } = await import("./App");
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </React.StrictMode>,
    );
    // Tell the inline watchdog in index.html we made it, and drop any
    // recovery params from the URL so the NEXT incident (e.g. a later
    // deploy against this still-open tab) is allowed to auto-recover.
    window.__appBooted = true;
    document.getElementById("boot-fallback")?.remove();
    if (/[?&](_r|_rb)=/.test(window.location.search)) {
      const url = new URL(window.location.href);
      url.searchParams.delete("_r");
      url.searchParams.delete("_rb");
      window.history.replaceState(null, "", url.toString());
    }
  })
  .catch((err) => {
    // The App chunk failed to load or crashed on import — hand off to the
    // inline recovery in index.html (version-checked reload, else the
    // friendly fallback card). Without this catch, a Safari user got a
    // permanent white page.
    console.error("App boot failed:", err);
    window.__pulseBootRecover?.();
  });
