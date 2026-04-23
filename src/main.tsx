import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./app.css";
import { initTheme } from "./hooks/useTheme";

// Apply saved light/dark theme before first paint to avoid flash.
initTheme();

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
 * fresh build is genuinely broken.
 */
if (typeof window !== "undefined") {
  const RELOAD_KEY = "__stale_chunk_reloaded";
  const isChunkError = (msg: string) =>
    /failed to fetch dynamically imported module|loading chunk|importing a module script failed|chunkloaderror/i.test(
      msg
    );

  window.addEventListener("error", (e) => {
    const msg = (e.error?.message ?? e.message ?? "") as string;
    if (!isChunkError(msg)) return;
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, "1");
    // Add a cache-buster so the new index.html is fetched even if the
    // browser aggressively caches.
    const url = new URL(window.location.href);
    url.searchParams.set("_r", String(Date.now()));
    window.location.replace(url.toString());
  });

  window.addEventListener("unhandledrejection", (e) => {
    const msg = ((e.reason && (e.reason.message ?? e.reason)) ?? "") as string;
    if (!isChunkError(String(msg))) return;
    if (sessionStorage.getItem(RELOAD_KEY)) return;
    sessionStorage.setItem(RELOAD_KEY, "1");
    const url = new URL(window.location.href);
    url.searchParams.set("_r", String(Date.now()));
    window.location.replace(url.toString());
  });

  // Clear the guard once we successfully render past the initial boot.
  // Next stale-chunk incident (e.g. after another deploy later in the
  // session) will be allowed to reload again.
  setTimeout(() => {
    sessionStorage.removeItem(RELOAD_KEY);
  }, 10_000);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
