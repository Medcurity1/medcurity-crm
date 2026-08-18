/**
 * Deal money math — Subtotal / Discount / Amount.
 *
 * Extracted verbatim from the two auto-recalc useEffects in
 * OpportunityForm.tsx so the arithmetic is testable in isolation. These
 * functions are PURE: they read a snapshot of the form state and return
 * what should be written. The effects stay thin (watch → call → setValue)
 * and own all the React side effects.
 *
 * ---------------------------------------------------------------------------
 * TWO REGIMES — the thing that keeps breaking
 * ---------------------------------------------------------------------------
 * 1. LINE-ITEM deals: the opp has opportunity_line_items, so `amount` is
 *    owned by the DB trigger `recalc_opportunity_amount` (it knows the
 *    per-line-item discounts). The form must NOT compute amount at all.
 * 2. AMOUNT-ONLY deals: no line items — mostly SF imports plus manually
 *    keyed deals. Here the form's Subtotal/Discount/Amount arithmetic is
 *    the only thing driving the numbers.
 *
 * Every production regression on this code has been the form touching
 * money in regime 1, or touching it in regime 2 before the user asked for
 * it. The guards below are the scar tissue; each carries the report that
 * produced it. Do not "simplify" them away.
 *
 * ---------------------------------------------------------------------------
 * KNOWN, DELIBERATE ASYMMETRY — DO NOT "FIX"
 * ---------------------------------------------------------------------------
 * The forward path clamps a percent discount with Math.min(100, …) while
 * the back-solve clamps with Math.min(99.99, …) (a divide-by-zero guard;
 * both clamps landed together in c3ed7da). Consequence: subtotal → amount
 * → subtotal is NOT a perfect round-trip at the extreme.
 *
 *   forward:    subtotal 1000 @ 100%  →  amount 0
 *   back-solve: amount   100  @ 100%  →  subtotal 1,000,000 (100% read as 99.99%)
 *
 * This is CURRENT SHIPPED BEHAVIOR and is pinned by tests in
 * tests/dealMath.test.ts. Changing it changes live deal numbers.
 */

/** How the `discount` value is interpreted. Anything not "amount" is a percent. */
export type DiscountType = "percent" | "amount";

/** Which money field the user touched last (the form's lastEditedRef). */
export type LastEditedMoneyField = "subtotal" | "discount" | "amount" | null;

/**
 * Everything the two recalc effects read.
 *
 * The numeric fields are `unknown` on purpose: they come straight off
 * `watch()`, and a `<input type="number">` registered without
 * `valueAsNumber` delivers STRINGS ("", "12000"), while the schema's
 * blankableNumber can deliver `null`. Coercion (`Number(x) || 0`) is part
 * of the behavior being preserved, so it stays inside these functions.
 */
export interface DealMathInputs {
  /** False while the line-items query is still in flight (edit mode). */
  productsLoaded: boolean;
  /** True when the opp already has line items (DB trigger owns amount). */
  hasProducts: boolean;
  /** The form's lastEditedRef.current at the time the effect runs. */
  lastEdited: LastEditedMoneyField;
  /** watch("subtotal") */
  subtotal: unknown;
  /** watch("discount") */
  discount: unknown;
  /** watch("amount") */
  amount: unknown;
  /** watch("discount_type") */
  discountType: unknown;
}

/**
 * What the forward effect should write. `null` means "leave that field
 * alone" — it is NOT the same as 0, which is a real value to write.
 */
export interface ComputeAmountResult {
  subtotal: number | null;
  amount: number | null;
}

/**
 * What the back-solve effect should write, plus whether it should clear
 * lastEditedRef. The flag is only cleared when the effect runs to
 * completion — the early returns (including the divide-by-zero bail)
 * leave it set, which is existing behavior.
 */
export interface BackSolveSubtotalResult {
  subtotal: number | null;
  clearLastEdited: boolean;
}

/** Money rounding used everywhere here: Math.round to 2 decimals. */
export function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Treat anything that isn't the literal "amount" as a percent — matching
 * the schema default (discount_type is optional and may be "").
 */
export function normalizeDiscountType(value: unknown): DiscountType {
  return value === "amount" ? "amount" : "percent";
}

/**
 * FORWARD: Amount = Subtotal × (1 − Discount/100), or Subtotal − $Discount.
 *
 * Keeps Amount in sync so reps see the impact of a discount on the deal
 * total in real time. Discount is a PERCENT (0–100) by default, matching
 * the DB trigger recalc_opportunity_amount.
 *
 * Mirrors the effect keyed on [subtotal, discount, discount_type,
 * hasProducts, productsLoaded].
 */
export function computeAmount(input: DealMathInputs): ComputeAmountResult {
  const noWrites = (): ComputeAmountResult => ({ subtotal: null, amount: null });

  // REGRESSION GUARD 1 — user-reported: "edit form 0's out the data and
  // throws errors." existingProducts is `undefined` while the line-items
  // query is in flight. This must WAIT for it; otherwise an opp whose
  // amount is line-item-driven gets clobbered on first render (effect
  // runs → hasProducts still false → overwrites amount with
  // subtotal × (1−disc/100), losing per-line-item discount math).
  if (!input.productsLoaded) return noWrites(); // wait until we know if opp has products
  if (input.hasProducts) return noWrites(); // DB trigger owns amount when products exist

  // REGRESSION GUARD 2 — only recompute when the USER edited subtotal or
  // discount. On initial mount lastEdited is null because reset()
  // populated the form from DB values — we must NOT recompute then, or
  // SF-imported opps with subtotal=0, discount=0, amount=12000 get
  // silently zeroed. (Issue: discount on SF data was informational, not
  // multiplicative.)
  if (input.lastEdited !== "subtotal" && input.lastEdited !== "discount") {
    return noWrites();
  }

  // Base off subtotal, but fall back to the current amount when subtotal is
  // unset (amount-only / SF-imported opps) so editing the discount can't
  // divide into 0 and silently zero out the deal. No usable base -> bail.
  const base = Number(input.subtotal) || Number(input.amount) || 0;
  if (base <= 0) return noWrites();

  // REGRESSION GUARD 3 — honor discount_type: a flat-$ ('amount') discount
  // subtracts dollars; a percent discount scales. Treating an amount-type
  // discount as a percent (the old behavior) corrupted the deal amount.
  // Floor at 0.
  const dtype = normalizeDiscountType(input.discountType);
  let next: number;
  if (dtype === "amount") {
    const discAmt = Math.max(0, Number(input.discount) || 0);
    next = roundToCents(Math.max(0, base - discAmt));
  } else {
    // Forward clamp is 100 (see module header: asymmetric with the back-solve).
    const discPct = Math.max(0, Math.min(100, Number(input.discount) || 0));
    next = roundToCents(base * (1 - discPct / 100));
  }

  const result: ComputeAmountResult = { subtotal: null, amount: null };
  // Persist the gross base into subtotal when it wasn't set, so the displayed
  // subtotal is populated and a second discount edit re-derives from the
  // original value instead of compounding off the discounted amount.
  if (!(Number(input.subtotal) > 0)) {
    result.subtotal = roundToCents(base);
  }
  if (next !== Number(input.amount)) {
    result.amount = next;
  }
  return result;
}

/**
 * BACK-SOLVE: user typed in Amount directly → derive Subtotal, honoring
 * discount_type.
 *
 *   percent: subtotal = amount / (1 − disc/100)
 *   amount:  subtotal = amount + $disc
 *
 * Mirrors the effect keyed on [amount, hasProducts, productsLoaded].
 */
export function backSolveSubtotal(input: DealMathInputs): BackSolveSubtotalResult {
  const noWrites = (): BackSolveSubtotalResult => ({ subtotal: null, clearLastEdited: false });

  // Same regime guards as the forward path (see computeAmount).
  if (!input.productsLoaded) return noWrites();
  if (input.hasProducts) return noWrites();
  if (input.lastEdited !== "amount") return noWrites();

  const amt = Number(input.amount) || 0;
  let nextSub: number;
  if (normalizeDiscountType(input.discountType) === "amount") {
    // amount = subtotal - discAmt  =>  subtotal = amount + discAmt
    nextSub = roundToCents(amt + Math.max(0, Number(input.discount) || 0));
  } else {
    // Back-solve clamp is 99.99, NOT 100 — divide-by-zero guard. This is the
    // documented asymmetry with computeAmount; preserve it (module header).
    const discPct = Math.max(0, Math.min(99.99, Number(input.discount) || 0));
    const factor = 1 - discPct / 100;
    // Unreachable given the 99.99 clamp (factor >= ~0.0001), but kept as-is:
    // it is part of the shipped code path and costs nothing.
    if (factor <= 0) return noWrites();
    nextSub = roundToCents(amt / factor);
  }

  return {
    subtotal: nextSub !== Number(input.subtotal) ? nextSub : null,
    // Reset the flag so the next subtotal/discount edit re-triggers.
    clearLastEdited: true,
  };
}
