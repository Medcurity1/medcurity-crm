import { describe, it, expect } from "vitest";
import {
  computeAmount,
  backSolveSubtotal,
  roundToCents,
  normalizeDiscountType,
  type DealMathInputs,
} from "@/features/opportunities/deal-math";

/**
 * Pins the opportunity Subtotal/Discount/Amount arithmetic extracted from
 * OpportunityForm.tsx. This code has caused three production regressions;
 * each has a named test below. It also has ONE deliberate asymmetry (the
 * forward path clamps percent discounts at 100, the back-solve at 99.99)
 * which is pinned AS-IS — those tests document current behavior, they are
 * not endorsements. Fixing the asymmetry changes live deal numbers.
 */

// The happy baseline: create mode (no line items), user just edited a
// money field. Each case below breaks exactly one thing about it.
const base: DealMathInputs = {
  productsLoaded: true,
  hasProducts: false,
  lastEdited: "discount",
  subtotal: 1000,
  discount: 0,
  amount: 1000,
  discountType: "percent",
};

const NO_WRITES = { subtotal: null, amount: null };

describe("computeAmount — regime guards (the three production regressions)", () => {
  it("regression: 'edit form 0's out the data and throws errors' — waits for the line-items query", () => {
    // existingProducts is undefined while the query is in flight, so
    // hasProducts reads false. Recomputing here clobbers a line-item-driven
    // amount with gross-subtotal math. Must write nothing.
    expect(
      computeAmount({
        ...base,
        productsLoaded: false,
        subtotal: 5000,
        discount: 10,
        amount: 3800,
      }),
    ).toEqual(NO_WRITES);
  });

  it("regression: line-item deals are left to the DB trigger (never form-computed)", () => {
    // recalc_opportunity_amount knows the per-line-item discounts; the form
    // does not. Any write here loses that math.
    expect(
      computeAmount({
        ...base,
        hasProducts: true,
        subtotal: 5000,
        discount: 10,
        amount: 3800,
      }),
    ).toEqual(NO_WRITES);
  });

  it("regression: SF-imported amount-only deal is not zeroed on mount", () => {
    // subtotal=0, discount=0, amount=12000 straight out of Salesforce, where
    // discount was informational rather than multiplicative. On mount
    // lastEdited is null (reset() populated the form, not the user), so
    // nothing may be written — otherwise the $12,000 deal becomes $0.
    expect(
      computeAmount({
        ...base,
        lastEdited: null,
        subtotal: 0,
        discount: 0,
        amount: 12000,
      }),
    ).toEqual(NO_WRITES);
  });

  it("regression: an amount-type discount is never treated as a percent", () => {
    // $10 off 1000 is 990. The old behavior read it as 10% and produced 900,
    // corrupting deal amounts.
    expect(
      computeAmount({ ...base, discountType: "amount", subtotal: 1000, discount: 10, amount: 1000 }),
    ).toEqual({ subtotal: null, amount: 990 });
  });

  it("only a user edit to subtotal or discount triggers the forward path", () => {
    expect(computeAmount({ ...base, lastEdited: "subtotal", discount: 10 })).toEqual({
      subtotal: null,
      amount: 900,
    });
    expect(computeAmount({ ...base, lastEdited: "discount", discount: 10 })).toEqual({
      subtotal: null,
      amount: 900,
    });
    // "amount" belongs to the back-solve effect, not this one.
    expect(computeAmount({ ...base, lastEdited: "amount", discount: 10 })).toEqual(NO_WRITES);
    expect(computeAmount({ ...base, lastEdited: null, discount: 10 })).toEqual(NO_WRITES);
  });
});

describe("computeAmount — percent discounts", () => {
  it("scales the base: amount = subtotal x (1 - disc/100)", () => {
    expect(computeAmount({ ...base, discount: 10 }).amount).toBe(900);
    expect(computeAmount({ ...base, discount: 50 }).amount).toBe(500);
  });

  it("clamps a percent discount at 100 (forward path)", () => {
    expect(computeAmount({ ...base, discount: 100 }).amount).toBe(0);
    // >100 is clamped to 100, not applied as a negative multiplier.
    expect(computeAmount({ ...base, discount: 150 }).amount).toBe(0);
    expect(computeAmount({ ...base, discount: 10000 }).amount).toBe(0);
  });

  it("floors a negative percent discount at 0", () => {
    expect(computeAmount({ ...base, discount: -25, amount: 500 }).amount).toBe(1000);
  });

  it("treats 0 / null / undefined / blank / non-numeric discounts as no discount", () => {
    for (const discount of [0, null, undefined, "", "abc", NaN]) {
      expect(computeAmount({ ...base, discount, amount: 500 }).amount).toBe(1000);
    }
  });

  it("coerces the string values a number input actually delivers", () => {
    expect(computeAmount({ ...base, subtotal: "1000", discount: "10", amount: "1000" }).amount).toBe(
      900,
    );
  });

  it("rounds to cents with Math.round (half-up), not toFixed or truncation", () => {
    expect(computeAmount({ ...base, discount: 33.333 }).amount).toBe(666.67);
    expect(computeAmount({ ...base, discount: 33.3335 }).amount).toBe(666.67);
    expect(computeAmount({ ...base, discount: 0.005 }).amount).toBe(999.95);
    // Rounding applies even with no discount at all.
    expect(computeAmount({ ...base, subtotal: 12000.555, discount: 0, amount: 0 }).amount).toBe(
      12000.56,
    );
    expect(roundToCents(2.345)).toBe(2.35);
    expect(roundToCents(-2.345)).toBe(-2.35);
    // Float artifacts come along with Math.round-on-a-float-product: 1.005
    // is really 1.00499… so it rounds DOWN. Pinned so nobody swaps in a
    // decimal library and quietly shifts cents on live deals.
    expect(roundToCents(1.005)).toBe(1);
    expect(roundToCents(2.675)).toBe(2.68);
  });

  it("skips the amount write when the computed value already matches", () => {
    expect(computeAmount({ ...base, discount: 10, amount: 900 })).toEqual(NO_WRITES);
  });
});

describe("computeAmount — flat-dollar ('amount') discounts", () => {
  it("subtracts dollars instead of scaling", () => {
    expect(
      computeAmount({ ...base, discountType: "amount", discount: 250, amount: 0 }).amount,
    ).toBe(750);
  });

  it("floors the result at 0 when the discount exceeds the base", () => {
    expect(
      computeAmount({ ...base, discountType: "amount", discount: 5000, amount: 1000 }).amount,
    ).toBe(0);
  });

  it("floors a negative flat discount at 0 (never inflates the deal)", () => {
    expect(
      computeAmount({ ...base, discountType: "amount", discount: -50, amount: 500 }).amount,
    ).toBe(1000);
  });

  it("has no upper clamp — a flat discount over 100 is dollars, not percent", () => {
    expect(
      computeAmount({ ...base, discountType: "amount", discount: 150, amount: 0 }).amount,
    ).toBe(850);
  });

  it("anything other than the literal 'amount' is a percent", () => {
    expect(normalizeDiscountType("amount")).toBe("amount");
    for (const value of ["percent", "", null, undefined, "Amount", "AMOUNT"]) {
      expect(normalizeDiscountType(value)).toBe("percent");
    }
    // "" (the schema's blank discount_type) must scale, not subtract.
    expect(computeAmount({ ...base, discountType: "", discount: 10, amount: 0 }).amount).toBe(900);
  });
});

describe("computeAmount — base fallback for amount-only / SF-imported deals", () => {
  it("falls back to the current amount when subtotal is unset, and persists the gross base", () => {
    // Editing the discount on an SF import (no subtotal) must not divide
    // into 0. Base comes from amount, and the gross base is written back to
    // subtotal so a second discount edit re-derives from 12000, not 10800.
    expect(
      computeAmount({ ...base, subtotal: undefined, discount: 10, amount: 12000 }),
    ).toEqual({ subtotal: 12000, amount: 10800 });
  });

  it("treats a 0 / null / blank / non-numeric subtotal as unset", () => {
    for (const subtotal of [0, null, "", "abc", NaN]) {
      expect(computeAmount({ ...base, subtotal, discount: 10, amount: 12000 })).toEqual({
        subtotal: 12000,
        amount: 10800,
      });
    }
  });

  it("does not overwrite a subtotal that is already set", () => {
    expect(computeAmount({ ...base, subtotal: 2000, discount: 10, amount: 0 })).toEqual({
      subtotal: null,
      amount: 1800,
    });
  });

  it("bails when there is no usable base (would otherwise zero the deal)", () => {
    expect(computeAmount({ ...base, subtotal: 0, discount: 10, amount: 0 })).toEqual(NO_WRITES);
    expect(computeAmount({ ...base, subtotal: null, discount: 10, amount: null })).toEqual(
      NO_WRITES,
    );
  });

  it("bails on a negative base rather than computing a negative amount", () => {
    expect(computeAmount({ ...base, subtotal: -500, discount: 10, amount: 0 })).toEqual(NO_WRITES);
    expect(computeAmount({ ...base, subtotal: 0, discount: 10, amount: -500 })).toEqual(NO_WRITES);
  });
});

describe("backSolveSubtotal — guards", () => {
  const amountEdit: DealMathInputs = { ...base, lastEdited: "amount", amount: 500, discount: 50 };

  it("waits for the line-items query, and leaves lastEdited set", () => {
    expect(backSolveSubtotal({ ...amountEdit, productsLoaded: false })).toEqual({
      subtotal: null,
      clearLastEdited: false,
    });
  });

  it("never back-solves a line-item deal", () => {
    expect(backSolveSubtotal({ ...amountEdit, hasProducts: true })).toEqual({
      subtotal: null,
      clearLastEdited: false,
    });
  });

  it("only runs when the user edited amount", () => {
    for (const lastEdited of ["subtotal", "discount", null] as const) {
      expect(backSolveSubtotal({ ...amountEdit, lastEdited })).toEqual({
        subtotal: null,
        clearLastEdited: false,
      });
    }
  });

  it("clears lastEdited on a completed run even when the subtotal write is skipped", () => {
    // amount 500 @ 50% back-solves to 1000, which subtotal already is: no
    // write, but the flag still resets so the next edit re-triggers.
    expect(backSolveSubtotal({ ...amountEdit, subtotal: 1000 })).toEqual({
      subtotal: null,
      clearLastEdited: true,
    });
  });
});

describe("backSolveSubtotal — arithmetic", () => {
  const amountEdit: DealMathInputs = { ...base, lastEdited: "amount", subtotal: 0 };

  it("percent: subtotal = amount / (1 - disc/100)", () => {
    expect(backSolveSubtotal({ ...amountEdit, amount: 500, discount: 50 }).subtotal).toBe(1000);
    expect(backSolveSubtotal({ ...amountEdit, amount: 900, discount: 10 }).subtotal).toBe(1000);
  });

  it("flat dollars: subtotal = amount + discount", () => {
    expect(
      backSolveSubtotal({ ...amountEdit, discountType: "amount", amount: 750, discount: 250 })
        .subtotal,
    ).toBe(1000);
  });

  it("floors a negative flat discount at 0", () => {
    expect(
      backSolveSubtotal({ ...amountEdit, discountType: "amount", amount: 750, discount: -100 })
        .subtotal,
    ).toBe(750);
  });

  it("clamps a percent discount at 99.99 (back-solve path), NOT 100", () => {
    // Divide-by-zero guard. 100 and 150 both land on 99.99.
    expect(backSolveSubtotal({ ...amountEdit, amount: 100, discount: 99.99 }).subtotal).toBe(
      1000000,
    );
    expect(backSolveSubtotal({ ...amountEdit, amount: 100, discount: 100 }).subtotal).toBe(1000000);
    expect(backSolveSubtotal({ ...amountEdit, amount: 100, discount: 150 }).subtotal).toBe(1000000);
  });

  it("floors a negative percent discount at 0", () => {
    expect(backSolveSubtotal({ ...amountEdit, amount: 750, discount: -40 }).subtotal).toBe(750);
  });

  it("treats 0 / null / undefined / blank discounts as no discount", () => {
    for (const discount of [0, null, undefined, "", "abc", NaN]) {
      expect(backSolveSubtotal({ ...amountEdit, amount: 750, discount }).subtotal).toBe(750);
    }
  });

  it("passes a negative amount straight through (no floor on this path)", () => {
    expect(backSolveSubtotal({ ...amountEdit, amount: -100, discount: 0 }).subtotal).toBe(-100);
  });

  it("treats a blank / null / non-numeric amount as 0", () => {
    for (const amount of ["", null, undefined, "abc", NaN]) {
      expect(backSolveSubtotal({ ...amountEdit, subtotal: 999, amount, discount: 0 }).subtotal).toBe(
        0,
      );
    }
  });

  it("rounds to cents", () => {
    expect(backSolveSubtotal({ ...amountEdit, amount: 666.67, discount: 33.333 }).subtotal).toBe(
      1000,
    );
    expect(backSolveSubtotal({ ...amountEdit, amount: 1000, discount: 33.333 }).subtotal).toBe(
      1499.99,
    );
    expect(backSolveSubtotal({ ...amountEdit, amount: 333.33, discount: 66.667 }).subtotal).toBe(
      1000,
    );
  });

  it("coerces the string values a number input actually delivers", () => {
    expect(
      backSolveSubtotal({ ...amountEdit, amount: "500", discount: "50", subtotal: "0" }).subtotal,
    ).toBe(1000);
  });
});

describe("the 100 vs 99.99 clamp asymmetry — PINNED AS-IS, do not 'fix'", () => {
  // Forward clamps percent discounts at 100; the back-solve clamps at 99.99
  // as a divide-by-zero guard. Both landed together in c3ed7da and have
  // shipped ever since, so subtotal -> amount -> subtotal is not a perfect
  // round-trip at the extreme. These tests document that, they don't bless it.

  it("a 100% discount zeroes the amount going forward", () => {
    expect(computeAmount({ ...base, subtotal: 1000, discount: 100, amount: 1000 }).amount).toBe(0);
  });

  it("a 100% discount is silently read as 99.99% going backward (x10,000 inflation)", () => {
    expect(
      backSolveSubtotal({ ...base, lastEdited: "amount", subtotal: 0, amount: 100, discount: 100 })
        .subtotal,
    ).toBe(1000000);
  });

  it("round-trip at 100%: subtotal 1000 -> amount 0 -> subtotal 0 (the 1000 is lost)", () => {
    const forward = computeAmount({ ...base, subtotal: 1000, discount: 100, amount: 1000 });
    expect(forward.amount).toBe(0);
    const backward = backSolveSubtotal({
      ...base,
      lastEdited: "amount",
      subtotal: 1000,
      amount: forward.amount,
      discount: 100,
    });
    expect(backward.subtotal).toBe(0);
    expect(backward.subtotal).not.toBe(1000);
  });

  it("round-trip below the clamp is lossless (the asymmetry is only at the extreme)", () => {
    for (const discount of [0, 10, 33.333, 50, 99]) {
      const forward = computeAmount({ ...base, subtotal: 1000, discount, amount: 0 });
      const backward = backSolveSubtotal({
        ...base,
        lastEdited: "amount",
        subtotal: 0,
        amount: forward.amount,
        discount,
      });
      expect(backward.subtotal).toBe(1000);
    }
  });
});
