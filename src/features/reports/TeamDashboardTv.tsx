import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TeamDashboard } from "./TeamDashboard";
import { supabase } from "@/lib/supabase";

/**
 * TeamDashboardTv — full-screen, chrome-less wrapper for the Team
 * Dashboard intended for an always-on office TV.
 *
 * Behavior:
 *   - Forces the chosen theme (light by default; user-toggleable,
 *     persisted) while mounted. Restores prior `.dark` state on
 *     unmount.
 *   - Renders <TeamDashboard tvMode> which:
 *       (a) strips ALL owner/admin affordances even when the owner is
 *           signed in (TV is read-only — edit from your normal
 *           session)
 *       (b) uses width-based CSS columns so sections auto-pack into
 *           as many columns as the viewport fits (2 / 3 / 4+)
 *   - Renders at NATIVE viewport width — no horizontal canvas scaling
 *     — so wider monitors actually flow more content side-by-side
 *     instead of just zooming a 1920-wide design.
 *   - Measures the rendered height and ONLY shrinks vertically if it
 *     overflows the viewport, so everything stays on one screen
 *     without scroll.
 *   - Auto-reloads every 10 minutes for fresh data.
 *   - Proactively refreshes the Supabase session every 30 minutes so
 *     the always-on TV never gets signed out for inactivity. (The
 *     regular idle-logout hook lives in AppLayout, which this route
 *     deliberately bypasses — and this refresh keeps Supabase's own
 *     access-token / refresh-token chain from expiring.)
 *   - Tiny theme toggle in the bottom-right corner (small +
 *     low-opacity so it doesn't dominate the display, but
 *     discoverable).
 */

const RELOAD_INTERVAL_MS = 10 * 60 * 1000;
const SESSION_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
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

  // Measure content height; only scale DOWN if it exceeds viewport
  // height. No horizontal scaling — content renders at actual viewport
  // width so the width-based column flow inside <TeamDashboard tvMode>
  // gets to use the real screen real-estate.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    function recompute() {
      const h = el?.scrollHeight ?? 0;
      const vh = window.innerHeight;
      if (h <= 0) {
        setScale(1);
        return;
      }
      const next = Math.min(1, vh / h);
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
  }, [theme]);

  // Periodic full-page reload so the TV always shows fresh data.
  useEffect(() => {
    const t = window.setInterval(() => {
      window.location.reload();
    }, RELOAD_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);

  // Keep the Supabase session alive indefinitely while the TV is
  // mounted. Each refreshSession() rotates the refresh token, so the
  // refresh-token chain never expires as long as we call this within
  // its lifetime (Supabase default: 1 week). 30 minutes is well inside
  // the 1-hour access-token window too.
  useEffect(() => {
    const t = window.setInterval(() => {
      supabase.auth.refreshSession().catch(() => {
        // Network blip — next interval will retry. The 10-minute page
        // reload also re-bootstraps auth on its own.
      });
    }, SESSION_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);

  const bgClass = theme === "dark" ? "bg-neutral-950" : "bg-white";

  return (
    <div
      className={`fixed inset-0 overflow-hidden ${bgClass}`}
      style={{ width: "100vw", height: "100vh" }}
    >
      <div
        style={{
          width: "100vw",
          transform: `scale(${scale})`,
          transformOrigin: "top center",
          // When scaled <1, content occupies less vertical room than
          // 100vh — center it vertically.
          position: "absolute",
          top: 0,
          left: 0,
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
