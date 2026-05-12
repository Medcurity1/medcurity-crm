import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TeamDashboard } from "./TeamDashboard";

/**
 * TeamDashboardTv — full-screen, chrome-less wrapper for the Team
 * Dashboard intended for an always-on office TV.
 *
 * Behavior:
 *   - Forces LIGHT theme while mounted, regardless of the signed-in
 *     user's preference or OS setting. Restores prior `.dark` state
 *     on unmount. Avoids the dark-card-on-white-page mix.
 *   - Renders <TeamDashboard tvMode> which strips ALL owner/admin
 *     affordances (tabs, edit pencils, drag handles, milestone Edit,
 *     quote editor, etc.) even when the owner account is signed in.
 *     The dashboard can only be edited from the owner's normal
 *     `/reports?tab=team` session.
 *   - Measures the dashboard's natural rendered height after mount
 *     and scales the entire canvas down so width AND height fit the
 *     viewport. No scrolling — everything is on one page, just smaller.
 *   - Auto-reloads every 10 minutes so the displayed numbers stay fresh.
 */

const CANVAS_W = 1920; // fixed canvas width — layout was designed for this
const RELOAD_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function TeamDashboardTv() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [contentH, setContentH] = useState<number>(1080);

  // Force light mode while the TV view is mounted. Capture and restore
  // the previous `.dark` state so we don't trample the user's choice
  // if they navigate back to a normal page.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);

  // Measure the natural rendered height of the dashboard and recompute
  // scale on viewport resize OR content resize. We scale by min(width
  // ratio, height ratio) so the full dashboard always fits.
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
  }, [contentH]);

  // Periodic full-page reload so the TV always shows fresh data.
  useEffect(() => {
    const t = window.setInterval(() => {
      window.location.reload();
    }, RELOAD_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-white"
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
          background: "white",
        }}
      >
        <div ref={contentRef} className="w-full p-6">
          <TeamDashboard tvMode />
        </div>
      </div>
    </div>
  );
}
