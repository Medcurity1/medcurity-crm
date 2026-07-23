import { describe, it, expect } from "vitest";
import { isPositiveReplyCategory } from "../supabase/functions/_shared/reply-category.ts";

// ---------------------------------------------------------------------------
// Campaigns overhaul Phase 3, slice S9 — the pure "does this reply category
// read as positive" judgment shared by the Replies feed badge and the
// Campaigns tab month stats strip.
//
// Mirrors campaignScheduling.test.ts / campaignWebhookNormalize.test.ts:
// imports supabase/functions/_shared/reply-category.ts directly (zero
// dependencies, runs the same under Deno and vitest).
// ---------------------------------------------------------------------------

describe("isPositiveReplyCategory", () => {
  it("treats Interested as positive", () => {
    expect(isPositiveReplyCategory("Interested")).toBe(true);
  });

  it("treats Meeting Request as positive", () => {
    expect(isPositiveReplyCategory("Meeting Request")).toBe(true);
  });

  it("treats Not Interested as NOT positive (the interest false-positive trap)", () => {
    expect(isPositiveReplyCategory("Not Interested")).toBe(false);
  });

  it("treats Do Not Contact as not positive", () => {
    expect(isPositiveReplyCategory("Do Not Contact")).toBe(false);
  });

  it("treats Information Request as not positive", () => {
    expect(isPositiveReplyCategory("Information Request")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isPositiveReplyCategory("interested")).toBe(true);
    expect(isPositiveReplyCategory("NOT INTERESTED")).toBe(false);
    expect(isPositiveReplyCategory("meeting request")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isPositiveReplyCategory("  Interested  ")).toBe(true);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isPositiveReplyCategory(null)).toBe(false);
    expect(isPositiveReplyCategory(undefined)).toBe(false);
    expect(isPositiveReplyCategory("")).toBe(false);
    expect(isPositiveReplyCategory("   ")).toBe(false);
  });

  it("returns false for an unrecognized category rather than guessing", () => {
    expect(isPositiveReplyCategory("Out of Office")).toBe(false);
    expect(isPositiveReplyCategory("Wrong Person")).toBe(false);
  });
});
