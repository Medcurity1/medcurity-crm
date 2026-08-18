/**
 * Decision rules behind the bulk owner-change Undo on the accounts /
 * contacts / opportunities lists (src/features/archive/bulk-undo.ts).
 *
 * The subtle one is completeness: list selection survives paging, so a
 * selection can include ids whose rows the page no longer holds. Undo
 * must be withheld entirely in that case rather than reverting the
 * subset it happens to still see.
 */
import { describe, it, expect } from "vitest";
import { capturePriorOwners, groupByPriorOwner } from "../src/features/archive/bulk-undo";

describe("capturePriorOwners", () => {
  const rows = [
    { id: "a", owner_user_id: "u1" },
    { id: "b", owner_user_id: "u2" },
    { id: "c", owner_user_id: null },
  ];

  it("captures the pre-change owner of every selected row", () => {
    expect(capturePriorOwners(["a", "b"], rows)).toEqual([
      { id: "a", owner_user_id: "u1" },
      { id: "b", owner_user_id: "u2" },
    ]);
  });

  it("treats an unassigned row as a null owner, not a missing one", () => {
    expect(capturePriorOwners(["c"], rows)).toEqual([{ id: "c", owner_user_id: null }]);
  });

  it("normalizes an absent owner_user_id key to null", () => {
    expect(capturePriorOwners(["d"], [{ id: "d" }])).toEqual([
      { id: "d", owner_user_id: null },
    ]);
  });

  it("returns null when any selected id is off the current page", () => {
    expect(capturePriorOwners(["a", "zzz"], rows)).toBeNull();
  });

  it("returns null when there are no rows at all", () => {
    expect(capturePriorOwners(["a"], undefined)).toBeNull();
  });
});

describe("groupByPriorOwner", () => {
  it("collapses rows into one write per distinct prior owner", () => {
    const grouped = groupByPriorOwner([
      { id: "a", owner_user_id: "u1" },
      { id: "b", owner_user_id: "u2" },
      { id: "c", owner_user_id: "u1" },
    ]);
    expect(grouped.size).toBe(2);
    expect(grouped.get("u1")).toEqual(["a", "c"]);
    expect(grouped.get("u2")).toEqual(["b"]);
  });

  it("keeps unassigned rows together under a single null key", () => {
    const grouped = groupByPriorOwner([
      { id: "a", owner_user_id: null },
      { id: "b", owner_user_id: null },
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get(null)).toEqual(["a", "b"]);
  });
});
