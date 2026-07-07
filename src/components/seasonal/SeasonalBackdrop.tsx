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
 * Seasonal login backdrop (Nathan's approved 2026-06-10 timeline, palettes
 * boldened per his 2026-06-10 review — "hint of hint of color" months got
 * real color, September went dark, October separated from November).
 * Login page only — pure decoration, switches by date.
 *
 *  Jan        icy morning blues, gentle snow
 *  Feb        lavender dusk; Feb 10-16 soft pink + floating hearts
 *  Mar        deep emerald; Mar 13-17 shamrocks
 *  Apr        spring sky over meadow, petals all month
 *  May        lush garden green, flowers in the corners
 *  Jun        bold summer sky with sun glow
 *  Jul        dusk sky; Jul 1-6 ambient fireworks; stars after
 *  Aug        late-summer dusk, fireflies
 *  Sep        burnt golden-hour dusk, sparse leaves
 *  Oct        Halloween twilight, pumpkins + unpredictable bat
 *  Nov        saturated harvest gold, leaves all month
 *  Dec 1-21   dark winter night, light snow
 *  Dec 22-26  Christmas: deep green, tree + presents corners
 *  Dec 27-28  winter night snow
 *  Dec 29-31  winter night + New Year fireworks lead-in
 */

export interface Scene {
  /** CSS background for the full-bleed backdrop layer. */
  background: string;
  /** True when the backdrop is dark — the floating login flips to light text. */
  dark: boolean;
  layers: ReactNode;
}

export function getSeasonalScene(now: Date): Scene {
  const m = now.getMonth(); // 0-11
  const d = now.getDate();

  switch (m) {
    case 0: // January
      return {
        background: "linear-gradient(180deg, #cfe2f4 0%, #9fc2e4 100%)",
        dark: false,
        layers: <ParticleCanvas kind="snow" colors={["#ffffff", "#e4eefa", "#7ba3cf"]} />,
      };
    case 1: // February
      if (d >= 10 && d <= 16) {
        return {
          background: "linear-gradient(180deg, #f7d4dc 0%, #eba8bc 100%)",
          dark: false,
          layers: <ParticleCanvas kind="hearts" />,
        };
      }
      return {
        background:
          "linear-gradient(180deg, #5d5aa8 0%, #8f7cc4 55%, #d9a8c0 100%)",
        dark: true,
        layers: (
          <ParticleCanvas kind="motes" colors={["#f2d8e8", "#cfc4f0", "#ffffff"]} count={24} />
        ),
      };
    case 2: // March
      return {
        background: "linear-gradient(180deg, #175c39 0%, #2f8a57 60%, #57ab74 100%)",
        dark: true,
        layers:
          d >= 13 && d <= 17 ? (
            <>
              <ShamrockCorners />
              <ParticleCanvas kind="motes" colors={["#bfe8b0", "#e4f5d8", "#8fd49a"]} count={20} />
            </>
          ) : (
            <ParticleCanvas kind="motes" colors={["#bfe8b0", "#e4f5d8"]} count={18} />
          ),
      };
    case 3: // April
      return {
        background: "linear-gradient(180deg, #8ec6ea 0%, #b8e0d8 55%, #cfe9c0 100%)",
        dark: false,
        layers: (
          <ParticleCanvas
            kind="petals"
            colors={["#f06ba0", "#f48cb2", "#e85d8a", "#fbc0d4"]}
            count={30}
          />
        ),
      };
    case 4: // May
      // Deepened + flipped to light text (Nathan: mid-tone green made
      // dark text hard to read).
      return {
        background: "linear-gradient(180deg, #6fb554 0%, #459344 60%, #2e7a37 100%)",
        dark: true,
        layers: (
          <>
            <FlowerCorners />
            <ParticleCanvas kind="motes" colors={["#fff3b8", "#ffe27a", "#ffffff"]} count={20} />
          </>
        ),
      };
    case 5: // June
      return {
        background:
          "linear-gradient(180deg, #3f97e0 0%, #8fc8f2 55%, #fbe3a3 100%)",
        dark: false,
        layers: (
          <>
            <SunGlow corner="top-right" />
            <ParticleCanvas kind="motes" colors={["#fff6d8", "#ffe9a8", "#ffffff"]} count={26} />
          </>
        ),
      };
    case 6: // July
      return {
        background: "linear-gradient(180deg, #141d38 0%, #2a3a63 100%)",
        dark: true,
        layers:
          // Fireworks through July 6 — a short tail past the 4th, not a
          // week-plus (Nathan, 2026-07-07: 10 days read as stale).
          d <= 6 ? (
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
        background:
          "linear-gradient(180deg, #4a1f10 0%, #8a3f1e 55%, #c2702f 100%)",
        dark: true,
        layers: <ParticleCanvas kind="leaves" count={12} />,
      };
    case 9: // October
      return {
        background:
          "linear-gradient(180deg, #1d1230 0%, #45203c 55%, #76341f 100%)",
        dark: true,
        layers: (
          <>
            <ParticleCanvas kind="stars" count={16} />
            <ParticleCanvas kind="leaves" count={14} />
            <PumpkinCorners />
            <BatFlyby />
          </>
        ),
      };
    case 10: // November
      // Deepened to bronze + light text (same readability fix as May).
      return {
        background: "linear-gradient(180deg, #cf9d54 0%, #b07433 55%, #8e5a24 100%)",
        dark: true,
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
export function resolveSceneDate(): Date {
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

export function SeasonalBackdrop({ scene }: { scene?: Scene }) {
  const s = scene ?? getSeasonalScene(resolveSceneDate());
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        background: s.background,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {s.layers}
    </div>
  );
}
