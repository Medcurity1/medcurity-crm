import { describe, it, expect } from "vitest";
import {
  evaluateGuess,
  basePoints,
  speedBonus,
  streakBonus,
  totalPoints,
  isWeekday,
  prevWeekday,
  weekMonday,
  weekDates,
  addDays,
  keyStates,
} from "../supabase/functions/daily-deal/logic";

// ---------------------------------------------------------------------------
// The Daily Deal engine (2026-07-31). Pure logic imported straight from the
// Deno-side module (no Deno imports there — the webhook-normalize pattern).
// The evaluator's duplicate-letter rules are the classic ones and the easiest
// thing to get subtly wrong, so they get the deepest coverage.
// ---------------------------------------------------------------------------

describe("evaluateGuess — marks", () => {
  it("all green on exact match", () => {
    expect(evaluateGuess("crane", "crane")).toBe("ggggg");
  });

  it("all grey when nothing matches", () => {
    expect(evaluateGuess("crane", "spilt")).toBe("xxxxx");
  });

  it("yellow for right letter wrong spot", () => {
    // answer QUOTA, guess TOAST: t→y, o→y, a→y, s→x, second t exhausted →x
    expect(evaluateGuess("quota", "toast")).toBe("yyyxx");
  });

  it("duplicate guess letters don't over-credit (SPEED vs ERASE)", () => {
    // answer speed: e r a s e → e(y, 2 e's available), r(x), a(x), s(y), e(y, 1 left)
    expect(evaluateGuess("speed", "erase")).toBe("yxxyy");
  });

  it("green consumes the letter budget before yellows (ABIDE vs SPEED)", () => {
    // answer abide has ONE e; guess speed: s x, p x, e y (consumes it), e x, d y
    expect(evaluateGuess("abide", "speed")).toBe("xxyxy");
  });

  it("double letter in answer, single in guess", () => {
    // answer GEESE, guess SENSE — greens first: e(1), s(3), e(4) all align.
    // Remaining answer letters {g, e}: s(0) has no s left → x, n(2) → x.
    expect(evaluateGuess("geese", "sense")).toBe("xgxgg");
  });

  it("green in the right spot plus the same letter grey elsewhere when budget is spent", () => {
    // answer CRANE, guess EERIE: e(0): answer has one e (pos4). greens: pos4 e = g.
    // e(0) budget gone → x, e(1) x, r(2): answer r at 1 → y, i x.
    expect(evaluateGuess("crane", "eerie")).toBe("xxyxg");
  });
});

describe("scoring", () => {
  it("base points ladder rewards fewer guesses", () => {
    expect(basePoints(1, true)).toBe(60);
    expect(basePoints(3, true)).toBe(40);
    expect(basePoints(6, true)).toBe(10);
  });

  it("a loss pays 5 participation points", () => {
    expect(basePoints(6, false)).toBe(5);
  });

  it("speed bonus decays 1 point per 20s and floors at 0", () => {
    expect(speedBonus(0)).toBe(15);
    expect(speedBonus(19_999)).toBe(15);
    expect(speedBonus(60_000)).toBe(12);
    expect(speedBonus(5 * 60_000)).toBe(0);
    expect(speedBonus(60 * 60_000)).toBe(0);
  });

  it("streak bonus caps at 10", () => {
    expect(streakBonus(1)).toBe(1);
    expect(streakBonus(10)).toBe(10);
    expect(streakBonus(45)).toBe(10);
  });

  it("total: win in 2 at 30s on a 5-day streak", () => {
    expect(totalPoints({ guessesUsed: 2, won: true, msElapsed: 30_000, streakAfter: 5 }))
      .toBe(50 + 14 + 5);
  });

  it("total: loss gets no speed bonus but keeps streak credit", () => {
    expect(totalPoints({ guessesUsed: 6, won: false, msElapsed: 10_000, streakAfter: 3 }))
      .toBe(5 + 3);
  });
});

describe("weekday math", () => {
  it("classifies weekdays and weekends", () => {
    expect(isWeekday("2026-07-31")).toBe(true); // Friday
    expect(isWeekday("2026-08-01")).toBe(false); // Saturday
    expect(isWeekday("2026-08-02")).toBe(false); // Sunday
    expect(isWeekday("2026-08-03")).toBe(true); // Monday
  });

  it("prevWeekday hops the weekend (Mon → prior Fri)", () => {
    expect(prevWeekday("2026-08-03")).toBe("2026-07-31");
    expect(prevWeekday("2026-07-31")).toBe("2026-07-30");
  });

  it("prevWeekday crosses month boundaries", () => {
    expect(prevWeekday("2026-09-01")).toBe("2026-08-31"); // Tue → Mon
    expect(prevWeekday("2026-06-01")).toBe("2026-05-29"); // Mon → prior Fri, May
  });

  it("weekMonday: Sunday belongs to the week that just ended", () => {
    expect(weekMonday("2026-08-02")).toBe("2026-07-27"); // Sun → prior Mon
    expect(weekMonday("2026-08-01")).toBe("2026-07-27"); // Sat → prior Mon
    expect(weekMonday("2026-07-27")).toBe("2026-07-27"); // Mon → itself
  });

  it("weekDates returns Mon..Fri", () => {
    expect(weekDates("2026-07-31")).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
  });

  it("addDays crosses years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("keyStates — keyboard coloring", () => {
  it("green beats yellow beats grey per letter across guesses", () => {
    const states = keyStates([
      { word: "toast", marks: "yyyxx" },
      { word: "quota", marks: "ggggg" },
    ]);
    expect(states["t"]).toBe("g"); // yellow in guess 1, green in guess 2
    expect(states["s"]).toBe("x");
    expect(states["q"]).toBe("g");
  });

  it("never downgrades a letter", () => {
    const states = keyStates([
      { word: "quota", marks: "ggggg" },
      { word: "toast", marks: "yyyxx" },
    ]);
    expect(states["t"]).toBe("g");
  });
});
