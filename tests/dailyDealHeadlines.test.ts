import { describe, it, expect } from "vitest";
import { headlineFor, issueNumber } from "../src/features/daily-deal/headlines";

describe("headlineFor — the front page chases the word", () => {
  it("fresh board", () => {
    expect(headlineFor([], false, false)).toBe("MYSTERY WORD STILL AT LARGE");
  });

  it("nothing landed", () => {
    expect(headlineFor([{ marks: "xxxxx" }], false, false)).toBe("NO LEADS — REPORTERS UNDETERRED");
  });

  it("yellows only", () => {
    expect(headlineFor([{ marks: "xyxyx" }], false, false)).toBe("WARM TRAIL, WRONG ADDRESSES");
  });

  it("single green", () => {
    expect(headlineFor([{ marks: "gxxxx" }], false, false)).toBe("FIRST LETTER PINNED DOWN");
  });

  it("multiple greens report the count", () => {
    expect(headlineFor([{ marks: "gxgxy" }], false, false)).toBe("2 LETTERS LOCKED IN, SOURCES CONFIRM");
  });

  it("four greens", () => {
    expect(headlineFor([{ marks: "ggggx" }], false, false)).toBe("ONE LETTER SHORT OF A DEAL");
  });

  it("only the LATEST guess drives the story", () => {
    expect(headlineFor([{ marks: "ggggx" }, { marks: "xxxxx" }], false, false))
      .toBe("NO LEADS — REPORTERS UNDETERRED");
  });

  it("win and loss editions", () => {
    expect(headlineFor([{ marks: "ggggg" }], true, true)).toBe("SOLVED ON THE FIRST CALL — PRESSES STOP");
    expect(headlineFor([{ marks: "xxxxx" }, { marks: "ggggg" }], true, true))
      .toBe("DEAL CLOSED IN 2 — PRESSES STOP");
    expect(headlineFor(new Array(6).fill({ marks: "xxxxx" }), true, false))
      .toBe("WORD SLIPS THE NET — INQUIRY CONTINUES");
  });
});

describe("issueNumber — weekday-only edition counter from 2026-07-27", () => {
  it("launch week counts Mon=1 … Fri=5", () => {
    expect(issueNumber("2026-07-27")).toBe(1);
    expect(issueNumber("2026-07-31")).toBe(5);
  });

  it("weekends don't print", () => {
    expect(issueNumber("2026-08-01")).toBe(5); // Saturday still shows Friday's issue
    expect(issueNumber("2026-08-03")).toBe(6); // Monday resumes
  });

  it("never below 1, even before launch", () => {
    expect(issueNumber("2026-01-01")).toBe(1);
  });
});
