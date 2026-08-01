import { describe, it, expect } from "vitest";
import { headlineFor, issueNumber } from "../src/features/daily-deal/headlines";

describe("headlineFor — the front page chases the word", () => {
  it("fresh board", () => {
    expect(headlineFor([], false, false)).toBe("MYSTERY WORD STILL AT LARGE");
  });

  it("nothing landed", () => {
    expect(headlineFor([{ marks: "xxxxx" }], false, false)).toBe("NO LEADS YET");
  });

  it("no em dashes anywhere (house rule)", () => {
    const states: Array<[Parameters<typeof headlineFor>[0], boolean, boolean]> = [
      [[], false, false],
      [[{ marks: "xxxxx" }], false, false],
      [[{ marks: "xyxyx" }], false, false],
      [[{ marks: "gxxxx" }], false, false],
      [[{ marks: "gxgxy" }], false, false],
      [[{ marks: "ggggx" }], false, false],
      [[{ marks: "ggggg" }], true, true],
      [[{ marks: "xxxxx" }, { marks: "ggggg" }], true, true],
      [new Array(6).fill({ marks: "xxxxx" }), true, false],
    ];
    for (const [g, c, w] of states) {
      expect(headlineFor(g, c, w)).not.toContain("—");
    }
  });

  it("yellows only", () => {
    expect(headlineFor([{ marks: "xyxyx" }], false, false)).toBe("WARM TRAIL, WRONG ADDRESSES");
  });

  it("single green", () => {
    expect(headlineFor([{ marks: "gxxxx" }], false, false)).toBe("FIRST LETTER PINNED DOWN");
  });

  it("multiple greens report the count", () => {
    expect(headlineFor([{ marks: "gxgxy" }], false, false)).toBe("2 LETTERS LOCKED IN");
  });

  it("four greens", () => {
    expect(headlineFor([{ marks: "ggggx" }], false, false)).toBe("ONE LETTER SHORT OF A DEAL");
  });

  it("only the LATEST guess drives the story", () => {
    expect(headlineFor([{ marks: "ggggx" }, { marks: "xxxxx" }], false, false))
      .toBe("NO LEADS YET");
  });

  it("win and loss editions", () => {
    expect(headlineFor([{ marks: "ggggg" }], true, true)).toBe("SOLVED ON THE FIRST CALL");
    expect(headlineFor([{ marks: "xxxxx" }, { marks: "ggggg" }], true, true))
      .toBe("DEAL CLOSED IN 2");
    expect(headlineFor(new Array(6).fill({ marks: "xxxxx" }), true, false))
      .toBe("THE WORD GOT AWAY");
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
