// Featured (pinned) widget rules — the client side of the `featured`
// column added in migration 20260729200000.
//
// A user can pin up to two widgets above the "Your widgets" divider.
// Pinning a third does not fail: it unpins whichever pin has been up the
// longest, the way a phone home screen quietly makes room.
//
// "Longest" needs a pin time, and the row has none: updated_at moves on
// every rename and on every drag-reorder, so it cannot answer the
// question. Instead the pin order is logged per user in localStorage, and
// when that log has nothing to say (new browser, cleared storage) we fall
// back to the widget's own position, which is the order the pins render
// in. Both paths are deterministic and neither can throw.

import type { NexusWidget } from "./types";

/** How many widgets can sit above the divider at once. */
export const MAX_FEATURED = 2;

export function featuredOrderKey(userId: string): string {
  return `nexus_featured_order:${userId}`;
}

/** Widget ids in the order they were pinned, oldest first. */
export function readFeaturedOrder(userId: string | undefined): string[] {
  if (!userId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(featuredOrderKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function writeFeaturedOrder(userId: string | undefined, ids: string[]): void {
  if (!userId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(featuredOrderKey(userId), JSON.stringify(ids));
  } catch {
    // Storage blocked or full. The position fallback still works.
  }
}

/** Record a pin (moves the id to the newest end of the log). */
export function notePinned(userId: string | undefined, id: string): void {
  const next = readFeaturedOrder(userId).filter((v) => v !== id);
  next.push(id);
  writeFeaturedOrder(userId, next);
}

/** Record an unpin. */
export function noteUnpinned(userId: string | undefined, id: string): void {
  writeFeaturedOrder(
    userId,
    readFeaturedOrder(userId).filter((v) => v !== id),
  );
}

/**
 * Which pinned widget gives up its slot when a new one is pinned.
 *
 * `order` is the localStorage pin log (oldest first). The first logged id
 * that is still pinned wins. If the log knows none of them, the pin that
 * renders first (lowest position, id as a stable tiebreak) is the one that
 * goes. Returns null only when nothing is pinned.
 *
 * Pure so the rule can be tested without a browser.
 */
export function pickOldestFeatured<
  T extends { id: string; position: number },
>(featured: T[], order: string[]): T | null {
  if (featured.length === 0) return null;
  for (const id of order) {
    const hit = featured.find((w) => w.id === id);
    if (hit) return hit;
  }
  return [...featured].sort(
    (a, b) => a.position - b.position || a.id.localeCompare(b.id),
  )[0];
}

/**
 * The widgets that render above the divider, in the order they show:
 * position order, capped at MAX_FEATURED so a stray third row (an admin
 * edit, a stale cache) can never push the grid down the page.
 */
export function selectFeatured(widgets: NexusWidget[] | undefined): NexusWidget[] {
  return (widgets ?? [])
    .filter((w) => w.featured)
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_FEATURED);
}

/** Everything that stays in the two-stack grid, in position order. */
export function selectUnfeatured(
  widgets: NexusWidget[] | undefined,
): NexusWidget[] {
  const pinned = new Set(selectFeatured(widgets).map((w) => w.id));
  return (widgets ?? []).filter((w) => !pinned.has(w.id));
}
