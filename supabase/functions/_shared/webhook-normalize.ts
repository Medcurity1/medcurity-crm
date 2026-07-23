// Pure, dependency-free normalizer for Smartlead campaign-webhook payloads
// (Campaigns overhaul Phase 2, slice S5). Smartlead's own docs and observed
// payloads disagree on field naming across event types and API versions, so
// this reads every plausible variant defensively rather than assuming one
// shape. NEVER throws — a malformed/junk payload just comes back with every
// field null/unresolved, which the caller (campaign-webhooks/index.ts) is
// built to tolerate (it still logs a campaign_events row for anything with
// at least a resolvable campaign, and 200s unconditionally otherwise).
//
// Deliberately has NO Deno imports and no framework dependencies, so it runs
// identically under Deno (the edge function) and Node/vitest (the test
// suite) — same pattern as campaign-scheduling.ts. See
// tests/campaignWebhookNormalize.test.ts.

export type CanonicalWebhookEventType =
  | "EMAIL_SENT"
  | "EMAIL_OPENED"
  | "EMAIL_CLICKED"
  | "EMAIL_REPLIED"
  | "EMAIL_BOUNCED"
  | "EMAIL_UNSUBSCRIBED";

export interface NormalizedWebhookEvent {
  /** Canonical event type, or null if the payload's event-type field was
   *  missing or didn't match any known variant. */
  type: CanonicalWebhookEventType | null;
  /** The event-type value exactly as read off the payload (before mapping),
   *  stringified — kept even when `type` is null so an unrecognized event is
   *  still diagnosable in campaign_events.payload / logs. Null if no
   *  event-type field was present at all. */
  rawType: string | null;
  /** Smartlead's numeric campaign id, or null if absent/unparseable. */
  smartleadCampaignId: number | null;
  /** The recipient's email address, lowercased/trimmed, or null. */
  email: string | null;
  /** ISO-8601 timestamp string if the payload's timestamp field parsed as a
   *  valid date, else null. Never throws on a garbage timestamp value. */
  occurredAt: string | null;
  /** Reply body text (EMAIL_REPLIED only), or null. */
  replyBody: string | null;
  /** Smartlead's numeric lead id for this recipient within the campaign, or
   *  null if absent/unparseable. */
  leadId: number | null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** First defined, non-null value among a list of candidate reads. */
function firstDefined<T>(...vals: (T | null | undefined)[]): T | null {
  for (const v of vals) {
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toEmailOrNull(v: unknown): string | null {
  const s = toStringOrNull(v);
  return s ? s.toLowerCase() : null;
}

function toIsoOrNull(v: unknown): string | null {
  const s = toStringOrNull(v);
  if (!s) return null;
  // Bare unix-seconds timestamps are also a plausible variant.
  const asNumber = Number(s);
  const d = Number.isFinite(asNumber) && /^\d+$/.test(s)
    ? new Date(asNumber > 1e12 ? asNumber : asNumber * 1000) // ms vs seconds
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Canonical type -> the substrings (lowercased, underscore-normalized) that
// identify it. Order matters: more specific patterns first isn't required
// here since the substrings don't overlap.
const TYPE_PATTERNS: [CanonicalWebhookEventType, RegExp][] = [
  [ "EMAIL_REPLIED", /repl/ ],
  [ "EMAIL_BOUNCED", /bounc/ ],
  [ "EMAIL_UNSUBSCRIBED", /unsub/ ],
  [ "EMAIL_CLICKED", /click/ ],
  [ "EMAIL_OPENED", /open/ ],
  [ "EMAIL_SENT", /sent|send/ ],
];

function mapEventType(raw: string | null): CanonicalWebhookEventType | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  for (const [canonical, pattern] of TYPE_PATTERNS) {
    if (pattern.test(normalized)) return canonical;
  }
  return null;
}

/**
 * Parse a Smartlead campaign-webhook payload (already JSON-decoded — the
 * caller handles raw-body reading/parsing) into a normalized, defensively-typed
 * shape. Tolerates: non-object input, nested `data`/`lead`/`campaign`
 * sub-objects, camelCase/snake_case field variants, numeric-or-string ids,
 * and missing fields entirely. Never throws.
 */
export function normalizeWebhookPayload(raw: unknown): NormalizedWebhookEvent {
  const empty: NormalizedWebhookEvent = {
    type: null,
    rawType: null,
    smartleadCampaignId: null,
    email: null,
    occurredAt: null,
    replyBody: null,
    leadId: null,
  };
  try {
    if (!isPlainObject(raw)) return empty;
    const body = raw;
    // A handful of observed/plausible payload shapes nest the real fields
    // under `data`, and recipient info under `lead`/`to`. Read both the
    // top level and these nested spots for every field.
    const data = isPlainObject(body.data) ? body.data : {};
    const lead = isPlainObject(body.lead) ? body.lead : isPlainObject(data.lead) ? data.lead : {};
    const campaign = isPlainObject(body.campaign) ? body.campaign : isPlainObject(data.campaign) ? data.campaign : {};
    const to = isPlainObject(body.to) ? body.to : {};

    const rawTypeVal = firstDefined<unknown>(
      body.event_type, body.eventType, body.event, body.type, data.event_type, data.eventType,
    );
    const rawType = toStringOrNull(rawTypeVal);
    const type = mapEventType(rawType);

    const smartleadCampaignId = toIntOrNull(firstDefined<unknown>(
      body.campaign_id, body.campaignId, data.campaign_id, data.campaignId, campaign.id,
    ));

    const email = toEmailOrNull(firstDefined<unknown>(
      body.to_email, body.lead_email, body.email, data.to_email, data.lead_email, data.email,
      lead.email, to.email,
    ));

    const occurredAt = toIsoOrNull(firstDefined<unknown>(
      body.event_timestamp, body.time_sent, body.timestamp, body.sent_time,
      data.event_timestamp, data.time_sent, data.timestamp,
    ));

    const replyBody = toStringOrNull(firstDefined<unknown>(
      body.reply, body.reply_body, body.preview_text, body.reply_message,
      data.reply, data.reply_body, data.preview_text,
    ));

    const leadId = toIntOrNull(firstDefined<unknown>(
      body.lead_id, body.leadId, data.lead_id, data.leadId, lead.id,
    ));

    return { type, rawType, smartleadCampaignId, email, occurredAt, replyBody, leadId };
  } catch {
    // Defensive backstop — normalizeWebhookPayload must never throw, even
    // against a payload shape nobody anticipated.
    return empty;
  }
}
