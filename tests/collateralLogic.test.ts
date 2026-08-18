import { describe, expect, it } from "vitest";
import {
  buildChipGroups,
  expandProductSelection,
  filterItems,
  initialSegmentSelection,
  type CollateralItemLike,
} from "@/features/collateral/collateral-logic";

const item = (over: Partial<CollateralItemLike>): CollateralItemLike => ({
  id: Math.random().toString(36).slice(2),
  title: "Untitled",
  asset_type: null,
  products: [],
  segments: [],
  uses: [],
  pinned: false,
  ...over,
});

const LIBRARY: CollateralItemLike[] = [
  item({
    id: "a",
    title: "SRA One-Pager",
    asset_type: "One-Pager",
    products: ["SRA — Full Service", "Platform / General"],
    segments: ["CHC / FQHC", "All"],
    uses: ["Send to Prospect"],
  }),
  item({
    id: "b",
    title: "Self-Serve SRA Deck",
    asset_type: "Deck",
    products: ["SRA — Self-Serve"],
    segments: ["Rural Hospital"],
    uses: ["Send to Prospect"],
  }),
  item({
    id: "c",
    title: "VRM Sales Battlecards",
    asset_type: "Battlecard",
    products: ["Vendor Risk Management"],
    segments: ["All"],
    uses: ["Internal Enablement"],
  }),
  item({
    id: "d",
    title: "BA SRA Checklist",
    asset_type: "One-Pager",
    products: ["SRA — Business Associate"],
    segments: ["PCA"],
    uses: ["Send to Prospect", "Internal Enablement"],
  }),
];

describe("buildChipGroups", () => {
  it("collapses shared-prefix products into one family chip (item 4)", () => {
    const chips = buildChipGroups(LIBRARY);
    const sra = chips.products.find((c) => c.value === "family:SRA");
    expect(sra).toBeDefined();
    expect(sra!.children!.map((c) => c.label).sort()).toEqual([
      "Business Associate",
      "Full Service",
      "Self-Serve",
    ]);
    // Non-family products stay flat, and family members don't double-list.
    expect(chips.products.some((c) => c.value === "Vendor Risk Management")).toBe(true);
    expect(chips.products.some((c) => c.value === "SRA — Full Service")).toBe(false);
  });

  it("keeps a lone prefixed value flat rather than inventing a family", () => {
    const chips = buildChipGroups([
      item({ products: ["Meddy — Website"] }),
      item({ products: ["Training"] }),
    ]);
    expect(chips.products.some((c) => c.value === "Meddy — Website")).toBe(true);
    expect(chips.products.some((c) => c.value.startsWith("family:"))).toBe(false);
  });

  it("generates chips from data, deduped and sorted", () => {
    const chips = buildChipGroups(LIBRARY);
    expect(chips.uses.map((c) => c.value)).toEqual([
      "Internal Enablement",
      "Send to Prospect",
    ]);
    expect(chips.segments.map((c) => c.value)).toContain("All");
  });
});

describe("filterItems", () => {
  const chips = buildChipGroups(LIBRARY);
  const none = { search: "", products: [], assetTypes: [], segments: [], uses: [] };

  it("chips FILTER, not group: a multi-tagged asset appears under each chip (item 3)", () => {
    const underSraFull = filterItems(
      LIBRARY,
      { ...none, products: ["SRA — Full Service"] },
      chips.products,
    );
    const underPlatform = filterItems(
      LIBRARY,
      { ...none, products: ["Platform / General"] },
      chips.products,
    );
    expect(underSraFull.map((i) => i.id)).toContain("a");
    expect(underPlatform.map((i) => i.id)).toContain("a");
  });

  it("selecting the SRA family parent returns all three variants", () => {
    const out = filterItems(
      LIBRARY,
      { ...none, products: ["family:SRA"] },
      chips.products,
    );
    expect(out.map((i) => i.id).sort()).toEqual(["a", "b", "d"]);
  });

  it("ORs within a row, ANDs across rows", () => {
    const out = filterItems(
      LIBRARY,
      {
        ...none,
        assetTypes: ["One-Pager", "Deck"],
        uses: ["Send to Prospect"],
        segments: ["Rural Hospital"],
      },
      chips.products,
    );
    expect(out.map((i) => i.id)).toEqual(["b"]);
  });

  it("search matches title and every tag, and combines with chips (item 2)", () => {
    const byTag = filterItems(LIBRARY, { ...none, search: "battlecard" }, chips.products);
    expect(byTag.map((i) => i.id)).toEqual(["c"]);
    const combined = filterItems(
      LIBRARY,
      { ...none, search: "sra", uses: ["Internal Enablement"] },
      chips.products,
    );
    expect(combined.map((i) => i.id)).toEqual(["d"]);
  });

  it("an empty row applies no constraint", () => {
    expect(filterItems(LIBRARY, none, chips.products)).toHaveLength(4);
  });
});

describe("expandProductSelection", () => {
  it("expands the family token into member values", () => {
    const chips = buildChipGroups(LIBRARY);
    const out = expandProductSelection(["family:SRA", "Vendor Risk Management"], chips.products);
    expect(out.sort()).toEqual([
      "SRA — Business Associate",
      "SRA — Full Service",
      "SRA — Self-Serve",
      "Vendor Risk Management",
    ]);
  });
});

describe("initialSegmentSelection", () => {
  const chips = buildChipGroups(LIBRARY).segments;

  it("applies only segments that exist in the data (item 7)", () => {
    expect(initialSegmentSelection(["CHC / FQHC", "All", "Retired Segment"], chips)).toEqual([
      "CHC / FQHC",
      "All",
    ]);
  });

  it("no saved default means no constraint", () => {
    expect(initialSegmentSelection(undefined, chips)).toEqual([]);
    expect(initialSegmentSelection([], chips)).toEqual([]);
  });
});

// ── v1.1 (Jordan 2026-08-11): freshness badge, file glyphs, source guard ──

import { isReviewDue, fileKind } from "@/features/collateral/collateral-logic";
import { readFileSync } from "fs";
import path from "path";

describe("isReviewDue (the 180-day Review due badge)", () => {
  const now = new Date(2026, 7, 12);
  const daysAgo = (n: number) =>
    new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);

  it("is not due without a Last Reviewed value (Status is the authority)", () => {
    expect(isReviewDue(null, now)).toBe(false);
    expect(isReviewDue(undefined, now)).toBe(false);
    expect(isReviewDue("not a date", now)).toBe(false);
  });

  it("flips at more than 180 days", () => {
    expect(isReviewDue(daysAgo(30), now)).toBe(false);
    expect(isReviewDue(daysAgo(179), now)).toBe(false);
    expect(isReviewDue(daysAgo(181), now)).toBe(true);
    expect(isReviewDue(daysAgo(400), now)).toBe(true);
  });
});

describe("fileKind (card glyph from the extension)", () => {
  it("maps common extensions and falls back to a generic file", () => {
    expect(fileKind("https://x.sharepoint.com/sites/a/Doc.pdf")).toBe("pdf");
    expect(fileKind("Battlecard.PPTX")).toBe("slides");
    expect(fileKind("one-pager.docx")).toBe("doc");
    expect(fileKind("pricing.xlsx")).toBe("sheet");
    expect(fileKind("diagram.png?web=1")).toBe("image");
    expect(fileKind("weird.zip")).toBe("file");
    expect(fileKind(null)).toBe("file");
  });
});

describe("collateral-sync source guard (spec §1: single allowed source)", () => {
  const source = readFileSync(
    path.resolve(__dirname, "..", "supabase", "functions", "collateral-sync", "index.ts"),
    "utf8",
  );

  it("defaults to the Sales Collateral driveId and reads drive-scoped only", () => {
    // The one allowed drive, baked as the default.
    expect(source).toContain("b!fr6BIkRZf0iQUhexpYPhRdBJHa64QeNDn7NMQhwr-wLgoKJCme8PSqjSsQ-ZsLgO");
    expect(source).toContain("/drives/");
    // Never a site-scoped search (how Shared Documents leaked in before).
    expect(source).not.toMatch(/\/search\(/);
    // The known-bad Shared Documents drive must never be referenced.
    expect(source).not.toContain("wLih2oXpvABR6uZaI3rOm5e");
  });

  it("filters to Status = Current and maps the spec's internal field names", () => {
    expect(source).toContain('"Current"');
    for (const internal of [
      "Asset_x0020_Type",
      "Last_x0020_Reviewed",
      '"Product"',
      '"Segment"',
      '"Stage"',
      '"Use"',
      '"Status"',
      '"Owner"',
    ]) {
      expect(source).toContain(internal);
    }
  });

  it("deletes rows that leave the library (mirror, not archive)", () => {
    expect(source).toContain(".delete()");
  });

  it("allows only admins or a gateway-verified service-role scheduler", () => {
    expect(source).toContain('payload?.role === "service_role"');
    expect(source).toContain('admin.auth.getUser(jwt)');
    expect(source).toContain('["admin", "super_admin"]');
  });
});
