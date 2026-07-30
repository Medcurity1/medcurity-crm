// Featured (pinned) Nexus widgets — the client-side two-pin rule.
//
// The cap is not a database constraint, so these three functions ARE the
// rule: which widgets render above the divider, which stay in the grid,
// and which pin steps down when a third one arrives.

import { describe, it, expect } from "vitest";
import {
  MAX_FEATURED,
  pickOldestFeatured,
  selectFeatured,
  selectUnfeatured,
} from "../src/features/nexus/featured";
import type { NexusWidget } from "../src/features/nexus/types";

function widget(
  id: string,
  position: number,
  featured: boolean,
): NexusWidget {
  return {
    id,
    user_id: "u1",
    position,
    name: id,
    color: null,
    icon: null,
    preview_count: 5,
    featured,
    created_at: "2026-07-29T00:00:00Z",
    updated_at: "2026-07-29T00:00:00Z",
    widget_type: "tasks",
    config: {},
  } as NexusWidget;
}

describe("selectFeatured / selectUnfeatured", () => {
  const list = [
    widget("a", 0, false),
    widget("b", 1, true),
    widget("c", 2, false),
    widget("d", 3, true),
  ];

  it("returns pinned widgets in position order", () => {
    expect(selectFeatured(list).map((w) => w.id)).toEqual(["b", "d"]);
  });

  it("leaves the pinned ones out of the grid list", () => {
    expect(selectUnfeatured(list).map((w) => w.id)).toEqual(["a", "c"]);
  });

  it("handles an undefined list", () => {
    expect(selectFeatured(undefined)).toEqual([]);
    expect(selectUnfeatured(undefined)).toEqual([]);
  });

  it("never shows more than the cap, and keeps the overflow in the grid", () => {
    const three = [
      widget("x", 0, true),
      widget("y", 1, true),
      widget("z", 2, true),
    ];
    expect(selectFeatured(three)).toHaveLength(MAX_FEATURED);
    expect(selectUnfeatured(three).map((w) => w.id)).toEqual(["z"]);
  });
});

describe("pickOldestFeatured", () => {
  const pinned = [widget("b", 5, true), widget("d", 2, true)];

  it("picks the one pinned longest ago per the pin log", () => {
    // Log says d was pinned first, even though b sits later by position.
    expect(pickOldestFeatured(pinned, ["d", "b"])?.id).toBe("d");
    expect(pickOldestFeatured(pinned, ["b", "d"])?.id).toBe("b");
  });

  it("ignores log entries that are no longer pinned", () => {
    expect(pickOldestFeatured(pinned, ["gone", "b"])?.id).toBe("b");
  });

  it("falls back to the lowest position when the log knows nothing", () => {
    expect(pickOldestFeatured(pinned, [])?.id).toBe("d");
  });

  it("returns null when nothing is pinned", () => {
    expect(pickOldestFeatured([], ["a"])).toBeNull();
  });
});
