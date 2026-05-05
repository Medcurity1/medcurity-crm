/**
 * Per-section card ordering for the Team Dashboard, persisted to
 * localStorage so each owner can rearrange cards within a section
 * (Sales / Marketing / Customer Success) without affecting anyone
 * else's view. Order is keyed by `section_id` → array of `card_id`s.
 *
 * Default order matches the Codex Python dashboard layout so a
 * fresh load looks identical to the prior version. New cards added
 * later get appended to the end automatically (see `mergeOrder`).
 */

export const CARD_ORDER_LS_KEY = "team_dashboard_card_order_v1";

/** Section identifiers. Used as both the storage key and the
 *  DndContext / SortableContext id namespace. */
export type DashboardSectionId = "sales" | "marketing" | "cs";

/** Card identifiers within each section. Stable across releases —
 *  do not rename without a migration. */
export const DEFAULT_CARD_ORDER: Record<DashboardSectionId, string[]> = {
  // ARR + chart, NewCustomers + chart, NewSales chart, Pipeline chart
  sales: ["arr", "new_customers", "new_sales", "pipeline"],
  // SQL chart, MQL chart
  marketing: ["sql", "mql"],
  // Renewals chart, QTD Billing + NRR stack
  cs: ["renewals", "qtd_billing_nrr_block"],
};

export type CardOrder = Record<DashboardSectionId, string[]>;

export function loadCardOrder(): CardOrder {
  if (typeof window === "undefined") return DEFAULT_CARD_ORDER;
  try {
    const raw = window.localStorage.getItem(CARD_ORDER_LS_KEY);
    if (!raw) return DEFAULT_CARD_ORDER;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_CARD_ORDER;
    }
    // Merge stored order with defaults so newly-added cards in future
    // releases automatically appear at the end of their section.
    return {
      sales: mergeOrder(parsed.sales, DEFAULT_CARD_ORDER.sales),
      marketing: mergeOrder(parsed.marketing, DEFAULT_CARD_ORDER.marketing),
      cs: mergeOrder(parsed.cs, DEFAULT_CARD_ORDER.cs),
    };
  } catch {
    return DEFAULT_CARD_ORDER;
  }
}

export function saveCardOrder(order: CardOrder) {
  try {
    window.localStorage.setItem(CARD_ORDER_LS_KEY, JSON.stringify(order));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/**
 * Merge a user-saved order with the defaults:
 *   1. keep cards from saved order in the saved sequence (filtered to
 *      cards that still exist in defaults — drops cards that were
 *      removed from the dashboard)
 *   2. append any defaults the user hasn't seen yet (newly added cards)
 */
function mergeOrder(stored: unknown, defaults: string[]): string[] {
  if (!Array.isArray(stored)) return defaults;
  const known = new Set(defaults);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of stored) {
    if (typeof id !== "string") continue;
    if (!known.has(id) || seen.has(id)) continue;
    out.push(id);
    seen.add(id);
  }
  for (const id of defaults) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}
