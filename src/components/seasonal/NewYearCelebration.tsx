import { useEffect, useState } from "react";
import { FireworksCanvas } from "./FireworksCanvas";

/**
 * One-time full-screen New Year fireworks show. During January, the FIRST
 * time a user opens the app each year they get ~10 seconds of fireworks
 * with a "Happy {year}" greeting, then it fades and never shows again
 * until next year (tracked per device in localStorage). Click anywhere to
 * skip. Skipped entirely for reduced-motion users.
 */
const SHOW_MS = 10_000;
const FADE_MS = 900;

export function NewYearCelebration() {
  const [phase, setPhase] = useState<"hidden" | "showing" | "fading">("hidden");
  const year = new Date().getFullYear();

  useEffect(() => {
    const now = new Date();
    if (now.getMonth() !== 0) return; // January only
    const key = `pulse-newyear-${now.getFullYear()}`;
    try {
      if (window.localStorage.getItem(key) === "1") return;
      window.localStorage.setItem(key, "1");
    } catch {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setPhase("showing");
  }, []);

  useEffect(() => {
    if (phase !== "showing") return;
    const t = setTimeout(() => setPhase("fading"), SHOW_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== "fading") return;
    const t = setTimeout(() => setPhase("hidden"), FADE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div
      onClick={() => setPhase("fading")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        background: "linear-gradient(180deg, #0c1322 0%, #182441 100%)",
        opacity: phase === "fading" ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        cursor: "pointer",
      }}
      role="presentation"
    >
      <FireworksCanvas mode="show" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <p
          style={{
            fontFamily: "'Archivo Black', system-ui, sans-serif",
            fontSize: "clamp(40px, 8vw, 88px)",
            color: "#ffd957",
            textShadow: "0 2px 24px rgba(255, 217, 87, 0.45)",
            margin: 0,
            letterSpacing: "0.02em",
          }}
        >
          Happy {year}
        </p>
        <p style={{ color: "#cdd9f0", fontSize: 16, marginTop: 12 }}>
          Here's to a great year ahead. Click anywhere to continue.
        </p>
      </div>
    </div>
  );
}
