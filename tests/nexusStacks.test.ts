// Two-stack Nexus layout (docket C2 round 4): the interleave that kills the
// dead-space-under-short-widgets problem. Pure function, so the invariants
// the drag mapping relies on (slot i = row floor(i/2) of stack i % 2, and
// concatenating the stacks by row recovers position order) get pinned here.

import { describe, it, expect } from "vitest";
import { splitIntoStacks } from "../src/features/nexus/NexusGrid";

describe("splitIntoStacks", () => {
  it("alternates even indexes left, odd right", () => {
    const [left, right] = splitIntoStacks(["a", "b", "c", "d", "e"]);
    expect(left).toEqual(["a", "c", "e"]);
    expect(right).toEqual(["b", "d"]);
  });

  it("handles empty and single-item lists", () => {
    expect(splitIntoStacks([])).toEqual([[], []]);
    expect(splitIntoStacks(["only"])).toEqual([["only"], []]);
  });

  it("row-major interleave of the stacks recovers the original order", () => {
    const items = Array.from({ length: 7 }, (_, i) => i);
    const [left, right] = splitIntoStacks(items);
    const recovered: number[] = [];
    for (let row = 0; row < left.length; row++) {
      recovered.push(left[row]);
      if (right[row] !== undefined) recovered.push(right[row]);
    }
    expect(recovered).toEqual(items);
  });
});
