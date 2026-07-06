// Pure MeddySweeper (minesweeper) engine — no React, no side effects.
// Every action returns a NEW GameState (cells cloned) so React re-renders
// cleanly. Boards are tiny (≤ 16×30 = 480 cells) so cloning is free.

export type Difficulty = "rookie" | "analyst" | "guardian";
export type Status = "ready" | "playing" | "won" | "lost";

export interface Cell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  adjacent: number; // number of adjacent mines (valid once mines placed)
}

export interface GameState {
  rows: number;
  cols: number;
  mines: number;
  cells: Cell[]; // flat, length rows*cols, index = r*cols + c
  status: Status;
  flags: number; // flags currently placed
  safeRevealed: number; // non-mine cells revealed
  minesPlaced: boolean;
  explodedIndex: number | null; // the mine the player detonated (for highlight)
}

export interface DifficultyConfig {
  rows: number;
  cols: number;
  mines: number;
  clearPoints: number; // points for clearing the board (a win)
  par: number; // seconds; finishing under par earns the speed bonus
  speed: number; // bonus points per second under par
  label: string;
}

// Scoring is intentionally simple and explainable: you only score by CLEARING
// a board (a win). A win pays a flat `clearPoints` for that difficulty plus a
// `speed` bonus for every second you finish under `par`. Harder board =
// bigger clear points + bigger speed bonus, so a Guardian win always outscores
// an Analyst win outscores a Rookie win. Losing scores nothing — try again.
export const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  rookie: { rows: 9, cols: 9, mines: 10, clearPoints: 1000, par: 120, speed: 15, label: "Rookie" },
  analyst: { rows: 16, cols: 16, mines: 40, clearPoints: 5000, par: 360, speed: 25, label: "Analyst" },
  guardian: { rows: 16, cols: 30, mines: 99, clearPoints: 15000, par: 900, speed: 50, label: "Guardian" },
};

const idx = (r: number, c: number, cols: number) => r * cols + c;

function neighborIndices(i: number, rows: number, cols: number): number[] {
  const r = Math.floor(i / cols);
  const c = i % cols;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(idx(nr, nc, cols));
    }
  }
  return out;
}

function cloneCells(cells: Cell[]): Cell[] {
  return cells.map((c) => ({ ...c }));
}

export function newGame(d: Difficulty): GameState {
  const { rows, cols, mines } = DIFFICULTIES[d];
  const cells: Cell[] = Array.from({ length: rows * cols }, () => ({
    mine: false,
    revealed: false,
    flagged: false,
    adjacent: 0,
  }));
  return {
    rows,
    cols,
    mines,
    cells,
    status: "ready",
    flags: 0,
    safeRevealed: 0,
    minesPlaced: false,
    explodedIndex: null,
  };
}

// Place mines avoiding the first-clicked cell AND its neighbors, so the
// first reveal always opens a zero-region. Then compute adjacency counts.
function placeMines(state: GameState, safeIdx: number): void {
  const { rows, cols, mines } = state;
  const safe = new Set<number>([safeIdx, ...neighborIndices(safeIdx, rows, cols)]);
  const candidates: number[] = [];
  for (let i = 0; i < rows * cols; i++) if (!safe.has(i)) candidates.push(i);
  // Fisher–Yates shuffle, take the first `mines`. (If the board is so dense
  // that mines > candidates — never true for our presets — clamp.)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const count = Math.min(mines, candidates.length);
  for (let k = 0; k < count; k++) state.cells[candidates[k]].mine = true;
  for (let i = 0; i < rows * cols; i++) {
    if (state.cells[i].mine) continue;
    let n = 0;
    for (const j of neighborIndices(i, rows, cols)) if (state.cells[j].mine) n++;
    state.cells[i].adjacent = n;
  }
  state.minesPlaced = true;
}

function finalizeWinIfDone(state: GameState): void {
  if (state.status !== "playing") return;
  if (state.safeRevealed === state.rows * state.cols - state.mines) {
    state.status = "won";
    // Auto-shield every remaining threat for the victory screen.
    let flags = 0;
    for (const cell of state.cells) {
      if (cell.mine) cell.flagged = true;
      if (cell.flagged) flags++;
    }
    state.flags = flags;
  }
}

// Flood-reveal from `start`. Returns true if a mine was detonated.
function floodReveal(state: GameState, start: number): boolean {
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const cell = state.cells[i];
    if (cell.revealed || cell.flagged) continue;
    cell.revealed = true;
    if (cell.mine) {
      state.status = "lost";
      state.explodedIndex = i;
      for (const c of state.cells) if (c.mine) c.revealed = true;
      return true;
    }
    state.safeRevealed++;
    if (cell.adjacent === 0) {
      for (const j of neighborIndices(i, state.rows, state.cols)) {
        if (!state.cells[j].revealed && !state.cells[j].flagged) stack.push(j);
      }
    }
  }
  return false;
}

export function reveal(prev: GameState, i: number): GameState {
  if (prev.status === "won" || prev.status === "lost") return prev;
  const cell = prev.cells[i];
  if (cell.revealed || cell.flagged) return prev;
  const state: GameState = { ...prev, cells: cloneCells(prev.cells) };
  if (!state.minesPlaced) {
    placeMines(state, i);
    state.status = "playing";
  }
  floodReveal(state, i);
  finalizeWinIfDone(state);
  return state;
}

export function toggleFlag(prev: GameState, i: number): GameState {
  if (prev.status === "won" || prev.status === "lost") return prev;
  const cell = prev.cells[i];
  if (cell.revealed) return prev;
  const state: GameState = { ...prev, cells: cloneCells(prev.cells) };
  const target = state.cells[i];
  target.flagged = !target.flagged;
  state.flags += target.flagged ? 1 : -1;
  return state;
}

// Chord: clicking an already-revealed number whose adjacent flags equal its
// number reveals all its non-flagged neighbors (may detonate if misflagged).
export function chord(prev: GameState, i: number): GameState {
  if (prev.status !== "playing" && prev.status !== "ready") return prev;
  const cell = prev.cells[i];
  if (!cell.revealed || cell.adjacent === 0) return prev;
  const neigh = neighborIndices(i, prev.rows, prev.cols);
  let flagged = 0;
  for (const j of neigh) if (prev.cells[j].flagged) flagged++;
  if (flagged !== cell.adjacent) return prev;
  const state: GameState = { ...prev, cells: cloneCells(prev.cells) };
  for (const j of neigh) {
    if (!state.cells[j].flagged && !state.cells[j].revealed) {
      const hit = floodReveal(state, j);
      if (hit) break;
    }
  }
  finalizeWinIfDone(state);
  return state;
}

// Score for a WON board, broken into its two legible parts. Losses don't score.
export function scoreBreakdown(d: Difficulty, seconds: number): { base: number; speed: number; total: number } {
  const cfg = DIFFICULTIES[d];
  const base = cfg.clearPoints;
  const speed = Math.max(0, cfg.par - seconds) * cfg.speed;
  const total = Math.max(0, Math.min(100_000_000, Math.round(base + speed)));
  return { base, speed: Math.round(speed), total };
}
