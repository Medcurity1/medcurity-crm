import { describe, it, expect } from "vitest";
import { shouldWarnNotABug } from "../src/features/requests/bug-warning";
import type { BugClassification } from "../src/features/requests/api";

// ---------------------------------------------------------------------------
// MSD-999 — the not-a-bug warning gate. Client-facing BUGS keep the fast path
// straight to dev; a client-facing NON-bug (request/enhancement filed under
// Bug) gets an are-you-sure dialog first. These pin when that dialog may and
// may not fire: only on an explicit looksLikeBug:false verdict, only when the
// submitter is choosing the straight-to-dev path, never after they bypassed
// it for this verdict, and never on degraded/timed-out verdicts.
// ---------------------------------------------------------------------------

function verdict(over: Partial<BugClassification> = {}): BugClassification {
  return {
    clientFacing: true,
    looksLikeBug: true,
    confidence: 0.9,
    reasoning: "x",
    ...over,
  };
}

describe("shouldWarnNotABug", () => {
  it("warns when choosing straight-to-dev on an explicit not-a-bug verdict", () => {
    expect(shouldWarnNotABug(verdict({ looksLikeBug: false }), true, false)).toBe(true);
  });

  it("never warns when the report looks like a real bug", () => {
    expect(shouldWarnNotABug(verdict(), true, false)).toBe(false);
  });

  it("treats a missing looksLikeBug (older Helm build) as a real bug", () => {
    const v = verdict();
    delete (v as Partial<BugClassification>).looksLikeBug;
    expect(shouldWarnNotABug(v, true, false)).toBe(false);
  });

  it("never warns on the review path — that's where we're steering them", () => {
    expect(shouldWarnNotABug(verdict({ looksLikeBug: false }), false, false)).toBe(false);
  });

  it("stays quiet after the submitter bypassed it for this verdict", () => {
    expect(shouldWarnNotABug(verdict({ looksLikeBug: false }), true, true)).toBe(false);
  });

  it("never warns without a usable verdict (null / timed out / degraded)", () => {
    expect(shouldWarnNotABug(null, true, false)).toBe(false);
    expect(shouldWarnNotABug(undefined, true, false)).toBe(false);
    expect(
      shouldWarnNotABug(verdict({ looksLikeBug: false, timedOut: true }), true, false),
    ).toBe(false);
    expect(
      shouldWarnNotABug(verdict({ looksLikeBug: false, degraded: true }), true, false),
    ).toBe(false);
  });
});
