// Pure, dependency-free judgment of whether a Smartlead lead-category string
// reads as a "positive" reply (Campaigns overhaul Phase 3, slice S9) — the
// only thing this file does. No Deno imports, no framework dependencies, so
// it runs identically under Deno (the edge functions) and Node/vitest (see
// tests/replyCategory.test.ts) — same pattern as webhook-normalize.ts and
// campaign-scheduling.ts.
//
// The client (src/features/playbook/reply-extract.ts) can't import this file
// directly — tsconfig.app.json's program root is "src", and this lives under
// supabase/functions/. It keeps a small hand-kept twin instead, same
// duplication convention as mergeTemplate/partitionSuppressedEmails in
// playbook-smartlead/index.ts. Keep the two in sync if this rule changes.

/**
 * Interested / Meeting Request read as positive. "Not interested" is
 * checked BEFORE the bare "interest" substring so it doesn't false-positive
 * (categories in the wild look like "Not Interested", "Interested",
 * "Meeting Request", "Do Not Contact", "Information Request", "Out of
 * Office" — case varies). Everything else (including null/blank) is not
 * positive — an unrecognized or absent category is not evidence of
 * engagement.
 */
export function isPositiveReplyCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const c = category.trim().toLowerCase();
  if (!c) return false;
  if (c.includes("not interest")) return false;
  if (c.includes("interest")) return true;
  if (c.includes("meeting")) return true;
  return false;
}

/**
 * Map an arbitrary category string to Smartlead's canonical set, or null
 * when it matches nothing (docket I11). The webhook is a PUBLIC endpoint
 * and its payload's category field used to be stored verbatim — an
 * arbitrary attacker string that then flowed into the AI prompt (whose
 * training notes become permanent "hard rules") and rendered as a UI
 * badge. Storing only canonical values closes the injection path and
 * keeps every category-based count trustworthy. "Not interested" is
 * checked before "interested" for the same substring reason as above.
 */
export const CANONICAL_REPLY_CATEGORIES = [
  "Interested",
  "Meeting Request",
  "Not Interested",
  "Do Not Contact",
  "Information Request",
  "Out of Office",
  "Wrong Person",
] as const;

export function sanitizeReplyCategory(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = raw.trim().toLowerCase();
  if (!c) return null;
  if (c.includes("not interest")) return "Not Interested";
  if (c.includes("interest")) return "Interested";
  if (c.includes("meeting")) return "Meeting Request";
  if (c.includes("do not contact") || c.includes("dnc")) return "Do Not Contact";
  if (c.includes("information")) return "Information Request";
  if (c.includes("out of office") || c.includes("ooo")) return "Out of Office";
  if (c.includes("wrong person")) return "Wrong Person";
  return null;
}
