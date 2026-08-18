// Collateral filtering: the pure core of Jordan's spec, unit-tested.
//
// Her hardest-to-notice requirement (item 3): chips FILTER, they never
// group. An asset tagged with two products appears under both chips.
// Within one chip row selections OR together; across rows they AND; the
// search box ANDs with all of it. v1.2 change 11: the search query splits
// into whitespace tokens and EVERY token must appear somewhere in the
// title + tags, in any order, partial-word ("guide business" finds
// "Business Associate Pro SRA User Guide").
//
// Item 4: product values sharing the "SRA — " prefix collapse into one
// parent chip presentation-side. Tagging stays flat; the hierarchy is
// display only, and any future "Family: Variant" product works the same
// way with zero code change.

export interface CollateralItemLike {
  id: string;
  title: string;
  asset_type: string | null;
  products: string[];
  segments: string[];
  uses: string[];
  pinned: boolean;
  /** v1.2: sorting and freshness read these when present. */
  last_reviewed?: string | null;
  created_at?: string | null;
}

// ── v1.1 additions (Jordan's 2026-08-11 spec) ────────────────────────

/** §4: "Review due" mirrors the library's Needs Review cycle. */
export const REVIEW_DUE_DAYS = 180;

/**
 * v1.2 change 3: freshness is the tab's core quality signal, so every
 * card gets a state, including the blank-date case. SharePoint's Needs
 * Review view EXCLUDES blank dates, so an asset that never got a review
 * date is invisible to the review cycle — "never" is the compensating
 * control, amber like "due".
 *
 *   reviewed → within 180 days; card shows "Reviewed <date>"
 *   due      → older than 180 days; amber "Review due" pill
 *   never    → blank (or unparseable) Last Reviewed; amber "Not reviewed"
 */
export type ReviewState = "reviewed" | "due" | "never";

export function reviewState(
  lastReviewed: string | null | undefined,
  now: Date = new Date(),
): ReviewState {
  if (!lastReviewed) return "never";
  const d = parseDateOnly(lastReviewed);
  if (!d) return "never";
  // Whole-calendar-day math: "more than 180 days old" means day 181+.
  // Comparing wall-clock instants would flip the pill mid-morning on day
  // 180 (and drift ±1h across DST); local midnights + rounding don't.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  return days > REVIEW_DUE_DAYS ? "due" : "reviewed";
}

/** v1.1 compat: the amber "Review due" pill condition. */
export function isReviewDue(
  lastReviewed: string | null | undefined,
  now: Date = new Date(),
): boolean {
  return reviewState(lastReviewed, now) === "due";
}

/** Parse a date-only string ("2026-08-11") in LOCAL time. `new Date` on a
 * bare date parses UTC and can shift a day in negative-offset zones. */
function parseDateOnly(value: string): Date | null {
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "2026-08-11" → "Aug 11, 2026" for the card's review meta line. */
export function formatReviewDate(lastReviewed: string): string {
  const d = parseDateOnly(lastReviewed);
  if (!d) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ── v1.2 title derivation (changes 1 + 12) ───────────────────────────

/**
 * Card titles come from the SharePoint FILENAME only (the sync mirrors
 * entry.name verbatim; embedded Title/Subject document properties are
 * never read — they carry generator-tool junk like "PptxGenJS
 * Presentation"). Display strips the extension; the full filename stays
 * available as the hover tooltip.
 */
export function displayTitle(filename: string): string {
  // The extension must contain a letter: "Report v2.1" is a version
  // fragment, not a ".1" file type, and must render whole.
  const m = filename.trim().match(/^(.+)\.([a-z0-9]{1,8})$/i);
  return m && /[a-z]/i.test(m[2]) ? m[1] : filename.trim();
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
 * share a "Family: Variant" prefix with at least one sibling collapse
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
    if (members.length < 2) continue; // a lone "X: Y" is not a family
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

/**
 * v1.2 change 2: a filter row renders only when the SYNCED SET carries
 * two or more distinct values for its column — a one-option row cannot
 * filter anything and reads as broken. Chips are built from the full
 * synced set (never the filtered subset), so rows reappear automatically
 * as the library grows. Family parents count each member value.
 */
export function distinctChipValueCount(chips: Chip[]): number {
  let count = 0;
  for (const chip of chips) {
    count += chip.children?.length ? chip.children.length : 1;
  }
  return count;
}

/**
 * A hidden filter row must also be an INERT one: a selection held by a
 * row that no longer renders (a stale saved segment default, or a set
 * that shrank on re-sync) would filter invisibly with no chip explaining
 * it and no control to clear it. Callers pass each row's selection
 * through this before filtering.
 */
export function activeRowSelection(chips: Chip[], selected: string[]): string[] {
  return distinctChipValueCount(chips) < 2 ? [] : selected;
}

/**
 * v1.2 change 11: word-based, order-independent search. The query splits
 * on whitespace into tokens; an asset matches when EVERY token appears
 * somewhere in its searchable text (title + all tag values), in any
 * order, at any position, case-insensitively. "guide business",
 * "business guide", and "pro guide" all find the Pro user guide.
 */
export function searchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function filterItems<T extends CollateralItemLike>(
  items: T[],
  filter: CollateralFilter,
  productChips: Chip[],
): T[] {
  const products = expandProductSelection(filter.products, productChips);
  const tokens = searchTokens(filter.search);
  return items.filter((item) => {
    if (!rowMatches(item.products, products)) return false;
    if (!rowMatches(item.asset_type ? [item.asset_type] : [], filter.assetTypes))
      return false;
    if (!rowMatches(item.segments, filter.segments)) return false;
    if (!rowMatches(item.uses, filter.uses)) return false;
    if (tokens.length) {
      // Both the raw filename and the extension-stripped display title go
      // in, so "guide.pdf" and "guide" both land.
      const haystack = [
        item.title,
        displayTitle(item.title),
        item.asset_type ?? "",
        ...item.products,
        ...item.segments,
        ...item.uses,
      ]
        .join(" ")
        .toLowerCase();
      if (!tokens.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });
}

// ── v1.2 change 5: sort control ──────────────────────────────────────

export type CollateralSort = "recently_reviewed" | "recently_added" | "name_az";

export const SORT_OPTIONS: { value: CollateralSort; label: string }[] = [
  { value: "recently_reviewed", label: "Recently reviewed" },
  { value: "recently_added", label: "Recently added" },
  { value: "name_az", label: "Name A–Z" },
];

/** The default puts the freshest, most trustworthy material first,
 * consistent with the card's freshness signal (change 3). */
export const DEFAULT_SORT: CollateralSort = "recently_reviewed";

/**
 * Pure, stable sort. "Recently reviewed" floats dated assets above
 * never-reviewed ones (a blank date is the least trustworthy state);
 * "Recently added" uses the mirror row's created_at (when the asset
 * first appeared in the library as Current). Ties fall back to Name A–Z
 * so the order is deterministic.
 */
export function sortItems<T extends CollateralItemLike>(
  items: T[],
  sort: CollateralSort,
): T[] {
  const byName = (a: T, b: T) =>
    displayTitle(a.title).localeCompare(displayTitle(b.title), undefined, {
      sensitivity: "base",
    });
  const time = (value: string | null | undefined) => {
    if (!value) return Number.NEGATIVE_INFINITY;
    // Full timestamps (created_at) keep their intra-day precision;
    // date-only values (last_reviewed) parse in local time.
    const d = value.length > 10 ? new Date(value) : parseDateOnly(value);
    return d && !Number.isNaN(d.getTime()) ? d.getTime() : Number.NEGATIVE_INFINITY;
  };
  const sorted = [...items];
  if (sort === "name_az") {
    sorted.sort(byName);
  } else if (sort === "recently_added") {
    sorted.sort((a, b) => time(b.created_at) - time(a.created_at) || byName(a, b));
  } else {
    sorted.sort(
      (a, b) => time(b.last_reviewed) - time(a.last_reviewed) || byName(a, b),
    );
  }
  return sorted;
}

// ── v1.2 change 13: every Use value gets a pill ──────────────────────

/**
 * The pill is driven from the VALUE generically, never a hard-coded
 * value list: a future Use value renders with the neutral default style
 * instead of disappearing (the "Send to Customer renders as nothing"
 * defect). Known values keep their meaning-carrying colors:
 *   Send to Prospect    → teal   (safe to send cold)
 *   Send to Customer    → navy   (safe for existing customers)
 *   Internal Enablement → amber  (keep inside)
 *   anything else       → neutral default pill, verbatim label
 */
export type UsePillKind = "prospect" | "customer" | "internal" | "generic";

export function usePillKind(value: string): UsePillKind {
  const v = value.trim().toLowerCase();
  if (v === "send to prospect") return "prospect";
  if (v === "send to customer") return "customer";
  if (v === "internal enablement") return "internal";
  return "generic";
}

/**
 * Cards show exactly one Use pill. Multi-tagged assets show the most
 * outward-permissive value (prospect ⊃ customer ⊃ internal — a rep's
 * first question is "can I send this?"), then any unknown value in the
 * order the library stores it.
 */
export function primaryUse(uses: string[]): string | null {
  const cleaned = uses.map((u) => u.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  for (const kind of ["prospect", "customer", "internal"] as const) {
    const hit = cleaned.find((u) => usePillKind(u) === kind);
    if (hit) return hit;
  }
  return cleaned[0];
}

// ── v1.2 change 14: image thumbnails ─────────────────────────────────

/**
 * For image file types the actual artwork IS the identifying information
 * (ten HIPAA seals differ only in shape and colour). The mirror stores no
 * thumbnail data and the sync must not change, so the card renders the
 * item's own SharePoint web_url in an <img>: it resolves through the
 * rep's existing SharePoint session — exactly the auth the Open link
 * already relies on — and the card falls back to the file-type glyph if
 * the browser can't load it. Documents keep the icon treatment.
 */
export function thumbnailUrl(item: {
  web_url: string;
  title: string;
}): string | null {
  return fileKind(item.title || item.web_url) === "image" ? item.web_url : null;
}

// ── v1.2 change 8: launch banner retirement ──────────────────────────

/** Staging release of Collateral v1.2 (Jordan's design-tweaks spec).
 * Bump when the release moves to production if the ~30-day announcement
 * window should restart from the prod date. */
export const COLLATERAL_V12_RELEASED_AT = Date.UTC(2026, 7, 18); // 2026-08-18

/** The banner announces the tab, then retires on its own. */
export const LAUNCH_BANNER_RETIRE_DAYS = 30;

export function launchBannerActive(now: Date = new Date()): boolean {
  return (
    now.getTime() <
    COLLATERAL_V12_RELEASED_AT + LAUNCH_BANNER_RETIRE_DAYS * 86_400_000
  );
}

/**
 * A rep's default segment selection, applied only when the segments they
 * saved actually exist in the data (a stale pref can't blank the tab).
 * Her item 7 note: the default must include "All" or segment-agnostic
 * assets vanish: that's the seed's job; here we just honor what's saved.
 */
export function initialSegmentSelection(
  savedDefaults: string[] | undefined,
  chips: Chip[],
): string[] {
  if (!savedDefaults?.length) return [];
  const available = new Set(chips.map((c) => c.value));
  return savedDefaults.filter((s) => available.has(s));
}
