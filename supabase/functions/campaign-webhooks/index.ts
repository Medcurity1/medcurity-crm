// campaign-webhooks Edge Function — Campaigns overhaul Phase 2, slice S5.
//
// Receives Smartlead's campaign webhook events (EMAIL_SENT, EMAIL_OPENED,
// EMAIL_CLICKED, EMAIL_REPLIED, EMAIL_BOUNCED, EMAIL_UNSUBSCRIBED) and reacts:
//   - Always logs a `campaign_events` row (even when the event can't be
//     resolved to a known campaign/enrollment — recorded, never dropped).
//   - EMAIL_SENT: captures Smartlead's per-person lead id; on that person's
//     FIRST send, records first_send_at and — if the actual send date
//     differs from what we'd scheduled — shifts their still-pending
//     CALL/LINKEDIN/EMAIL_HYBRID tasks by the same day delta.
//   - EMAIL_REPLIED: stops the enrollment, archives its pending tasks,
//     notifies the campaign owner (bell + a same-day follow-up task).
//   - EMAIL_BOUNCED: stops the enrollment, archives its pending tasks, and
//     records the address in marketing_optouts (reason 'bounced').
//   - EMAIL_UNSUBSCRIBED: records the opt-out in marketing_optouts (reason
//     'unsubscribed' — non-overridable at launch), flags the linked contact
//     do_not_contact, archives pending tasks, and stops the enrollment if
//     it's still live. The opt-out side effects run even when the
//     enrollment already ended (outside-review fix 2 — see
//     stopEnrollmentForUnsubscribe in _shared/campaign-enrollment-actions).
//   - EMAIL_OPENED / EMAIL_CLICKED: event row only, no state change.
//
// PUBLIC endpoint (no user JWT — Smartlead's servers call this, not a
// browser). Deploy: supabase functions deploy campaign-webhooks --no-verify-jwt
//
// Auth: a per-campaign secret. launch() (playbook-smartlead/index.ts)
// generates a random `webhook_secret` and registers this function's URL —
// with that secret as a `?token=` query param — as the campaign's Smartlead
// webhook. Every inbound call must present a `token` that constant-time-
// matches the `campaigns.webhook_secret` row resolved from the payload's
// campaign id; anything else is rejected 401 BEFORE any payload content is
// trusted. If Smartlead also sends an HMAC-SHA256 signature header (keyed by
// the same secret), it's checked when present and the outcome is logged
// either way — but it never gates the request. The token check above is the
// SOLE authentication; see verifyOptionalSignature's doc comment for why a
// present-but-unverifiable signature fails open instead of 401ing (docket
// I21).
//
// Resilience: once past the auth gate, this handler NEVER throws past the
// top-level try/catch — any processing error is logged and still answered
// 200 {received:true, note:...} so Smartlead's retry/backoff schedule (and
// eventual 5-failure auto-disable) isn't triggered by our own bugs. Every
// per-enrollment action is idempotent (guarded on current status / existing
// timestamps), so webhook replays are safe.
//
// The pure "raw payload -> normalized fields" parsing lives in
// _shared/webhook-normalize.ts (dependency-free; unit-tested directly in
// tests/campaignWebhookNormalize.test.ts) — this file is the Deno/Supabase
// wiring around it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizeWebhookPayload, type CanonicalWebhookEventType } from "../_shared/webhook-normalize.ts";
import { sanitizeReplyCategory } from "../_shared/reply-category.ts";
import { dateOnly, daysBetweenDateOnly, shiftEnrollmentTasks } from "../_shared/campaign-task-shift.ts";
import {
  stopEnrollmentForBounce,
  stopEnrollmentForReply,
  stopEnrollmentForUnsubscribe,
} from "../_shared/campaign-enrollment-actions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

// ---------------------------------------------------------------------
// Auth: per-campaign token (required) + optional HMAC signature.
// ---------------------------------------------------------------------

function constantTimeEqualStrings(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  // Length is compared directly (not hidden) — same trade-off pandadoc-sync
  // makes; only the byte-content comparison itself needs to be timing-safe.
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase().replace(/^sha256=/, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * If Smartlead sent a signature header, verify HMAC-SHA256(rawBody, secret)
 * against it (constant-time) and log the outcome. This check is advisory
 * ONLY and never rejects the request — the ?token= gate (checked by the
 * caller before this function runs) is the entire authentication story
 * here.
 *
 * Why fail open (docket I21): an ABSENT signature header is already
 * accepted (nothing to check, token gate already passed), so rejecting a
 * PRESENT-but-unverifiable one adds zero real security — an attacker who
 * wanted past this check would simply omit the header rather than send a
 * bad one. But treating "present and wrong" as a hard failure creates a
 * genuine lockout risk: if Smartlead ever starts signing with a different
 * key or scheme (e.g. an account-level key instead of per-campaign, or a
 * new signature format), every single webhook call would suddenly fail
 * verification, this endpoint would 401 all of them, and Smartlead's own
 * retry/backoff would hit its 5-consecutive-failure auto-disable — killing
 * live updates for every campaign at once, for a mismatch that carries no
 * actual security signal. So: verified match keeps working as an extra
 * signal when Smartlead does sign correctly; anything else is logged
 * (never the secret or the full signature/token — just which header
 * showed up) and let through.
 */
async function verifyOptionalSignature(rawBody: string, req: Request, secret: string): Promise<void> {
  const headerCandidates: [name: string, value: string | null][] = [
    ["X-Smartlead-Signature", req.headers.get("X-Smartlead-Signature")],
    ["x-smartlead-signature", req.headers.get("x-smartlead-signature")],
    ["X-Signature", req.headers.get("X-Signature")],
    ["X-Webhook-Signature", req.headers.get("X-Webhook-Signature")],
  ];
  const found = headerCandidates.find(([, v]) => !!v);
  if (!found) {
    // Nothing to check — the token gate already authenticated the request.
    return;
  }
  const [headerName, header] = found as [string, string];
  const presented = hexToBytes(header);
  if (!presented) {
    console.warn(`campaign-webhooks: signature header "${headerName}" present but not valid hex; accepting (token gate is authoritative — see verifyOptionalSignature doc comment)`);
    return;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const macBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = new Uint8Array(macBuf);
  if (presented.length !== expected.length) {
    console.warn(`campaign-webhooks: signature header "${headerName}" present but did not verify (length mismatch); accepting (token gate is authoritative)`);
    return;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented[i] ^ expected[i];
  if (diff !== 0) {
    console.warn(`campaign-webhooks: signature header "${headerName}" present but did not verify; accepting (token gate is authoritative)`);
    return;
  }
  // Verified — nothing to log; this is the expected steady state once
  // Smartlead signs with the same secret we generated.
}

// dateOnly/daysBetweenDateOnly (whole-day shifts, EMAIL_SENT handling below)
// now come from _shared/campaign-task-shift.ts (see the top-of-file import).

/** Best-effort: is this webhook call a Smartlead lead-category update
 *  (LEAD_CATEGORY_UPDATED — Interested / Meeting Request / Not Interested /
 *  Do Not Contact / Information Request, etc.), rather than one of the six
 *  canonical send-lifecycle events? Matched on the raw type string since
 *  normalizeWebhookPayload's mapEventType only recognizes the six canonical
 *  patterns (repl/bounc/unsub/click/open/sent) and correctly leaves this
 *  unmapped (`type: null`) — a category update isn't a send-lifecycle state
 *  transition, so it deliberately stays outside that enum. This is a
 *  narrower, additional check layered on top, not a change to
 *  normalizeWebhookPayload's contract. (Campaigns overhaul Phase 3, S9.) */
function isLeadCategoryUpdateEvent(rawType: string | null): boolean {
  return rawType != null && /categor/i.test(rawType);
}

/** Best-effort category-string extraction off a LEAD_CATEGORY_UPDATED-ish
 *  payload — same "read every plausible variant, top-level and nested under
 *  data" defensiveness as extractStepNumber below. Kept local for the same
 *  reason: a best-effort extra, not part of webhook-normalize.ts's
 *  guaranteed contract. */
function extractCategory(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const data = (typeof body.data === "object" && body.data !== null && !Array.isArray(body.data))
    ? body.data as Record<string, unknown>
    : {};
  const candidates = [body.category, body.lead_category, body.category_name, data.category, data.lead_category, data.category_name];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Best-effort seq/step number extraction — Smartlead's field name for
 *  "which sequence email was this" isn't nailed down in the docs we could
 *  verify, so this reads every plausible variant and returns null (meaning
 *  "not derivable, leave current_step as-is") rather than guessing. Kept
 *  local (not in webhook-normalize.ts) since it's a best-effort extra, not
 *  part of the normalizer's guaranteed contract. */
function extractStepNumber(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  const data = (typeof body.data === "object" && body.data !== null && !Array.isArray(body.data))
    ? body.data as Record<string, unknown>
    : {};
  const candidates = [
    body.seq_number, body.sequence_number, body.step_number, body.email_seq_number,
    data.seq_number, data.sequence_number, data.step_number,
  ];
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const n = Number(c);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

// shiftEnrollmentTasks comes from _shared/ (see the top-of-file import) —
// handleEmailSent below calls shiftEnrollmentTasks(svc, ...) directly. The
// reply/bounce/unsubscribe reactions all live in
// _shared/campaign-enrollment-actions.ts (one implementation, shared with
// the daily sweep's reconcile).

// ---------------------------------------------------------------------
// Enrollment shape read/written by the handlers below.
// ---------------------------------------------------------------------

interface Enrollment {
  id: string;
  contact_id: string | null;
  account_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  company: string | null;
  owner_user_id: string | null;
  status: string;
  current_step: number;
  first_send_at: string | null;
  actual_first_send_at: string | null;
  smartlead_lead_id: number | null;
}
interface Campaign {
  id: string;
  name: string;
  owner_user_id: string | null;
  webhook_secret: string | null;
}

async function resolveEnrollment(campaignId: string, email: string | null, leadId: number | null): Promise<Enrollment | null> {
  const cols = "id, contact_id, account_id, first_name, last_name, email, company, owner_user_id, status, current_step, first_send_at, actual_first_send_at, smartlead_lead_id";
  // .limit(1) with a stable order instead of .maybeSingle() (docket I3):
  // pre-dedupe data can hold two enrollments for one email, and
  // .maybeSingle() ERRORS on two rows — which made every event for that
  // address unprocessable forever. Earliest enrollment wins, matching the
  // launch-side first-occurrence dedupe.
  if (email) {
    const { data, error } = await svc
      .from("campaign_enrollments")
      .select(cols)
      .eq("campaign_id", campaignId)
      .eq("email", normalizeEmail(email))
      .order("enrolled_at", { ascending: true })
      .limit(1);
    if (error) console.error("campaign-webhooks: enrollment lookup by email failed:", error.message);
    if (data?.length) return data[0] as unknown as Enrollment;
  }
  if (leadId != null) {
    const { data, error } = await svc
      .from("campaign_enrollments")
      .select(cols)
      .eq("campaign_id", campaignId)
      .eq("smartlead_lead_id", leadId)
      .order("enrolled_at", { ascending: true })
      .limit(1);
    if (error) console.error("campaign-webhooks: enrollment lookup by lead id failed:", error.message);
    if (data?.length) return data[0] as unknown as Enrollment;
  }
  return null;
}

// ---------------------------------------------------------------------
// Per-event-type handlers. Each is self-contained and idempotent.
// ---------------------------------------------------------------------

async function handleEmailSent(enrollment: Enrollment, leadId: number | null, occurredAtIso: string, rawPayload: unknown): Promise<void> {
  const updates: Record<string, unknown> = {};

  if (leadId != null && enrollment.smartlead_lead_id == null) {
    updates.smartlead_lead_id = leadId;
  }

  // One-time estimate->actual correction, gated on actual_first_send_at
  // being unset (added by 20260723060000_campaigns_audit_fixes.sql).
  // first_send_at is pre-populated at launch with an ESTIMATE (anchor +
  // throttle math — computeAndPersistFirstSendDates); the first time
  // Smartlead confirms a REAL send for this enrollment, that confirmation
  // is authoritative forever after. Every later EMAIL_SENT in the sequence
  // (day 2, day 5, ... of an 8-Touch) must NOT re-anchor first_send_at or
  // re-shift tasks again — comparing against the estimate on every send
  // (the old `current_step===0 || !first_send_at || dateOnly(...)!==
  // sendDate` check) made every subsequent send look like a fresh mismatch
  // and re-fired the shift, drifting all pending tasks. actual_first_send_at
  // being non-null means "already corrected once" and short-circuits this
  // whole branch — only smartlead_lead_id/current_step still update below.
  if (!enrollment.actual_first_send_at) {
    const sendDate = dateOnly(occurredAtIso);
    if (enrollment.first_send_at) {
      const delta = daysBetweenDateOnly(enrollment.first_send_at, occurredAtIso);
      if (delta !== 0) {
        await shiftEnrollmentTasks(svc, enrollment.id, delta);
      }
    }
    updates.first_send_at = sendDate;
    updates.actual_first_send_at = occurredAtIso;
  }

  const derivedStep = extractStepNumber(rawPayload);
  if (derivedStep != null) {
    updates.current_step = Math.max(enrollment.current_step ?? 0, derivedStep);
  }

  if (Object.keys(updates).length) {
    const { error } = await svc.from("campaign_enrollments").update(updates).eq("id", enrollment.id);
    if (error) console.error("campaign-webhooks: EMAIL_SENT update failed:", error.message);
  }
}

// handleReplied/handleBounced/handleUnsubscribed are now
// stopEnrollmentForReply / stopEnrollmentForBounce /
// stopEnrollmentForUnsubscribe from _shared/campaign-enrollment-actions.ts
// (see the top-of-file import and the switch statement below) — S6
// extraction (+ outside-review fix 2 for the unsubscribe) so the
// daily-sweep's per-lead reconcile reacts identically.

// ---------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Some webhook providers ping the URL with a GET to verify it's alive
  // when a webhook is first registered. Harmless to answer without doing
  // any auth/DB work — nothing here can leak or mutate anything.
  if (req.method === "GET") return json({ ok: true });

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    console.warn("campaign-webhooks: missing ?token=; rejecting");
    return json({ error: "unauthorized" }, 401);
  }

  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
    rawBody = "";
  }

  // Request-size cap (512KB) — Smartlead payloads are small JSON objects;
  // anything wildly bigger is either a malformed/malicious caller or a
  // provider bug, and JSON.parse'ing an unbounded body is needless memory
  // pressure on this function. Keep the endpoint's always-200-except-auth
  // contract (see the top-of-file "Resilience" note) — don't insert
  // anything, just acknowledge and drop it.
  if (rawBody.length > 512_000) {
    console.warn("campaign-webhooks: oversized payload (", rawBody.length, "bytes ) ignored");
    return json({ received: true, note: "oversized payload ignored" });
  }

  let parsed: unknown = null;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsed = null;
  }

  const normalized = normalizeWebhookPayload(parsed);

  // Can't gate against a per-campaign secret without knowing which campaign
  // this is — fail closed rather than guess.
  if (normalized.smartleadCampaignId == null) {
    console.warn("campaign-webhooks: no resolvable smartlead campaign id in payload; rejecting");
    return json({ error: "unauthorized" }, 401);
  }

  const { data: campaignRow, error: campErr } = await svc
    .from("campaigns")
    .select("id, name, owner_user_id, webhook_secret")
    .eq("smartlead_campaign_id", normalized.smartleadCampaignId)
    .maybeSingle();
  if (campErr) {
    console.error("campaign-webhooks: campaign lookup failed:", campErr.message);
    return json({ error: "lookup failed" }, 500);
  }
  if (!campaignRow || !campaignRow.webhook_secret) {
    console.warn("campaign-webhooks: unknown campaign or no secret on file; rejecting", normalized.smartleadCampaignId);
    return json({ error: "unauthorized" }, 401);
  }
  if (!constantTimeEqualStrings(token, campaignRow.webhook_secret)) {
    console.warn("campaign-webhooks: token mismatch; rejecting");
    return json({ error: "unauthorized" }, 401);
  }
  // Advisory-only from here — see verifyOptionalSignature's doc comment.
  // It never rejects; the token check above is what already authenticated
  // this request.
  await verifyOptionalSignature(rawBody, req, campaignRow.webhook_secret);

  const campaign = campaignRow as Campaign;

  // From here on: authenticated. Never throw past this point — log and
  // still 200, so a bug on our end can't trip Smartlead's failure-count
  // auto-disable.
  try {
    const enrollment = await resolveEnrollment(campaign.id, normalized.email, normalized.leadId);
    const occurredAtIso = normalized.occurredAt ?? new Date().toISOString();

    const { error: evErr } = await svc.from("campaign_events").insert({
      smartlead_campaign_id: normalized.smartleadCampaignId,
      campaign_id: campaign.id,
      enrollment_id: enrollment?.id ?? null,
      event_type: normalized.rawType ?? normalized.type ?? "UNKNOWN",
      email: normalized.email,
      payload: (parsed && typeof parsed === "object" && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : {},
      occurred_at: normalized.occurredAt,
    });
    if (evErr) console.error("campaign-webhooks: campaign_events insert failed:", evErr.message);

    // Lead-category update (S9) — not one of the six canonical send-lifecycle
    // events (normalized.type stays null for it, by design), so this is
    // handled BEFORE the "unrecognized event_type" early return below rather
    // than inside the type switch further down. The generic event row above
    // already recorded it either way; this additionally persists the
    // classification onto the enrollment so the Replies feed / month stats
    // can read it without re-parsing every payload.
    if (isLeadCategoryUpdateEvent(normalized.rawType) && enrollment) {
      // Canonicalized before storage (docket I11): this is a PUBLIC
      // endpoint, and a verbatim category string flowed into the AI prompt
      // and the UI. Unknown values are dropped, not stored.
      const category = sanitizeReplyCategory(extractCategory(parsed));
      if (category) {
        const { error: catErr } = await svc
          .from("campaign_enrollments")
          .update({ reply_category: category })
          .eq("id", enrollment.id);
        if (catErr) console.error("campaign-webhooks: reply_category update failed:", catErr.message);
      }
    }

    if (!normalized.type) {
      return json({ received: true, note: isLeadCategoryUpdateEvent(normalized.rawType) ? "category updated" : "unrecognized event_type" });
    }
    if (!enrollment) {
      return json({ received: true, note: "no matching enrollment" });
    }

    const { error: bumpErr } = await svc
      .from("campaign_enrollments")
      .update({ last_event_at: occurredAtIso })
      .eq("id", enrollment.id);
    if (bumpErr) console.error("campaign-webhooks: last_event_at bump failed:", bumpErr.message);

    const type = normalized.type as CanonicalWebhookEventType;
    switch (type) {
      case "EMAIL_SENT":
        await handleEmailSent(enrollment, normalized.leadId, occurredAtIso, parsed);
        break;
      case "EMAIL_REPLIED":
        await stopEnrollmentForReply(svc, enrollment, campaign, normalized.replyBody, normalized.email);
        break;
      case "EMAIL_BOUNCED":
        await stopEnrollmentForBounce(svc, enrollment, campaign.id);
        break;
      case "EMAIL_UNSUBSCRIBED":
        await stopEnrollmentForUnsubscribe(svc, enrollment, campaign.id);
        break;
      case "EMAIL_OPENED":
      case "EMAIL_CLICKED":
        // Event row already recorded above; no state change.
        break;
    }

    return json({ received: true });
  } catch (err) {
    console.error("campaign-webhooks: processing error (still 200ing to avoid retry storms):", (err as Error).message);
    return json({ received: true, note: "processing error, logged" });
  }
});
