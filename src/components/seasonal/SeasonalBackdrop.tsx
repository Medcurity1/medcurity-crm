import type { ReactNode } from "react";
import { ParticleCanvas } from "./ParticleCanvas";
import { FireworksCanvas } from "./FireworksCanvas";
import {
  PumpkinCorners,
  ShamrockCorners,
  FlowerCorners,
  ChristmasCorners,
  BatFlyby,
  SunGlow,
} from "./decorations";

/**
 * Seasonal login backdrop (Nathan's approved 2026-06-10 timeline).
 * Every month has an ambient vibe; holiday windows layer specials on top.
 * Login page only — switches automatically by date, pure decoration, no
 * functional impact. The one-time January post-login fireworks live in
 * NewYearCelebration, not here.
 *
 *  Jan        light wintry bg, gentle snow
 *  Feb        cozy warm tones; Feb 10-16 floating hearts
 *  Mar        first-green freshness; Mar 13-17 shamrocks
 *  Apr        pastel spring, petals all month
 *  May        full bloom, flowers in the corners
 *  Jun        warm summer light
 *  Jul        dusk sky; Jul 1-10 ambient fireworks; stars after
 *  Aug        late-summer dusk, fireflies
 *  Sep        early autumn warmth, sparse leaves
 *  Oct        autumn, pumpkins all month + unpredictable bat
 *  Nov        harvest, leaves all month
 *  Dec 1-21   dark winter night, light snow
 *  Dec 22-26  Christmas: festive colors, tree + presents corners
 *  Dec 27-28  back to winter night snow
 *  Dec 29-31  winter night + New Year fireworks lead-in
 */

interface Scene {
  /** CSS background for the full-bleed backdrop layer. */
  background: string;
  /** True when the backdrop is dark (login card pops on its own). */
  dark: boolean;
  layers: ReactNode;
}

export function getSeasonalScene(now: Date): Scene {
  const m = now.getMonth(); // 0-11
  const d = now.getDate();

  switch (m) {
    case 0: // January
      return {
        background: "linear-gradient(180deg, #eef4fb 0%, #dce8f5 100%)",
        dark: false,
        layers: <ParticleCanvas kind="snow" colors={["#b8cde8", "#cfdef2", "#a3bcdd"]} />,
      };
    case 1: // February
      return {
        background: "linear-gradient(180deg, #fdf4ee 0%, #f8e8e4 100%)",
        dark: false,
        layers:
          d >= 10 && d <= 16 ? (
            <ParticleCanvas kind="hearts" />
          ) : (
            <ParticleCanvas kind="motes" colors={["#f0c4b8", "#f5d8cc"]} count={16} />
          ),
      };
    case 2: // March
      return {
        background: "linear-gradient(180deg, #f1f8ef 0%, #e2f0e1 100%)",
        dark: false,
        layers:
          d >= 13 && d <= 17 ? (
            <>
              <ShamrockCorners />
              <ParticleCanvas kind="motes" colors={["#9fce8f", "#c2e0b4"]} count={14} />
            </>
          ) : (
            <ParticleCanvas kind="motes" colors={["#b4d6a8", "#d4e8ca"]} count={14} />
          ),
      };
    case 3: // April
      return {
        background: "linear-gradient(180deg, #fbf3f7 0%, #edf2fa 100%)",
        dark: false,
        layers: <ParticleCanvas kind="petals" />,
      };
    case 4: // May
      return {
        background: "linear-gradient(180deg, #f5faee 0%, #e9f4e2 100%)",
        dark: false,
        layers: (
          <>
            <FlowerCorners />
            <ParticleCanvas kind="motes" colors={["#f5dc9e", "#fcefc4"]} count={14} />
          </>
        ),
      };
    case 5: // June
      return {
        background: "linear-gradient(180deg, #fdf3d3 0%, #f7e3ae 100%)",
        dark: false,
        layers: (
          <>
            <SunGlow corner="top-right" />
            <ParticleCanvas
              kind="motes"
              colors={["#e8b54a", "#f2cf7e", "#dba12f"]}
              count={32}
            />
          </>
        ),
      };
    case 6: // July
      return {
        background: "linear-gradient(180deg, #141d38 0%, #2a3a63 100%)",
        dark: true,
        layers:
          d <= 10 ? (
            <>
              <ParticleCanvas kind="stars" count={40} />
              <FireworksCanvas mode="ambient" />
            </>
          ) : (
            <ParticleCanvas kind="stars" />
          ),
      };
    case 7: // August
      return {
        background: "linear-gradient(180deg, #251d36 0%, #46324e 100%)",
        dark: true,
        layers: (
          <>
            <ParticleCanvas kind="stars" count={30} />
            <ParticleCanvas kind="fireflies" />
          </>
        ),
      };
    case 8: // September
      return {
        background: "linear-gradient(180deg, #faf4e9 0%, #f2e6d3 100%)",
        dark: false,
        layers: <ParticleCanvas kind="leaves" count={10} />,
      };
    case 9: // October
      return {
        background: "linear-gradient(180deg, #f8efe0 0%, #eeddc2 100%)",
        dark: false,
        layers: (
          <>
            <ParticleCanvas kind="leaves" count={16} />
            <PumpkinCorners />
            <BatFlyby />
          </>
        ),
      };
    case 10: // November
      return {
        background: "linear-gradient(180deg, #f8f1e4 0%, #f0e2cc 100%)",
        dark: false,
        layers: <ParticleCanvas kind="leaves" />,
      };
    default: { // December
      if (d >= 22 && d <= 26) {
        return {
          background: "linear-gradient(180deg, #0d2417 0%, #17402a 100%)",
          dark: true,
          layers: (
            <>
              <ParticleCanvas kind="snow" colors={["#ffffff", "#f5d9d9", "#fdf0c8"]} count={70} />
              <ChristmasCorners />
            </>
          ),
        };
      }
      if (d >= 29) {
        return {
          background: "linear-gradient(180deg, #0c1322 0%, #182441 100%)",
          dark: true,
          layers: (
            <>
              <ParticleCanvas kind="stars" count={35} />
              <FireworksCanvas mode="ambient" />
            </>
          ),
        };
      }
      return {
        background: "linear-gradient(180deg, #0c1322 0%, #16203a 100%)",
        dark: true,
        layers: <ParticleCanvas kind="snow" colors={["#e8f1fb", "#ffffff", "#c4d6ec"]} />,
      };
    }
  }
}

/**
 * Date override for previewing scenes without waiting for the calendar:
 * append ?preview_date=2026-12-24 to the login URL. Harmless in normal
 * use; just lets us demo any month on demand.
 */
function resolveDate(): Date {
  try {
    const param = new URLSearchParams(window.location.search).get("preview_date");
    if (param) {
      const d = new Date(`${param}T12:00:00`);
      if (!Number.isNaN(d.getTime())) return d;
    }
  } catch {
    /* fall through to real date */
  }
  return new Date();
}

export function SeasonalBackdrop() {
  const scene = getSeasonalScene(resolveDate());
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        background: scene.background,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {scene.layers}
    </div>
  );
}
