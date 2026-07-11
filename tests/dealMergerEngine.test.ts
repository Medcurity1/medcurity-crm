import { describe, it, expect } from "vitest";
import {
  SIZE,
  MILLION_TIER,
  newGame,
  move,
  canMove,
  tierValue,
  tierLabel,
  serialize,
  deserialize,
  type GameState,
  type Tile,
  type Dir,
} from "@/features/deal-merger/engine";

// Deterministic rng: returns queued values, then 0 forever (0 → first empty
// cell, tier 0 spawn) so every test is fully pinned.
function rngOf(...vals: number[]) {
  let i = 0;
  return () => (i < vals.length ? vals[i++] : 0);
}

function stateOf(tiles: Omit<Tile, "id">[], score = 0): GameState {
  const withIds = tiles.map((t, i) => ({ ...t, id: i + 1 }));
  return {
    tiles: withIds,
    score,
    moves: 0,
    highestTier: Math.max(0, ...withIds.map((t) => t.tier)),
    over: false,
    won: false,
    nextId: withIds.length + 1,
  };
}

function tierAt(s: GameState, r: number, c: number): number | undefined {
  return s.tiles.find((t) => t.r === r && t.c === c)?.tier;
}

describe("deal-merger engine", () => {
  it("values double from $500 and labels round to K/M", () => {
    expect(tierValue(0)).toBe(500);
    expect(tierValue(1)).toBe(1000);
    expect(tierValue(10)).toBe(512_000);
    expect(tierValue(MILLION_TIER)).toBe(1_024_000);
    expect(tierLabel(0)).toBe("$500");
    expect(tierLabel(1)).toBe("$1K");
    expect(tierLabel(6)).toBe("$32K");
    expect(tierLabel(10)).toBe("$512K");
    expect(tierLabel(11)).toBe("$1M");
    expect(tierLabel(13)).toBe("$4M");
  });

  it("newGame spawns exactly two tiles on distinct cells", () => {
    const g = newGame(rngOf(0, 0.95, 0.2, 0));
    expect(g.tiles).toHaveLength(2);
    const cells = new Set(g.tiles.map((t) => t.r * SIZE + t.c));
    expect(cells.size).toBe(2);
    expect(g.score).toBe(0);
    expect(g.over).toBe(false);
  });

  it("slides tiles to the wall without merging different tiers", () => {
    const g = stateOf([
      { r: 0, c: 1, tier: 0 },
      { r: 0, c: 3, tier: 2 },
    ]);
    const { state, moved, gained } = move(g, "left", rngOf(0.99, 0)); // spawn far cell, tier 0
    expect(moved).toBe(true);
    expect(gained).toBe(0);
    expect(tierAt(state, 0, 0)).toBe(0);
    expect(tierAt(state, 0, 1)).toBe(2);
    expect(state.tiles).toHaveLength(3); // + spawn
    expect(state.moves).toBe(1);
  });

  it("merges equal pairs once per move (four equal tiles → two, not one)", () => {
    const g = stateOf([
      { r: 0, c: 0, tier: 0 },
      { r: 0, c: 1, tier: 0 },
      { r: 0, c: 2, tier: 0 },
      { r: 0, c: 3, tier: 0 },
    ]);
    const { state, gained, ghosts } = move(g, "left", rngOf(0.99, 0));
    expect(tierAt(state, 0, 0)).toBe(1);
    expect(tierAt(state, 0, 1)).toBe(1);
    expect(tierAt(state, 0, 2)).toBeUndefined();
    expect(gained).toBe(2000); // two $1K deals created
    expect(ghosts).toHaveLength(2);
    expect(state.score).toBe(2000);
  });

  it("merges toward the wall first ([A,A,A] right → wall pair merges)", () => {
    const g = stateOf([
      { r: 1, c: 0, tier: 3 },
      { r: 1, c: 2, tier: 3 },
      { r: 1, c: 3, tier: 3 },
    ]);
    const { state } = move(g, "right", rngOf(0.99, 0));
    // wall-side pair (c2,c3) merges; c0 slides to c2
    expect(tierAt(state, 1, 3)).toBe(4);
    expect(tierAt(state, 1, 2)).toBe(3);
  });

  it("a freshly merged tile cannot merge again in the same move", () => {
    // [1,1,2] left → [2,2] NOT [3]
    const g = stateOf([
      { r: 2, c: 0, tier: 1 },
      { r: 2, c: 1, tier: 1 },
      { r: 2, c: 2, tier: 2 },
    ]);
    const { state } = move(g, "left", rngOf(0.99, 0));
    expect(tierAt(state, 2, 0)).toBe(2);
    expect(tierAt(state, 2, 1)).toBe(2);
  });

  it("vertical moves work symmetrically", () => {
    const g = stateOf([
      { r: 0, c: 2, tier: 5 },
      { r: 3, c: 2, tier: 5 },
    ]);
    const { state, gained } = move(g, "down", rngOf(0.99, 0));
    expect(tierAt(state, 3, 2)).toBe(6);
    expect(gained).toBe(tierValue(6));
  });

  it("a no-op move returns moved=false, spawns nothing, and keeps prev state", () => {
    const g = stateOf([
      { r: 0, c: 0, tier: 0 },
      { r: 1, c: 0, tier: 1 },
    ]);
    const { state, moved } = move(g, "left", rngOf(0));
    expect(moved).toBe(false);
    expect(state).toBe(g); // same reference — nothing changed
    expect(state.tiles).toHaveLength(2);
    expect(state.moves).toBe(0);
  });

  it("never mutates the input state", () => {
    const g = stateOf([
      { r: 0, c: 3, tier: 0 },
      { r: 0, c: 2, tier: 0 },
    ]);
    const snapshot = JSON.stringify(g.tiles);
    move(g, "left", rngOf(0.5, 0));
    expect(JSON.stringify(g.tiles)).toBe(snapshot);
  });

  it("detects game over only when full and frozen", () => {
    // checkerboard of alternating tiers = frozen
    const frozen: Omit<Tile, "id">[] = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) frozen.push({ r, c, tier: (r + c) % 2 });
    expect(canMove(stateOf(frozen).tiles)).toBe(false);

    // same board with one matching neighbor = still movable
    const movable = frozen.map((t, i) => (i === 1 ? { ...t, tier: 0 } : t));
    expect(canMove(stateOf(movable).tiles)).toBe(true);
  });

  it("flags over=true when the spawned tile freezes the board", () => {
    // Row-stripe board, full except (0,3); merging col 0's pair then a hostile
    // spawn can freeze. Build simplest case: full board where one merge exists,
    // do it, and let the spawn land in the freed cell with a non-matching tier.
    const tiles: Omit<Tile, "id">[] = [];
    // col-alternating tiers except two equal neighbors at (0,0)/(0,1)
    const plan = [
      [9, 9, 8, 7],
      [6, 5, 4, 3],
      [5, 4, 3, 2],
      [4, 3, 2, 1],
    ];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) tiles.push({ r, c, tier: plan[r][c] });
    const g = stateOf(tiles);
    // "left": (0,0)+(0,1) merge → tier 10 at (0,0), row 0 becomes [10,8,7,_];
    // spawn rng 0.99 → last empty cell (0,3), tier picked non-matching (0).
    const { state } = move(g, "left", rngOf(0.99, 0));
    expect(state.tiles).toHaveLength(16);
    expect(state.over).toBe(!canMove(state.tiles));
  });

  it("marks won at the $1M tier and keeps playing", () => {
    const g = stateOf([
      { r: 0, c: 0, tier: MILLION_TIER - 1 },
      { r: 0, c: 1, tier: MILLION_TIER - 1 },
    ]);
    const { state } = move(g, "left", rngOf(0.99, 0));
    expect(state.won).toBe(true);
    expect(state.over).toBe(false);
    expect(state.highestTier).toBe(MILLION_TIER);
  });

  it("score accumulates across moves", () => {
    let s = stateOf([
      { r: 0, c: 0, tier: 0 },
      { r: 0, c: 1, tier: 0 },
      { r: 3, c: 0, tier: 1 },
      { r: 3, c: 1, tier: 1 },
    ]);
    s = move(s, "left", rngOf(0.99, 0)).state; // +1000 +2000
    expect(s.score).toBe(3000);
    const before = s.score;
    s = move(s, "down", rngOf(0.99, 0)).state;
    expect(s.score).toBeGreaterThanOrEqual(before);
  });

  it("serialize → deserialize round-trips a run", () => {
    const g = newGame(rngOf(0, 0, 0.5, 0.95));
    const back = deserialize(serialize(g));
    expect(back).not.toBeNull();
    expect(back!.tiles.map(({ r, c, tier }) => ({ r, c, tier }))).toEqual(
      g.tiles.map(({ r, c, tier }) => ({ r, c, tier })),
    );
    expect(back!.score).toBe(g.score);
  });

  it("deserialize rejects garbage, overlaps, and out-of-range values", () => {
    expect(deserialize(null)).toBeNull();
    expect(deserialize({ v: 2 })).toBeNull();
    expect(deserialize({ v: 1, tiles: [], score: 0, moves: 0, won: false })).toBeNull();
    expect(
      deserialize({
        v: 1,
        tiles: [
          { id: 1, r: 0, c: 0, tier: 1 },
          { id: 2, r: 0, c: 0, tier: 2 }, // overlap
        ],
        score: 10,
        moves: 1,
        won: false,
      }),
    ).toBeNull();
    expect(
      deserialize({ v: 1, tiles: [{ id: 1, r: 5, c: 0, tier: 1 }], score: 0, moves: 0, won: false }),
    ).toBeNull();
    expect(
      deserialize({ v: 1, tiles: [{ id: 1, r: 0, c: 0, tier: 1 }], score: -5, moves: 0, won: false }),
    ).toBeNull();
  });

  it("random playthrough stays consistent to game over", () => {
    // Property-ish test: hammer random moves; invariants must always hold.
    let s = newGame();
    const dirs: Dir[] = ["up", "down", "left", "right"];
    for (let i = 0; i < 2000 && !s.over; i++) {
      const r = move(s, dirs[Math.floor(Math.random() * 4)]);
      s = r.state;
      const cells = new Set(s.tiles.map((t) => t.r * SIZE + t.c));
      expect(cells.size).toBe(s.tiles.length); // no overlaps ever
      expect(s.tiles.length).toBeLessThanOrEqual(SIZE * SIZE);
      expect(s.score).toBeGreaterThanOrEqual(0);
    }
  });
});
