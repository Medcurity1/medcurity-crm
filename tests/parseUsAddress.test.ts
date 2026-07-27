import { describe, it, expect } from "vitest";
import { parseUsAddress } from "@/lib/parseUsAddress";

// Summer's request (2026-07-27): paste a full address into Street once and the
// form fills city/state/zip. The parser must be CONFIDENT or return null —
// mangling a normal street paste would be worse than the feature.

describe("parseUsAddress", () => {
  it("parses the classic one-liner", () => {
    expect(parseUsAddress("123 Main St, Spokane, WA 99201")).toEqual({
      street: "123 Main St",
      city: "Spokane",
      state: "WA",
      zip: "99201",
    });
  });

  it("keeps suite/unit segments with the street", () => {
    expect(parseUsAddress("123 Main St, Suite 4, Spokane, WA 99201-1234")).toEqual({
      street: "123 Main St, Suite 4",
      city: "Spokane",
      state: "WA",
      zip: "99201-1234",
    });
  });

  it("parses multiline pastes (street on its own line)", () => {
    expect(parseUsAddress("123 Main St\nSpokane, WA 99201")).toEqual({
      street: "123 Main St",
      city: "Spokane",
      state: "WA",
      zip: "99201",
    });
  });

  it("normalizes a full state name to its 2-letter code", () => {
    expect(parseUsAddress("710 S 13th St, Norfolk, Nebraska 68701")).toEqual({
      street: "710 S 13th St",
      city: "Norfolk",
      state: "NE",
      zip: "68701",
    });
  });

  it("handles city and state in one segment (no comma between them)", () => {
    expect(parseUsAddress("123 Main St, Spokane WA 99201")).toEqual({
      street: "123 Main St",
      city: "Spokane",
      state: "WA",
      zip: "99201",
    });
  });

  it("strips a trailing country and reports it as United States", () => {
    expect(parseUsAddress("123 Main St, Spokane, WA 99201, USA")).toEqual({
      street: "123 Main St",
      city: "Spokane",
      state: "WA",
      zip: "99201",
      country: "United States",
    });
    expect(
      parseUsAddress("123 Main St, Spokane, WA 99201, United States"),
    ).toMatchObject({ country: "United States" });
  });

  it("handles multi-word cities", () => {
    expect(parseUsAddress("500 W Elm Ave, Coeur d'Alene, ID 83814")).toEqual({
      street: "500 W Elm Ave",
      city: "Coeur d'Alene",
      state: "ID",
      zip: "83814",
    });
  });

  // ---- The null cases: normal pastes must pass through untouched ----

  it("returns null for a bare street", () => {
    expect(parseUsAddress("123 Main St")).toBeNull();
    expect(parseUsAddress("123 Main St, Suite 4")).toBeNull();
  });

  it("returns null without a zip", () => {
    expect(parseUsAddress("123 Main St, Spokane, WA")).toBeNull();
  });

  it("returns null when the state is unrecognizable", () => {
    expect(parseUsAddress("123 Main St, Spokane, ZZ 99201")).toBeNull();
  });

  it("returns null for empty/short input", () => {
    expect(parseUsAddress("")).toBeNull();
    expect(parseUsAddress("99201")).toBeNull();
  });

  it("returns null rather than filling nonsense when segmentation is odd", () => {
    // city would carry digits — bail
    expect(parseUsAddress("123, 456 7th St, WA 99201")).toBeNull();
  });
});
