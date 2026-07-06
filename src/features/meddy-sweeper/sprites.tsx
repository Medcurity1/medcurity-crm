// Hand-drawn 8-bit Meddy sprites for MeddySweeper. Classic NES look — flat
// blocky colors, hard edges, Meddy's brand palette (red-orange + blue), no
// gradients or glow. All use shapeRendering "crispEdges" so they stay sharp.

export type FaceState = "idle" | "worried" | "won" | "lost";

const RED = "#ea4a2f"; // Meddy red-orange
const RED_DK = "#be3620"; // ambient shading
const BLACK = "#1b1b1f";
const WHITE = "#ffffff";
const BLUE = "#2f6fe0";

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

/** The reactive Meddy mascot — the "new game" reset face. */
export function MeddyFace({ state = "idle", size = 44 }: { state?: FaceState; size?: number }) {
  return (
    <Svg size={size}>
      {headRects()}
      {/* eyes */}
      {state === "lost" ? (
        <>
          {r(4, 6, 1, 1, BLACK, "x1")}{r(5, 7, 1, 1, BLACK, "x2")}{r(6, 8, 1, 1, BLACK, "x3")}
          {r(6, 6, 1, 1, BLACK, "x4")}{r(4, 8, 1, 1, BLACK, "x5")}
          {r(9, 6, 1, 1, BLACK, "x6")}{r(10, 7, 1, 1, BLACK, "x7")}{r(11, 8, 1, 1, BLACK, "x8")}
          {r(11, 6, 1, 1, BLACK, "x9")}{r(9, 8, 1, 1, BLACK, "x10")}
        </>
      ) : (
        <>
          {r(5, 6, 2, 3, BLACK, "el")}
          {r(9, 6, 2, 3, BLACK, "er")}
          {r(5, 6, 1, 1, WHITE, "hl")}
          {r(9, 6, 1, 1, WHITE, "hr")}
        </>
      )}
      {/* mouth */}
      {state === "idle" && <>{r(5, 11, 1, 1, BLACK, "m1")}{r(6, 12, 4, 1, BLACK, "m2")}{r(10, 11, 1, 1, BLACK, "m3")}</>}
      {state === "worried" && <>{r(7, 11, 2, 2, BLACK, "m1")}</>}
      {state === "won" && <>{r(5, 11, 6, 1, BLACK, "m1")}{r(6, 12, 4, 1, BLACK, "m2")}{r(6, 12, 4, 1, WHITE, "mt")}</>}
      {state === "lost" && <>{r(6, 12, 4, 1, BLACK, "m1")}{r(5, 13, 1, 1, BLACK, "m2")}{r(10, 13, 1, 1, BLACK, "m3")}</>}
    </Svg>
  );
}

/** A flag — mark a cell where you think a Meddy is hiding. */
export function FlagSprite({ size = 22, wrong = false }: { size?: number; wrong?: boolean }) {
  const pennant = wrong ? "#9aa3b2" : RED;
  return (
    <Svg size={size}>
      {/* pole */}
      {r(8, 2, 1, 11, BLACK, "pole")}
      {/* pennant (points left from the pole top) */}
      {r(4, 3, 4, 1, pennant, "p1")}
      {r(5, 4, 3, 1, pennant, "p2")}
      {r(6, 5, 2, 1, pennant, "p3")}
      {/* base */}
      {r(5, 13, 6, 1, BLACK, "b1")}
      {r(6, 12, 4, 1, BLUE, "b2")}
      {wrong && (
        <>
          {r(4, 4, 1, 1, "#e0392b", "w1")}{r(5, 5, 1, 1, "#e0392b", "w2")}
          {r(6, 4, 1, 1, "#e0392b", "w3")}{r(4, 6, 1, 1, "#e0392b", "w4")}
        </>
      )}
    </Svg>
  );
}
