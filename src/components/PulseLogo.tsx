import { useId } from "react";

/**
 * The Pulse wordmark — mirror-chrome lettering with a fading floor
 * reflection (Nathan picked this style 2026-06-10). Designed to sit on a
 * dark surface; the reflection fades to nothing at the bottom edge of the
 * SVG, so whatever sits below (e.g. the sidebar search section) reads as
 * where the "floor" ends.
 *
 * The reflection is a vertically flipped copy filled with a chrome
 * gradient whose stop opacities ramp to zero — no SVG mask, so it renders
 * identically across browsers despite the flip transform.
 *
 * Variants:
 *   full  — sidebar header wordmark + reflection
 *   mark  — collapsed-sidebar "P" + reflection
 *   login — large login-page wordmark + reflection
 */
interface PulseLogoProps {
  variant?: "full" | "mark" | "login";
  className?: string;
}

const FONT = "'Archivo Black', system-ui, sans-serif";

const CHROME_STOPS = [
  { offset: "0", color: "#fafcff" },
  { offset: "0.35", color: "#cdd5e0" },
  { offset: "0.5", color: "#69758a" },
  { offset: "0.56", color: "#aab4c2" },
  { offset: "0.8", color: "#eef2f7" },
  { offset: "1", color: "#96a1b2" },
];

// Reflection fill: mirrored chrome stops with opacity fading out. The
// reflected glyphs are flipped, so bounding-box offset 0 is the visual
// BOTTOM — opacity therefore ramps 0 -> 0.5 across the stops.
const REFLECTION_STOPS = [
  { offset: "0", color: "#96a1b2", opacity: 0 },
  { offset: "0.45", color: "#eef2f7", opacity: 0.05 },
  { offset: "0.62", color: "#aab4c2", opacity: 0.14 },
  { offset: "0.75", color: "#69758a", opacity: 0.26 },
  { offset: "0.88", color: "#cdd5e0", opacity: 0.38 },
  { offset: "1", color: "#fafcff", opacity: 0.5 },
];

export function PulseLogo({ variant = "full", className }: PulseLogoProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradId = `chrome-${uid}`;
  const reflId = `refl-${uid}`;

  const cfg =
    variant === "login"
      ? { vw: 200, vh: 100, size: 48, base: 46, text: "Pulse", anchor: "middle" as const, x: 100 }
      : variant === "mark"
        ? { vw: 36, vh: 58, size: 30, base: 28, text: "P", anchor: "middle" as const, x: 18 }
        : { vw: 124, vh: 58, size: 28, base: 27, text: "Pulse", anchor: "start" as const, x: 2 };

  const gap = 3;

  return (
    <svg
      viewBox={`0 0 ${cfg.vw} ${cfg.vh}`}
      className={className}
      role="img"
      aria-label="Pulse"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          {CHROME_STOPS.map((s) => (
            <stop key={s.offset} offset={s.offset} stopColor={s.color} />
          ))}
        </linearGradient>
        <linearGradient id={reflId} x1="0" y1="0" x2="0" y2="1">
          {REFLECTION_STOPS.map((s) => (
            <stop
              key={s.offset}
              offset={s.offset}
              stopColor={s.color}
              stopOpacity={s.opacity}
            />
          ))}
        </linearGradient>
      </defs>

      <text
        x={cfg.x}
        y={cfg.base}
        textAnchor={cfg.anchor}
        fontFamily={FONT}
        fontSize={cfg.size}
        fill={`url(#${gradId})`}
        stroke="#20242e"
        strokeWidth="0.6"
      >
        {cfg.text}
      </text>

      <g transform={`translate(0, ${2 * cfg.base + gap}) scale(1, -1)`}>
        <text
          x={cfg.x}
          y={cfg.base}
          textAnchor={cfg.anchor}
          fontFamily={FONT}
          fontSize={cfg.size}
          fill={`url(#${reflId})`}
        >
          {cfg.text}
        </text>
      </g>
    </svg>
  );
}
