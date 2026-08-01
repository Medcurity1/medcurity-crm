// Pure logic for The Daily Deal — no Deno imports so vitest can import this
// directly (tests/dailyDealLogic.test.ts), same extraction pattern as
// campaign-webhook-normalize.

export const MAX_GUESSES = 6;
export const WORD_LEN = 5;

/** Marks per letter: g = right spot, y = in word wrong spot, x = not in word.
 *  Two-pass so duplicate letters behave like the classic rules: greens claim
 *  their letters first, then yellows consume what's left, left to right. */
export function evaluateGuess(answer: string, guess: string): string {
  const a = answer.split("");
  const g = guess.split("");
  const marks: string[] = new Array(WORD_LEN).fill("x");
  const remaining: Record<string, number> = {};
  for (let i = 0; i < WORD_LEN; i++) {
    if (g[i] === a[i]) marks[i] = "g";
    else remaining[a[i]] = (remaining[a[i]] ?? 0) + 1;
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (marks[i] === "g") continue;
    if ((remaining[g[i]] ?? 0) > 0) {
      marks[i] = "y";
      remaining[g[i]]--;
    }
  }
  return marks.join("");
}

/** Base points by guesses used; a loss still pays a little for showing up
 *  (the streak is play-based, and 5 points keeps the leaderboard honest about
 *  who played vs who skipped). */
export function basePoints(guessesUsed: number, won: boolean): number {
  if (!won) return 5;
  return [0, 60, 50, 40, 30, 20, 10][guessesUsed] ?? 10;
}

/** Speed bonus: 15 max, minus 1 per 20s of board-open time, floor 0. Rewards
 *  brisk solving without turning a coffee-break puzzle into a stopwatch —
 *  after 5 minutes it's simply 0, never negative. */
export function speedBonus(msElapsed: number): number {
  return Math.max(0, 15 - Math.floor(msElapsed / 20_000));
}

/** +1 per consecutive weekday played, capped at 10. */
export function streakBonus(streakAfter: number): number {
  return Math.min(Math.max(streakAfter, 0), 10);
}

export function totalPoints(opts: {
  guessesUsed: number;
  won: boolean;
  msElapsed: number;
  streakAfter: number;
}): number {
  const base = basePoints(opts.guessesUsed, opts.won);
  const speed = opts.won ? speedBonus(opts.msElapsed) : 0;
  return base + speed + streakBonus(opts.streakAfter);
}

// ---- weekday date math (all on ISO "YYYY-MM-DD" strings, UTC-anchored) ----

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUTC(d);
}

/** Mon-Fri true. */
export function isWeekday(iso: string): boolean {
  const dow = toUTC(iso).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** The previous weekday (Mon → prior Fri). Streaks chain across weekends. */
export function prevWeekday(iso: string): string {
  let d = addDays(iso, -1);
  while (!isWeekday(d)) d = addDays(d, -1);
  return d;
}

/** Monday of the calendar week containing `iso` (Sun belongs to the week
 *  that STARTED the prior Monday — so a Sunday recap shows the week that
 *  just finished). */
export function weekMonday(iso: string): string {
  const dow = toUTC(iso).getUTCDay(); // Sun=0
  return addDays(iso, -((dow + 6) % 7));
}

/** The five weekday dates (Mon..Fri) of the week containing `iso`. */
export function weekDates(iso: string): string[] {
  const mon = weekMonday(iso);
  return [0, 1, 2, 3, 4].map((n) => addDays(mon, n));
}

/** Today's date in Pacific time (business timezone — the puzzle flips at
 *  midnight PT, matching how the team experiences "today"). */
export function ptTodayISO(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Aggregate keyboard letter states from all marked guesses: g beats y beats x. */
export function keyStates(guesses: Array<{ word: string; marks: string }>): Record<string, string> {
  const rank: Record<string, number> = { x: 1, y: 2, g: 3 };
  const out: Record<string, string> = {};
  for (const g of guesses) {
    for (let i = 0; i < g.word.length; i++) {
      const ch = g.word[i];
      const m = g.marks[i];
      if (!out[ch] || rank[m] > rank[out[ch]]) out[ch] = m;
    }
  }
  return out;
}
