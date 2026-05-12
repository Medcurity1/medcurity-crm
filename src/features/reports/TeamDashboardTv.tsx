import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TeamDashboard } from "./TeamDashboard";

/**
 * TeamDashboardTv — full-screen, chrome-less wrapper for the Team
 * Dashboard intended for an always-on office TV.
 *
 * Behavior:
 *   - Forces the chosen theme (light by default; user-toggleable, persisted)
 *     while mounted. Restores prior `.dark` state on unmount.
 *   - Renders <TeamDashboard tvMode> which:
 *       (a) strips ALL owner/admin affordances even when the owner is
 *           signed in (TV is read-only — edit from your normal session)
 *       (b) flows top-level sections into 2 columns so the wide TV
 *           canvas fills horizontally instead of stacking vertically.
 *   - Measures the dashboard's rendered height after mount and scales
 *     the canvas down so width AND height fit the viewport. No scroll.
 *   - Auto-reloads every 10 minutes for fresh data.
 *   - Tiny theme toggle in the bottom-right corner (small + low-opacity
 *     so it doesn't dominate the display, but discoverable).
 */

const CANVAS_W = 1920;
const RELOAD_INTERVAL_MS = 10 * 60 * 1000;
const THEME_STORAGE_KEY = "medcurity_tv_theme";

type TvTheme = "light" | "dark";

function readSavedTheme(): TvTheme {
  if (typeof window === "undefined") return "light";
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  return raw === "dark" ? "dark" : "light";
}

export function TeamDashboardTv() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [contentH, setContentH] = useState<number>(1080);
  const [theme, setTheme] = useState<TvTheme>(() => readSavedTheme());

  // Apply the chosen theme to <html> while mounted; restore on unmount.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    if (theme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
      else root.classList.remove("dark");
    };
  }, [theme]);

  // Persist theme choice across page reloads.
  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // localStorage disabled — fine.
    }
  }, [theme]);

  // Measure dashboard height and recompute scale on viewport/content resize.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function recompute() {
      const h = el?.scrollHeight ?? 1080;
      if (h && Math.abs(h - contentH) > 4) setContentH(h);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const next = Math.min(vw / CANVAS_W, vh / Math.max(h, 1));
      setScale(next);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [contentH, theme]);

  // Periodic full-page reload so the TV always shows fresh data.
  useEffect(() => {
    const t = window.setInterval(() => {
      window.location.reload();
    }, RELOAD_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);

  const bgClass = theme === "dark" ? "bg-neutral-950" : "bg-white";
  const innerBg = theme === "dark" ? "#0a0a0a" : "white";

  return (
    <div
      className={`fixed inset-0 overflow-hidden ${bgClass}`}
      style={{ width: "100vw", height: "100vh" }}
    >
      <div
        style={{
          width: CANVAS_W,
          height: contentH,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
          position: "absolute",
          top: "50%",
          left: "50%",
          background: innerBg,
        }}
      >
        <div ref={contentRef} className="w-full p-6">
          <TeamDashboard tvMode />
        </div>
      </div>

      {/* Theme toggle — small, low-opacity, bottom-right. */}
      <button
        type="button"
        onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        className={`fixed bottom-3 right-3 z-50 rounded-full px-3 py-1.5 text-xs font-medium opacity-30 hover:opacity-100 transition-opacity ${
          theme === "dark"
            ? "bg-white/10 text-white border border-white/20"
            : "bg-black/10 text-black border border-black/20"
        }`}
        title="Toggle dashboard theme"
      >
        {theme === "dark" ? "☀ Light" : "☾ Dark"}
      </button>
    </div>
  );
}
