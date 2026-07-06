// Hand-drawn 8-bit SVG sprites for MeddySweeper. All use shapeRendering
// "crispEdges" so they stay pixel-sharp at any size. Colors are baked to the
// game's neon palette (kept intentionally distinct from Pipeline Runner).

export type FaceState = "idle" | "worried" | "won" | "lost";

const TEAL = "#2ee6c8";
const TEAL_DK = "#12a892";
const SCREEN = "#0a1024";
const INK_DARK = "#050914";
const AMBER = "#ffcf4d";
const RED = "#ff3d6e";

/** The reactive Meddy mascot — doubles as the "new game" reset button face. */
export function MeddyFace({ state = "idle", size = 46 }: { state?: FaceState; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated", display: "block" }}
      aria-hidden="true"
    >
      {/* antenna */}
      <rect x="11" y="1" width="2" height="3" fill={TEAL_DK} />
      <rect x="10" y="0" width="4" height="2" fill={AMBER} />
      {/* head shell */}
      <rect x="4" y="4" width="16" height="15" fill={TEAL} />
      <rect x="3" y="6" width="1" height="11" fill={TEAL_DK} />
      <rect x="20" y="6" width="1" height="11" fill={TEAL_DK} />
      <rect x="4" y="19" width="16" height="1" fill={TEAL_DK} />
      {/* ear bolts */}
      <rect x="2" y="9" width="2" height="5" fill={AMBER} />
      <rect x="20" y="9" width="2" height="5" fill={AMBER} />
      {/* face screen */}
      <rect x="6" y="6" width="12" height="10" fill={SCREEN} />

      {/* expression */}
      {state === "idle" && (
        <>
          <rect x="8" y="8" width="2" height="3" fill={TEAL} />
          <rect x="14" y="8" width="2" height="3" fill={TEAL} />
          <rect x="9" y="13" width="6" height="1" fill={TEAL} />
          <rect x="8" y="12" width="1" height="1" fill={TEAL} />
          <rect x="15" y="12" width="1" height="1" fill={TEAL} />
        </>
      )}
      {state === "worried" && (
        <>
          <rect x="8" y="8" width="3" height="3" fill={AMBER} />
          <rect x="13" y="8" width="3" height="3" fill={AMBER} />
          <rect x="10" y="12" width="4" height="3" fill={AMBER} />
          <rect x="11" y="13" width="2" height="1" fill={SCREEN} />
        </>
      )}
      {state === "won" && (
        <>
          {/* cool shades */}
          <rect x="7" y="8" width="4" height="3" fill={AMBER} />
          <rect x="13" y="8" width="4" height="3" fill={AMBER} />
          <rect x="11" y="9" width="2" height="1" fill={AMBER} />
          <rect x="9" y="13" width="6" height="1" fill={TEAL} />
          <rect x="8" y="12" width="1" height="1" fill={TEAL} />
          <rect x="15" y="12" width="1" height="1" fill={TEAL} />
        </>
      )}
      {state === "lost" && (
        <>
          {/* X eyes */}
          <rect x="8" y="8" width="1" height="1" fill={RED} />
          <rect x="9" y="9" width="1" height="1" fill={RED} />
          <rect x="10" y="10" width="1" height="1" fill={RED} />
          <rect x="10" y="8" width="1" height="1" fill={RED} />
          <rect x="9" y="9" width="1" height="1" fill={RED} />
          <rect x="8" y="10" width="1" height="1" fill={RED} />
          <rect x="14" y="8" width="1" height="1" fill={RED} />
          <rect x="15" y="9" width="1" height="1" fill={RED} />
          <rect x="16" y="10" width="1" height="1" fill={RED} />
          <rect x="16" y="8" width="1" height="1" fill={RED} />
          <rect x="14" y="10" width="1" height="1" fill={RED} />
          {/* frown */}
          <rect x="9" y="14" width="6" height="1" fill={RED} />
          <rect x="8" y="13" width="1" height="1" fill={RED} />
          <rect x="15" y="13" width="1" height="1" fill={RED} />
        </>
      )}
    </svg>
  );
}

/** A "threat" — the mine. A blocky red germ with spikes. */
export function ThreatSprite({ size = 22, dim = false }: { size?: number; dim?: boolean }) {
  const body = dim ? "#a3324c" : RED;
  const spike = dim ? "#7c2038" : "#ff789b";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block" }}>
      {/* spikes */}
      <rect x="7" y="1" width="2" height="2" fill={spike} />
      <rect x="7" y="13" width="2" height="2" fill={spike} />
      <rect x="1" y="7" width="2" height="2" fill={spike} />
      <rect x="13" y="7" width="2" height="2" fill={spike} />
      <rect x="3" y="3" width="2" height="2" fill={spike} />
      <rect x="11" y="3" width="2" height="2" fill={spike} />
      <rect x="3" y="11" width="2" height="2" fill={spike} />
      <rect x="11" y="11" width="2" height="2" fill={spike} />
      {/* body */}
      <rect x="5" y="4" width="6" height="8" fill={body} />
      <rect x="4" y="5" width="8" height="6" fill={body} />
      {/* menacing eyes */}
      <rect x="6" y="6" width="2" height="2" fill={INK_DARK} />
      <rect x="9" y="6" width="1" height="2" fill={INK_DARK} />
      <rect x="6" y="9" width="4" height="1" fill={INK_DARK} />
    </svg>
  );
}

/** A shield — the "flag". Marks a cell you suspect hides a threat. */
export function ShieldSprite({ size = 22, wrong = false }: { size?: number; wrong?: boolean }) {
  const face = wrong ? "#7c8598" : "#38bdf8";
  const edge = wrong ? "#525b6b" : "#0b74c4";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true" style={{ display: "block" }}>
      {/* shield outline */}
      <rect x="4" y="2" width="8" height="1" fill={edge} />
      <rect x="3" y="3" width="10" height="6" fill={face} />
      <rect x="4" y="9" width="8" height="2" fill={face} />
      <rect x="5" y="11" width="6" height="1" fill={face} />
      <rect x="6" y="12" width="4" height="1" fill={face} />
      <rect x="7" y="13" width="2" height="1" fill={edge} />
      <rect x="3" y="3" width="1" height="6" fill={edge} />
      <rect x="12" y="3" width="1" height="6" fill={edge} />
      {wrong ? (
        <>
          {/* red X for a mis-shielded safe cell */}
          <rect x="5" y="4" width="1" height="1" fill={RED} />
          <rect x="6" y="5" width="1" height="1" fill={RED} />
          <rect x="7" y="6" width="1" height="1" fill={RED} />
          <rect x="8" y="7" width="1" height="1" fill={RED} />
          <rect x="9" y="4" width="1" height="1" fill={RED} />
          <rect x="8" y="5" width="1" height="1" fill={RED} />
          <rect x="6" y="7" width="1" height="1" fill={RED} />
        </>
      ) : (
        <>
          {/* check mark */}
          <rect x="6" y="6" width="1" height="1" fill="#eafcff" />
          <rect x="7" y="7" width="1" height="1" fill="#eafcff" />
          <rect x="8" y="6" width="1" height="1" fill="#eafcff" />
          <rect x="9" y="5" width="1" height="1" fill="#eafcff" />
        </>
      )}
    </svg>
  );
}
