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
