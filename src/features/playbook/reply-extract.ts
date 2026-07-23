// Client-side twin of supabase/functions/_shared/webhook-normalize.ts's
// replyBody extraction (Campaigns overhaul S7) — reads the SAME field-name
// variants off a campaign_events.payload row (the raw Smartlead webhook
// body, stored verbatim) so the Replies feed (CampaignsTab.tsx) shows the
// same text the server captured at receipt time. Deliberately tiny: only
// the reply-text extraction, not the full normalizer — event type, campaign
// id, email, and timestamp are already their own columns on campaign_events,
// not something this needs to re-derive from the payload. Keep the field
// list in sync with normalizeWebhookPayload's replyBody read if that ever
// changes.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstNonEmptyString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/** Best-effort reply text from a campaign_events.payload row. Null when no
 *  known field variant is present — callers show a "(reply text
 *  unavailable)" fallback rather than an empty row. */
export function extractReplyBody(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;
  const data = isPlainObject(payload.data) ? payload.data : {};
  return firstNonEmptyString(
    payload.reply, payload.reply_body, payload.preview_text, payload.reply_message,
    data.reply, data.reply_body, data.preview_text,
  );
}

/** Client-side twin of supabase/functions/_shared/reply-category.ts's
 *  isPositiveReplyCategory (Campaigns overhaul Phase 3, S9) — the Replies
 *  feed badge and the Campaigns tab month stats strip both need this same
 *  judgment, but a browser bundle can't import the Deno-side file (its
 *  program root is supabase/functions/, outside tsconfig.app.json's "src"
 *  include). Kept in sync manually — same duplication convention as
 *  mergeTemplate/partitionSuppressedEmails in playbook-smartlead/index.ts.
 *  If this rule ever changes, update both. */
export function isPositiveReplyCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const c = category.trim().toLowerCase();
  if (!c) return false;
  if (c.includes("not interest")) return false;
  if (c.includes("interest")) return true;
  if (c.includes("meeting")) return true;
  return false;
}
