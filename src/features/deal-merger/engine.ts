// Pure Deal Merger (2048-style) engine — no React, no side effects.
//
// Tiles are deal memos on a 4×4 desk. A move slides every tile as far as it
// goes; two equal deals that collide MERGE into one deal of the next tier
// (each tile merges at most once per move — standard 2048 rule). Every merge
// adds the new deal's dollar value to the score ("total closed"), so the
// leaderboard number rewards both surviving long and building big.
//
// Tier t is worth 500 · 2^t dollars: $500, $1K, $2K … $512K, then tier 11 is
// the "$1M" contract (1,024,000 — labels round, math doubles). The engine is
// deterministic when you inject an rng, which is how the tests pin behavior.

export const SIZE = 4;
export const BASE_VALUE = 500;
export const MILLION_TIER = 11; // 500 · 2^11 = 1,024,000 → the "$1M" deal

export type Dir = "up" | "down" | "left" | "right";

export interface Tile {
  id: number;
  r: number;
  c: number;
  tier: number;
  /** one-shot flags for the most recent move (drive pop / spawn animations) */
  justMerged?: boolean;
  isNew?: boolean;
}

/** A tile consumed by a merge, positioned at its destination for the slide-out. */
export interface Ghost {
  id: number;
  r: number;
  c: number;
  tier: number;
}

export interface GameState {
  tiles: Tile[];
  score: number;
  moves: number;
  highestTier: number;
  over: boolean;
  /** reached the $1M tile at least once this game */
  won: boolean;
  nextId: number;
}

export interface MoveOutcome {
  state: GameState;
  moved: boolean;
  /** dollar value gained by merges this move */
  gained: number;
  ghosts: Ghost[];
  /** merges this move, at their destination cells (for ink popups) */
  merges: { r: number; c: number; tier: number; value: number }[];
}

export function tierValue(tier: number): number {
  return BASE_VALUE * 2 ** tier;
}

/** "$500", "$1K" … "$512K", "$1M", "$2M" … (labels round; values double). */
export function tierLabel(tier: number): string {
  if (tier <= 0) return "$500";
  if (tier < MILLION_TIER) return `$${2 ** tier / 2}K`;
  return `$${2 ** (tier - MILLION_TIER)}M`;
}

export function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

type Rng = () => number;

function spawnTile(state: GameState, rng: Rng): Tile | null {
  const taken = new Set(state.tiles.map((t) => t.r * SIZE + t.c));
  const empty: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (!taken.has(i)) empty.push(i);
  if (empty.length === 0) return null;
  const cell = empty[Math.min(empty.length - 1, Math.floor(rng() * empty.length))];
  const tile: Tile = {
    id: state.nextId++,
    r: Math.floor(cell / SIZE),
    c: cell % SIZE,
    tier: rng() < 0.9 ? 0 : 1,
    isNew: true,
  };
  state.tiles.push(tile);
  if (tile.tier > state.highestTier) state.highestTier = tile.tier;
  return tile;
}

export function newGame(rng: Rng = Math.random): GameState {
  const state: GameState = {
    tiles: [],
    score: 0,
    moves: 0,
    highestTier: 0,
    over: false,
    won: false,
    nextId: 1,
  };
  spawnTile(state, rng);
  spawnTile(state, rng);
  return state;
}

/** Any legal move left? False only when the board is full and frozen. */
export function canMove(tiles: Tile[]): boolean {
  if (tiles.length < SIZE * SIZE) return true;
  const grid: (number | undefined)[] = new Array(SIZE * SIZE);
  for (const t of tiles) grid[t.r * SIZE + t.c] = t.tier;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const tier = grid[r * SIZE + c];
      if (c + 1 < SIZE && grid[r * SIZE + c + 1] === tier) return true;
      if (r + 1 < SIZE && grid[(r + 1) * SIZE + c] === tier) return true;
    }
  }
  return false;
}

/**
 * Slide + merge in `dir`, then (if anything moved) spawn one new deal.
 * Returns a NEW state — the input is never mutated.
 */
export function move(prev: GameState, dir: Dir, rng: Rng = Math.random): MoveOutcome {
  const state: GameState = {
    ...prev,
    tiles: prev.tiles.map((t) => ({ ...t, justMerged: false, isNew: false })),
  };

  const horizontal = dir === "left" || dir === "right";
  // For each line, sort tiles nearest-to-wall first, then compact/merge.
  const towardWall = dir === "left" || dir === "up"; // wall at index 0
  const ghosts: Ghost[] = [];
  const merges: MoveOutcome["merges"] = [];
  let moved = false;
  let gained = 0;

  for (let line = 0; line < SIZE; line++) {
    const inLine = state.tiles
      .filter((t) => (horizontal ? t.r : t.c) === line)
      .sort((a, b) => {
        const pa = horizontal ? a.c : a.r;
        const pb = horizontal ? b.c : b.r;
        return towardWall ? pa - pb : pb - pa;
      });

    let out = 0; // slots filled from the wall, in traversal order
    let last: Tile | null = null;
    for (const t of inLine) {
      if (last && last.tier === t.tier && !last.justMerged) {
        // t is consumed into `last`, which has already landed.
        ghosts.push({ id: t.id, r: last.r, c: last.c, tier: t.tier });
        state.tiles = state.tiles.filter((x) => x.id !== t.id);
        last.tier += 1;
        last.justMerged = true;
        const value = tierValue(last.tier);
        gained += value;
        merges.push({ r: last.r, c: last.c, tier: last.tier, value });
        if (last.tier > state.highestTier) state.highestTier = last.tier;
        moved = true;
      } else {
        const pos = towardWall ? out : SIZE - 1 - out;
        const before = horizontal ? t.c : t.r;
        if (horizontal) t.c = pos;
        else t.r = pos;
        if (before !== pos) moved = true;
        out++;
        last = t;
      }
    }
  }

  if (!moved) return { state: prev, moved: false, gained: 0, ghosts: [], merges: [] };

  state.score += gained;
  state.moves += 1;
  if (state.highestTier >= MILLION_TIER) state.won = true;
  spawnTile(state, rng);
  state.over = !canMove(state.tiles);
  return { state, moved: true, gained, ghosts, merges };
}

// ---- persistence (localStorage) ------------------------------------------
// A calm game invites long runs; closing the window shouldn't torch a good
// board. The saved shape is validated hard so corrupted/foreign data can only
// ever fall back to a fresh game, never crash the UI.

export interface SavedRun {
  v: 1;
  tiles: { id: number; r: number; c: number; tier: number }[];
  score: number;
  moves: number;
  won: boolean;
}

export function serialize(state: GameState): SavedRun {
  return {
    v: 1,
    tiles: state.tiles.map(({ id, r, c, tier }) => ({ id, r, c, tier })),
    score: state.score,
    moves: state.moves,
    won: state.won,
  };
}

export function deserialize(raw: unknown): GameState | null {
  try {
    const s = raw as SavedRun;
    if (!s || s.v !== 1 || !Array.isArray(s.tiles)) return null;
    if (s.tiles.length < 1 || s.tiles.length > SIZE * SIZE) return null;
    const seen = new Set<number>();
    for (const t of s.tiles) {
      if (
        !Number.isInteger(t.r) || t.r < 0 || t.r >= SIZE ||
        !Number.isInteger(t.c) || t.c < 0 || t.c >= SIZE ||
        !Number.isInteger(t.tier) || t.tier < 0 || t.tier > 30
      ) {
        return null;
      }
      const cell = t.r * SIZE + t.c;
      if (seen.has(cell)) return null;
      seen.add(cell);
    }
    if (typeof s.score !== "number" || !Number.isFinite(s.score) || s.score < 0) return null;
    const tiles: Tile[] = s.tiles.map((t, i) => ({ id: i + 1, r: t.r, c: t.c, tier: t.tier }));
    const highestTier = Math.max(...tiles.map((t) => t.tier));
    return {
      tiles,
      score: Math.round(s.score),
      moves: Number.isInteger(s.moves) && s.moves >= 0 ? s.moves : 0,
      highestTier,
      over: !canMove(tiles),
      won: !!s.won || highestTier >= MILLION_TIER,
      nextId: tiles.length + 1,
    };
  } catch {
    return null;
  }
}
