// Collateral filtering — the pure core of Jordan's spec, unit-tested.
//
// Her hardest-to-notice requirement (item 3): chips FILTER, they never
// group. An asset tagged with two products appears under both chips.
// Within one chip row selections OR together; across rows they AND; the
// search box ANDs with all of it (item 2: substring across title + every
// tag — reps think in the words on the document, not our column values).
//
// Item 4: product values sharing the "SRA — " prefix collapse into one
// parent chip presentation-side. Tagging stays flat; the hierarchy is
// display only, and any future "Family — Variant" product works the same
// way with zero code change.

export interface CollateralItemLike {
  id: string;
  title: string;
  asset_type: string | null;
  products: string[];
  segments: string[];
  uses: string[];
  pinned: boolean;
}

// ── v1.1 additions (Jordan's 2026-08-11 spec) ────────────────────────

/** §4: "Review due" mirrors the library's Needs Review cycle. */
export const REVIEW_DUE_DAYS = 180;

/**
 * An asset whose Last Reviewed is more than 180 days old gets the amber
 * "Review due" badge. No Last Reviewed value = no badge (the library's
 * Status gate is the authority on whether it should render at all).
 */
export function isReviewDue(
  lastReviewed: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastReviewed) return false;
  const d = new Date(lastReviewed);
  if (Number.isNaN(d.getTime())) return false;
  return now.getTime() - d.getTime() > REVIEW_DUE_DAYS * 86_400_000;
}

export type FileKind = "pdf" | "doc" | "slides" | "sheet" | "image" | "file";

/** File-type glyph selection from the filename/URL extension. */
export function fileKind(nameOrUrl: string | null | undefined): FileKind {
  const m = (nameOrUrl ?? "").toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  const ext = m?.[1] ?? "";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "rtf"].includes(ext)) return "doc";
  if (["ppt", "pptx", "key"].includes(ext)) return "slides";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "image";
  return "file";
}

/** One selectable chip; family parents carry their children. */
export interface Chip {
  value: string;
  label: string;
  /** Variant values under a family parent (e.g. the three SRAs). */
  children?: Chip[];
}

export interface ChipGroups {
  products: Chip[];
  assetTypes: Chip[];
  segments: Chip[];
  uses: Chip[];
}

export interface CollateralFilter {
  search: string;
  products: string[];
  assetTypes: string[];
  segments: string[];
  uses: string[];
}

/** Matches "SRA — Full Service", "SRA - Self-Serve", "SRA – BA" etc. */
const FAMILY_SPLIT = /^(.+?)\s+[—–-]\s+(.+)$/;

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/**
 * Chips come from the values actually present (her item 3 note: adding a
 * product later is a data change, not a code change). Product values that
 * share a "Family — Variant" prefix with at least one sibling collapse
 * under a parent chip; lone prefixed values stay flat.
 */
export function buildChipGroups(items: CollateralItemLike[]): ChipGroups {
  const products = uniqueSorted(items.flatMap((i) => i.products));
  const families = new Map<string, string[]>();
  for (const value of products) {
    const m = value.match(FAMILY_SPLIT);
    if (!m) continue;
    const family = m[1].trim();
    families.set(family, [...(families.get(family) ?? []), value]);
  }

  const productChips: Chip[] = [];
  const consumed = new Set<string>();
  for (const [family, members] of families) {
    if (members.length < 2) continue; // a lone "X — Y" is not a family
    members.forEach((v) => consumed.add(v));
    productChips.push({
      value: `family:${family}`,
      label: family,
      children: members.map((v) => ({
        value: v,
        label: v.match(FAMILY_SPLIT)?.[2].trim() ?? v,
      })),
    });
  }
  for (const value of products) {
    if (!consumed.has(value)) productChips.push({ value, label: value });
  }
  productChips.sort((a, b) => a.label.localeCompare(b.label));

  return {
    products: productChips,
    assetTypes: uniqueSorted(items.map((i) => i.asset_type ?? "")).map((v) => ({
      value: v,
      label: v,
    })),
    segments: uniqueSorted(items.flatMap((i) => i.segments)).map((v) => ({
      value: v,
      label: v,
    })),
    uses: uniqueSorted(items.flatMap((i) => i.uses)).map((v) => ({
      value: v,
      label: v,
    })),
  };
}

/** Expand any selected family parents into their member values. */
export function expandProductSelection(
  selected: string[],
  chips: Chip[],
): string[] {
  const out = new Set<string>();
  for (const value of selected) {
    if (value.startsWith("family:")) {
      const parent = chips.find((c) => c.value === value);
      for (const child of parent?.children ?? []) out.add(child.value);
    } else {
      out.add(value);
    }
  }
  return [...out];
}

function rowMatches(itemValues: string[], selected: string[]): boolean {
  if (!selected.length) return true; // no chips in this row = no constraint
  return selected.some((s) => itemValues.includes(s));
}

export function filterItems<T extends CollateralItemLike>(
  items: T[],
  filter: CollateralFilter,
  productChips: Chip[],
): T[] {
  const products = expandProductSelection(filter.products, productChips);
  const q = filter.search.trim().toLowerCase();
  return items.filter((item) => {
    if (!rowMatches(item.products, products)) return false;
    if (!rowMatches(item.asset_type ? [item.asset_type] : [], filter.assetTypes))
      return false;
    if (!rowMatches(item.segments, filter.segments)) return false;
    if (!rowMatches(item.uses, filter.uses)) return false;
    if (q) {
      const haystack = [
        item.title,
        item.asset_type ?? "",
        ...item.products,
        ...item.segments,
        ...item.uses,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/**
 * A rep's default segment selection, applied only when the segments they
 * saved actually exist in the data (a stale pref can't blank the tab).
 * Her item 7 note: the default must include "All" or segment-agnostic
 * assets vanish — that's the seed's job; here we just honor what's saved.
 */
export function initialSegmentSelection(
  savedDefaults: string[] | undefined,
  chips: Chip[],
): string[] {
  if (!savedDefaults?.length) return [];
  const available = new Set(chips.map((c) => c.value));
  return savedDefaults.filter((s) => available.has(s));
}
