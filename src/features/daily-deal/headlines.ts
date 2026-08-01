// Newspaper dressing for The Daily Deal — the reactive front-page headline
// (updates after every guess like an evening edition chasing a story) and
// the masthead issue number. Pure + tested (tests/dailyDealHeadlines.test.ts).

export interface MarkedGuess {
  marks: string; // 5 chars of g/y/x
}

/** Weekday-only issue counter, Vol. I starting the launch week's Monday
 *  (2026-07-27). Weekends don't print, so they don't count. */
export function issueNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const start = Date.UTC(2026, 6, 27); // Mon 2026-07-27
  if (target < start) return 1;
  let n = 0;
  for (let t = start; t <= target; t += 86_400_000) {
    const dow = new Date(t).getUTCDay();
    if (dow >= 1 && dow <= 5) n++;
  }
  return Math.max(n, 1);
}

/** The front-page headline chasing today's word. Driven by the LATEST guess
 *  (that's the freshest reporting), deterministic so tests can pin it. */
export function headlineFor(
  guesses: MarkedGuess[],
  completed: boolean,
  won: boolean,
): string {
  // House rule: no em dashes anywhere in the minigame (Nathan, 2026-07-31).
  if (completed) {
    if (!won) return "THE WORD GOT AWAY";
    if (guesses.length === 1) return "SOLVED ON THE FIRST CALL";
    return `DEAL CLOSED IN ${guesses.length}`;
  }
  if (guesses.length === 0) return "MYSTERY WORD STILL AT LARGE";

  const marks = guesses[guesses.length - 1].marks;
  const g = [...marks].filter((m) => m === "g").length;
  const y = [...marks].filter((m) => m === "y").length;

  if (g === 4) return "ONE LETTER SHORT OF A DEAL";
  if (g >= 2) return `${g} LETTERS LOCKED IN`;
  if (g === 1) return "FIRST LETTER PINNED DOWN";
  if (y > 0) return "WARM TRAIL, WRONG ADDRESSES";
  return "NO LEADS YET";
}
