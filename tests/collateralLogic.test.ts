import { describe, expect, it } from "vitest";
import {
  buildChipGroups,
  expandProductSelection,
  filterItems,
  initialSegmentSelection,
  toggleFamilyChild,
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

describe("toggleFamilyChild", () => {
  const children = ["SRA — Full Service", "SRA — Self-Serve", "SRA — Business Associate"];

  it("unchecking one variant from All leaves the other variants selected", () => {
    expect(toggleFamilyChild(["family:SRA"], "family:SRA", "SRA — Self-Serve", children).sort()).toEqual([
      "SRA — Business Associate",
      "SRA — Full Service",
    ]);
  });

  it("toggles a single variant when the parent is not selected", () => {
    expect(toggleFamilyChild(["SRA — Full Service"], "family:SRA", "SRA — Full Service", children)).toEqual([]);
    expect(toggleFamilyChild([], "family:SRA", "SRA — Full Service", children)).toEqual(["SRA — Full Service"]);
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

// ── v1.2 (Jordan's 2026-08-11 design tweaks, built 2026-08-18) ────────

import {
  activeRowSelection,
  DEFAULT_SORT,
  displayTitle,
  distinctChipValueCount,
  formatReviewDate,
  launchBannerActive,
  primaryUse,
  reviewState,
  sortItems,
  thumbnailUrl,
  usePillKind,
} from "@/features/collateral/collateral-logic";

describe("displayTitle (changes 1 + 12: filename only, extension stripped)", () => {
  it("strips the extension and keeps interior dots", () => {
    expect(displayTitle("Business Associate Pro SRA User Guide.pdf")).toBe(
      "Business Associate Pro SRA User Guide",
    );
    expect(displayTitle("VRM_Sales_Training.pptx")).toBe("VRM_Sales_Training");
    expect(displayTitle("SRA v2.1 Overview.pdf")).toBe("SRA v2.1 Overview");
    expect(displayTitle("HIPAA Seal - Circle Dark.PNG")).toBe("HIPAA Seal - Circle Dark");
  });

  it("leaves extension-less titles alone", () => {
    expect(displayTitle("Partner Pricing Sheet")).toBe("Partner Pricing Sheet");
  });

  it("never mistakes a trailing version number for an extension", () => {
    expect(displayTitle("Collateral v1.2")).toBe("Collateral v1.2");
    expect(displayTitle("Pricing 2.0")).toBe("Pricing 2.0");
    expect(displayTitle("archive.7z")).toBe("archive");
  });
});

describe("tokenized search (change 10: word-based, order-independent)", () => {
  const guides = [
    item({
      id: "pro",
      title: "Business Associate Pro SRA User Guide.pdf",
      products: ["SRA — Business Associate"],
      uses: ["Send to Customer"],
    }),
    item({
      id: "standard",
      title: "Business Associate Standard SRA User Guide.pdf",
      products: ["SRA — Business Associate"],
      uses: ["Send to Customer"],
    }),
    item({
      id: "battlecard",
      title: "Medcurity_Battlecard_BlueOrange.pdf",
      asset_type: "Battlecard",
      uses: ["Internal Enablement"],
    }),
  ];
  const chips = buildChipGroups(guides);
  const none = { search: "", products: [], assetTypes: [], segments: [], uses: [] };
  const search = (q: string) =>
    filterItems(guides, { ...none, search: q }, chips.products).map((i) => i.id);

  it("matches every spec example regardless of word order or adjacency", () => {
    expect(search("guide business")).toEqual(["pro", "standard"]);
    expect(search("business guide")).toEqual(["pro", "standard"]);
    expect(search("pro guide")).toEqual(["pro"]);
    expect(search("battlecard blueorange")).toEqual(["battlecard"]);
    expect(search("blueorange battlecard")).toEqual(["battlecard"]);
  });

  it("matches partial tokens inside longer words, case-insensitively", () => {
    expect(search("assoc")).toEqual(["pro", "standard"]);
    expect(search("ASSOC guide")).toEqual(["pro", "standard"]);
  });

  it("ANDs tokens: one unmatched word means no result", () => {
    expect(search("guide nonexistentword")).toEqual([]);
    expect(search("zebra")).toEqual([]);
  });

  it("tokens can span title and tag values", () => {
    // "battlecard" is the Type tag; "blueorange" only in the filename.
    expect(search("battlecard internal")).toEqual(["battlecard"]);
  });
});

describe("single-value filter rows (change 2: hidden across the synced set)", () => {
  it("counts distinct values, including family members", () => {
    const one = buildChipGroups([item({ products: ["VRM"] }), item({ products: ["VRM"] })]);
    expect(distinctChipValueCount(one.products)).toBe(1);

    const two = buildChipGroups([item({ products: ["VRM"] }), item({ products: ["SRA"] })]);
    expect(distinctChipValueCount(two.products)).toBe(2);

    // One family parent carrying two variants IS a real choice: 2 values.
    const family = buildChipGroups([
      item({ products: ["SRA — Full Service"] }),
      item({ products: ["SRA — Self-Serve"] }),
    ]);
    expect(family.products).toHaveLength(1); // one parent chip…
    expect(distinctChipValueCount(family.products)).toBe(2); // …two values
  });

  it("a synced set reduced to a single Product yields a hidden Product row (acceptance example)", () => {
    const singleProduct = [
      item({ id: "x", title: "A.pdf", products: ["VRM"], asset_type: "Deck", uses: ["Send to Prospect"] }),
      item({ id: "y", title: "B.pdf", products: ["VRM"], asset_type: "One-Pager", uses: ["Internal Enablement"] }),
    ];
    const chips = buildChipGroups(singleProduct);
    expect(distinctChipValueCount(chips.products) >= 2).toBe(false); // row hidden
    expect(distinctChipValueCount(chips.assetTypes) >= 2).toBe(true); // row shown
    expect(distinctChipValueCount(chips.uses) >= 2).toBe(true); // row shown
    expect(distinctChipValueCount(chips.segments) >= 2).toBe(false); // no values at all
  });

  it("a hidden row's selection is inert — it must not filter invisibly", () => {
    const singleSegment = [
      item({ id: "tagged", segments: ["All"] }),
      item({ id: "untagged", segments: [] }),
    ];
    const chips = buildChipGroups(singleSegment);
    // One distinct Segment value → the row hides → a stale saved default
    // of ["All"] must stop constraining (else "untagged" vanishes with no
    // visible chip explaining why).
    const effective = activeRowSelection(chips.segments, ["All"]);
    expect(effective).toEqual([]);
    const out = filterItems(
      singleSegment,
      { search: "", products: [], assetTypes: [], segments: effective, uses: [] },
      chips.products,
    );
    expect(out.map((i) => i.id).sort()).toEqual(["tagged", "untagged"]);
    // A visible (2+ value) row keeps its selection as-is.
    const twoSegments = buildChipGroups([
      item({ segments: ["All"] }),
      item({ segments: ["PCA"] }),
    ]);
    expect(activeRowSelection(twoSegments.segments, ["All"])).toEqual(["All"]);
  });
});

describe("reviewState + formatReviewDate (change 3: freshness on the card)", () => {
  const now = new Date(2026, 7, 18);
  // Local-calendar date strings (toISOString would drift a day in
  // positive-UTC-offset zones and flake the boundary assertions).
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    const pad = (x: number) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  it("splits reviewed / due strictly after 180 calendar days", () => {
    expect(reviewState(daysAgo(10), now)).toBe("reviewed");
    expect(reviewState(daysAgo(179), now)).toBe("reviewed");
    expect(reviewState(daysAgo(180), now)).toBe("reviewed"); // not yet MORE than 180
    expect(reviewState(daysAgo(181), now)).toBe("due");
    expect(reviewState(daysAgo(500), now)).toBe("due");
  });

  it("is stable all day: mid-afternoon on day 180 is still reviewed", () => {
    const afternoon = new Date(2026, 7, 18, 15, 30);
    expect(reviewState(daysAgo(180), afternoon)).toBe("reviewed");
    expect(reviewState(daysAgo(181), afternoon)).toBe("due");
  });

  it("blank or unparseable dates are 'never' (the compensating control)", () => {
    expect(reviewState(null, now)).toBe("never");
    expect(reviewState(undefined, now)).toBe("never");
    expect(reviewState("", now)).toBe("never");
    expect(reviewState("not a date", now)).toBe("never");
  });

  it("formats the meta line like the spec example", () => {
    expect(formatReviewDate("2026-08-11")).toBe("Aug 11, 2026");
    expect(formatReviewDate("2025-12-01")).toBe("Dec 1, 2025");
  });
});

describe("sortItems (change 5)", () => {
  const lib = [
    item({ id: "old", title: "Zeta Old.pdf", last_reviewed: "2025-01-05", created_at: "2026-08-01" }),
    item({ id: "fresh", title: "Mid Fresh.pdf", last_reviewed: "2026-08-11", created_at: "2026-06-01" }),
    item({ id: "never", title: "Alpha Never.pdf", last_reviewed: null, created_at: "2026-08-15" }),
    item({ id: "mid", title: "Beta Mid.pdf", last_reviewed: "2026-02-10", created_at: null }),
  ];

  it("defaults to Recently reviewed", () => {
    expect(DEFAULT_SORT).toBe("recently_reviewed");
  });

  it("Recently reviewed: newest date first, never-reviewed last", () => {
    expect(sortItems(lib, "recently_reviewed").map((i) => i.id)).toEqual([
      "fresh",
      "mid",
      "old",
      "never",
    ]);
  });

  it("Recently added: newest created_at first, unknown last", () => {
    expect(sortItems(lib, "recently_added").map((i) => i.id)).toEqual([
      "never",
      "old",
      "fresh",
      "mid",
    ]);
  });

  it("Name A–Z sorts on the extension-stripped display title", () => {
    expect(sortItems(lib, "name_az").map((i) => i.id)).toEqual([
      "never",
      "mid",
      "fresh",
      "old",
    ]);
  });

  it("does not mutate its input", () => {
    const before = lib.map((i) => i.id);
    sortItems(lib, "name_az");
    expect(lib.map((i) => i.id)).toEqual(before);
  });
});

describe("Use pills (change 13: generic, never a hard-coded list)", () => {
  it("maps the three known values to their treatments", () => {
    expect(usePillKind("Send to Prospect")).toBe("prospect");
    expect(usePillKind("Send to Customer")).toBe("customer");
    expect(usePillKind("Internal Enablement")).toBe("internal");
  });

  it("a future unknown value gets the safe default style, not empty space", () => {
    expect(usePillKind("Partner Only")).toBe("generic");
    expect(usePillKind("")).toBe("generic");
  });

  it("primaryUse: exactly one pill per card, most outward-permissive first", () => {
    expect(primaryUse(["Send to Customer"])).toBe("Send to Customer");
    expect(primaryUse(["Internal Enablement", "Send to Prospect"])).toBe("Send to Prospect");
    expect(primaryUse(["Internal Enablement", "Send to Customer"])).toBe("Send to Customer");
    expect(primaryUse(["Partner Only"])).toBe("Partner Only");
    expect(primaryUse(["Partner Only", "Internal Enablement"])).toBe("Internal Enablement");
    expect(primaryUse([])).toBeNull();
    expect(primaryUse(["  "])).toBeNull();
  });
});

describe("thumbnailUrl (change 14: image assets only, from stored data)", () => {
  it("returns the stored web_url for image types", () => {
    expect(
      thumbnailUrl({
        web_url: "https://x.sharepoint.com/sites/a/Sales%20Collateral/Seal%20Circle%20Dark.png",
        title: "Seal Circle Dark.png",
      }),
    ).toMatch(/Circle%20Dark\.png$/);
    expect(
      thumbnailUrl({ web_url: "https://x.sharepoint.com/s/logo.svg", title: "logo.svg" }),
    ).toBe("https://x.sharepoint.com/s/logo.svg");
    expect(
      thumbnailUrl({ web_url: "https://x.sharepoint.com/s/photo.JPG", title: "photo.JPG" }),
    ).toBe("https://x.sharepoint.com/s/photo.JPG");
  });

  it("documents keep the icon treatment", () => {
    expect(
      thumbnailUrl({ web_url: "https://x.sharepoint.com/s/deck.pptx", title: "deck.pptx" }),
    ).toBeNull();
    expect(
      thumbnailUrl({ web_url: "https://x.sharepoint.com/s/doc.pdf", title: "doc.pdf" }),
    ).toBeNull();
  });
});

describe("launch banner retirement (change 8: deterministic ~30-day window)", () => {
  it("is active through the window and retires after it", () => {
    expect(launchBannerActive(new Date(Date.UTC(2026, 7, 18, 12)))).toBe(true);
    expect(launchBannerActive(new Date(Date.UTC(2026, 8, 10)))).toBe(true);
    expect(launchBannerActive(new Date(Date.UTC(2026, 8, 18)))).toBe(false);
    expect(launchBannerActive(new Date(Date.UTC(2026, 11, 1)))).toBe(false);
  });

  it("drives the app-wide AnnouncementBanner (Nathan 8/18: all-tabs launch pattern)", () => {
    const banner = readFileSync(
      path.resolve(__dirname, "..", "src", "components", "AnnouncementBanner.tsx"),
      "utf8",
    );
    expect(banner).toContain('id: "collateral-launch-2026-08"');
    expect(banner).toContain('ctaRoute: "/collateral"');
    // The self-retirement gate: the announcement disappears on its own.
    expect(banner).toContain("launchBannerActive()");
    // One announcement at a time: the Nexus banner era ended with this.
    expect(banner).not.toContain('id: "nexus-launch-2026-08"');
    // The old page-local banner is gone from the Collateral feature.
    const page = readFileSync(
      path.resolve(__dirname, "..", "src", "features", "collateral", "CollateralPage.tsx"),
      "utf8",
    );
    expect(page).not.toContain("collat-banner");
    expect(page).not.toContain("LaunchBanner");
  });
});

describe("v1.2 source guards (role gating, title source, scope)", () => {
  const read = (...segments: string[]) =>
    readFileSync(path.resolve(__dirname, "..", ...segments), "utf8");

  it("sync titles come from the filename, never the embedded Title property", () => {
    const sync = read("supabase", "functions", "collateral-sync", "index.ts");
    expect(sync).toContain('title: (entry.name as string) || "Untitled"');
    expect(sync).not.toContain("fields.Title");
  });

  it("the /collateral route is open (no AdminGate), other gates untouched", () => {
    const app = read("src", "App.tsx");
    expect(app).toContain('<Route path="collateral" element={<CollateralPage />} />');
    // The tab-level open-up must not have weakened the other admin gates.
    expect(app).toContain('<Route path="imports" element={<AdminGate><ImportsPen /></AdminGate>} />');
    expect(app).toContain('<Route path="playbook" element={<AdminGate><PlaybookPage /></AdminGate>} />');
  });

  it("sidebar: Collateral sits in navItems with the red New tag, no ADMIN badge", () => {
    const sidebar = read("src", "components", "layout", "Sidebar.tsx");
    const collateralLines = sidebar
      .split("\n")
      .filter((l) => l.includes('"/collateral"') && !l.trim().startsWith("//"));
    expect(collateralLines).toHaveLength(1);
    // Nathan 8/18: the New tag, not the Launched pill, for this launch.
    expect(collateralLines[0]).toContain('label: "New"');
    expect(collateralLines[0]).toContain("NEW_BADGE");
    expect(collateralLines[0]).not.toContain("ADMIN_BADGE");
    // The entry must appear in navItems (before the adminItems array), and
    // the admin group must keep its own entries intact.
    expect(sidebar.indexOf('"/collateral"')).toBeLessThan(sidebar.indexOf("const adminItems"));
    expect(sidebar).toContain('{ to: "/imports", icon: Inbox, label: "Imports", badge: { label: "Admin", className: ADMIN_BADGE } }');
  });

  it("Sync SharePoint stays admin-gated in the page; Request collateral does not", () => {
    const page = read("src", "features", "collateral", "CollateralPage.tsx");
    const adminBlock = page.slice(page.indexOf("{isAdmin && ("), page.indexOf("Request collateral"));
    expect(adminBlock).toContain("Sync SharePoint");
    // The sync edge function's own admin check is covered by the v1.1
    // guard below ("allows only admins or a gateway-verified…").
  });

  it("no SharePoint curation copy anywhere in the feature", () => {
    for (const file of ["CollateralPage.tsx", "CollateralLibrary.tsx"]) {
      const src = read("src", "features", "collateral", file);
      expect(src).not.toContain("Curation lives in SharePoint");
      expect(src).not.toContain("Add assets by hand");
    }
  });

  it("the v1.2 migration widens visibility to every role and adds both prefs", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260818210000_collateral_v12_design_tweaks.sql",
    );
    for (const role of ["sales", "renewals", "admin", "super_admin", "read_only"]) {
      expect(migration).toContain(`'${role}'`);
    }
    expect(migration).toContain("density");
    expect(migration).toContain("launch_banner_dismissed_at");
    expect(migration).toMatch(/check \(density in \('comfortable', 'condensed'\)\)/);
  });

  it("per-user persistence flows through collateral_user_prefs (no new store)", () => {
    const api = read("src", "features", "collateral", "api.ts");
    expect(api).toContain('"collateral_user_prefs"');
    for (const field of ["default_segments", "density"]) {
      expect(api).toContain(field);
    }
    expect(api).not.toContain("localStorage");
    // Banner dismissal deliberately does NOT live here (app-wide
    // AnnouncementBanner localStorage pattern instead, Nathan 8/18); the
    // follow-up migration drops the unused column.
    expect(api).not.toContain("launch_banner_dismissed_at");
    const drop = read(
      "supabase",
      "migrations",
      "20260818230000_collateral_banner_to_announcement.sql",
    );
    expect(drop).toContain("drop column if exists launch_banner_dismissed_at");
  });

  it("chips build from the full synced set, not the filtered subset", () => {
    const lib = read("src", "features", "collateral", "CollateralLibrary.tsx");
    expect(lib).toContain("buildChipGroups(items ?? [])");
    expect(lib).not.toContain("buildChipGroups(filtered");
  });

  it("the saved condensed preference renders a true one-row-per-asset list", () => {
    const lib = read("src", "features", "collateral", "CollateralLibrary.tsx");
    const css = read("src", "features", "collateral", "collateral.css");
    expect(lib).toContain('aria-label="List view"');
    expect(lib).toContain('? "collat-list"');
    expect(lib).toContain('"collat-list-row group"');
    expect(lib).toContain('className="collat-list-actions"');
    expect(css).toMatch(/\.collat-list\s*\{[\s\S]*?flex-direction:\s*column/);
    expect(css).toMatch(/\.collat-list-row\s*\{[\s\S]*?display:\s*flex/);
  });

  it("the v1.1 default Use filter is gone (change 4)", () => {
    const lib = read("src", "features", "collateral", "CollateralLibrary.tsx");
    expect(lib).not.toContain("SEND_TO_PROSPECT");
    expect(lib).not.toMatch(/setUses\(\[["']/);
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
