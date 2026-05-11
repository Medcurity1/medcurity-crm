import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TeamDashboard } from "./TeamDashboard";

/**
 * TeamDashboardTv — full-screen, chrome-less wrapper for the Team
 * Dashboard intended for an always-on office TV. Renders the same
 * <TeamDashboard /> inside a fixed 1920×1080 canvas and CSS-scales
 * it down (or up) to fit the actual screen, so the layout looks
 * identical regardless of TV resolution.
 *
 * Mounts OUTSIDE AppLayout (no sidebar / top bar) but still inside
 * ProtectedRoute — the office TV signs in as a regular non-owner
 * user so edit affordances are automatically suppressed by the
 * TeamDashboard's existing owner gates.
 *
 * Auto-reloads the page every 10 minutes so data stays fresh
 * without needing manual intervention.
 */

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const RELOAD_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export function TeamDashboardTv() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Recompute scale so the 1920×1080 canvas fits the viewport while
  // preserving aspect ratio. Letterbox bands (top/bottom or sides)
  // are filled by the wrapper's dark background.
  useLayoutEffect(() => {
    function recompute() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const next = Math.min(w / CANVAS_W, h / CANVAS_H);
      setScale(next);
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  // Periodic full-page reload so the TV always shows fresh data
  // (renewals roll over, snapshot captures fire on Monday morning,
  // etc.). Cheaper than wiring per-query refetch into a component
  // we don't own and don't want to alter for one consumer.
  useEffect(() => {
    const t = window.setInterval(() => {
      window.location.reload();
    }, RELOAD_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="fixed inset-0 overflow-hidden bg-black"
      style={{ width: "100vw", height: "100vh" }}
    >
      <div
        style={{
          width: CANVAS_W,
          height: CANVAS_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
          position: "absolute",
          top: "50%",
          left: "50%",
          background: "white",
        }}
      >
        <div className="h-full w-full overflow-auto p-6">
          <TeamDashboard />
        </div>
      </div>
    </div>
  );
}
