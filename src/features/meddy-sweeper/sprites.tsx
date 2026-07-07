// Hand-drawn 8-bit Meddy sprites for MeddySweeper. Classic NES look — flat
// blocky colors, hard edges, Meddy's brand palette (red-orange + blue), no
// gradients or glow. All use shapeRendering "crispEdges" so they stay sharp.

export type FaceState = "idle" | "worried" | "won" | "lost";

const RED = "#ea4a2f"; // Meddy red-orange
const RED_DK = "#be3620"; // ambient shading
const BLACK = "#1b1b1f";
const WHITE = "#ffffff";

// Silhouette of the round Meddy head, per row: [y, xStart, xEnd] inclusive.
const SIL: [number, number, number][] = [
  [1, 6, 9], [2, 4, 11], [3, 3, 12], [4, 2, 13], [5, 1, 14], [6, 1, 14],
  [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 1, 14], [11, 2, 13], [12, 3, 12],
  [13, 4, 11], [14, 6, 9],
];
// Darker red patch, lower-left, for a touch of dimension (matches the drawing).
const SHADE: [number, number, number][] = [[10, 2, 4], [11, 2, 4], [12, 3, 5], [13, 4, 6]];

function r(x: number, y: number, w: number, h: number, fill: string, key: string) {
  return <rect key={key} x={x} y={y} width={w} height={h} fill={fill} />;
}

/** The red-orange Meddy head base (outline + fill + shading), no features. */
function headRects(): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // black silhouette
  for (const [y, x0, x1] of SIL) out.push(r(x0, y, x1 - x0 + 1, 1, BLACK, `b${y}`));
  // red fill inset by 1 (leaves a 1px black outline all around)
  for (const [y, x0, x1] of SIL) {
    if (y === SIL[0][0] || y === SIL[SIL.length - 1][0]) continue; // black cap top/bottom
    out.push(r(x0 + 1, y, x1 - x0 - 1, 1, RED, `r${y}`));
  }
  for (const [y, x0, x1] of SHADE) out.push(r(x0, y, x1 - x0 + 1, 1, RED_DK, `s${y}`));
  return out;
}

function Svg({ size, vb = 16, children }: { size: number; vb?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated", display: "block" }} aria-hidden="true">
      {children}
    </svg>
  );
}

/** A hidden Meddy — the "mine". Uncover one and it's game over. */
export function MeddyMine({ size = 22, dead = false }: { size?: number; dead?: boolean }) {
  return (
    <Svg size={size}>
      {headRects()}
      {!dead ? (
        <>
          {/* eyes with a white highlight, like the drawing */}
          {r(5, 6, 2, 3, BLACK, "el")}
          {r(9, 6, 2, 3, BLACK, "er")}
          {r(5, 6, 1, 1, WHITE, "hl")}
          {r(9, 6, 1, 1, WHITE, "hr")}
        </>
      ) : (
        <>
          {/* X eyes */}
          {r(4, 6, 1, 1, BLACK, "x1")}{r(5, 7, 1, 1, BLACK, "x2")}{r(6, 8, 1, 1, BLACK, "x3")}
          {r(6, 6, 1, 1, BLACK, "x4")}{r(4, 8, 1, 1, BLACK, "x5")}
          {r(9, 6, 1, 1, BLACK, "x6")}{r(10, 7, 1, 1, BLACK, "x7")}{r(11, 8, 1, 1, BLACK, "x8")}
          {r(11, 6, 1, 1, BLACK, "x9")}{r(9, 8, 1, 1, BLACK, "x10")}
        </>
      )}
    </Svg>
  );
}

/** The reactive Meddy mascot — the "new game" reset face. Meddy has no mouth
 *  (canon), so expressions come from the eyes/brows: calm, worried brows +
 *  a sweat bead, cool shades on a win, and X-eyes when he faints. */
export function MeddyFace({ state = "idle", size = 44 }: { state?: FaceState; size?: number }) {
  return (
    <Svg size={size}>
      {headRects()}
      {state === "lost" && (
        <>
          {r(4, 6, 1, 1, BLACK, "x1")}{r(5, 7, 1, 1, BLACK, "x2")}{r(6, 8, 1, 1, BLACK, "x3")}
          {r(6, 6, 1, 1, BLACK, "x4")}{r(4, 8, 1, 1, BLACK, "x5")}
          {r(9, 6, 1, 1, BLACK, "x6")}{r(10, 7, 1, 1, BLACK, "x7")}{r(11, 8, 1, 1, BLACK, "x8")}
          {r(11, 6, 1, 1, BLACK, "x9")}{r(9, 8, 1, 1, BLACK, "x10")}
        </>
      )}
      {state === "won" && (
        <>
          {/* cool shades */}
          {r(3, 6, 4, 3, BLACK, "gl")}
          {r(9, 6, 4, 3, BLACK, "gr")}
          {r(6, 7, 4, 1, BLACK, "gb")}
          {r(4, 6, 1, 1, WHITE, "g1")}
          {r(10, 6, 1, 1, WHITE, "g2")}
        </>
      )}
      {(state === "idle" || state === "worried") && (
        <>
          {r(5, 6, 2, 3, BLACK, "el")}
          {r(9, 6, 2, 3, BLACK, "er")}
          {r(5, 6, 1, 1, WHITE, "hl")}
          {r(9, 6, 1, 1, WHITE, "hr")}
        </>
      )}
      {state === "worried" && (
        <>
          {/* brows sloping up toward the middle + a sweat bead */}
          {r(4, 5, 2, 1, BLACK, "bl")}{r(6, 4, 1, 1, BLACK, "bl2")}
          {r(10, 5, 2, 1, BLACK, "br")}{r(9, 4, 1, 1, BLACK, "br2")}
          {r(12, 4, 1, 2, "#38bdf8", "sweat")}
        </>
      )}
    </Svg>
  );
}

/** A shield — mark a cell where you think a Meddy is hiding. */
export function ShieldSprite({ size = 22, wrong = false }: { size?: number; wrong?: boolean }) {
  const face = wrong ? "#9aa3b2" : "#2f6fe0";
  const edge = wrong ? "#6b7280" : "#1e50b0";
  return (
    <Svg size={size}>
      {r(4, 2, 8, 1, edge, "t")}
      {r(3, 3, 10, 6, face, "b1")}
      {r(4, 9, 8, 2, face, "b2")}
      {r(5, 11, 6, 1, face, "b3")}
      {r(6, 12, 4, 1, face, "b4")}
      {r(7, 13, 2, 1, edge, "tip")}
      {r(3, 3, 1, 6, edge, "le")}
      {r(12, 3, 1, 6, edge, "re")}
      {wrong ? (
        <>
          {r(5, 4, 1, 1, "#e0392b", "w1")}{r(6, 5, 1, 1, "#e0392b", "w2")}
          {r(7, 6, 1, 1, "#e0392b", "w3")}{r(9, 4, 1, 1, "#e0392b", "w4")}
          {r(8, 5, 1, 1, "#e0392b", "w5")}{r(6, 7, 1, 1, "#e0392b", "w6")}
        </>
      ) : (
        <>
          {r(6, 6, 1, 1, WHITE, "c1")}{r(7, 7, 1, 1, WHITE, "c2")}
          {r(8, 6, 1, 1, WHITE, "c3")}{r(9, 5, 1, 1, WHITE, "c4")}
        </>
      )}
    </Svg>
  );
}
