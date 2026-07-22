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
//   - EMAIL_BOUNCED: stops the enrollment, archives its pending tasks.
//   - EMAIL_UNSUBSCRIBED: stops the enrollment, archives its pending tasks,
//     and flags the linked contact do_not_contact.
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
// the same secret), it's verified too when present; the header's absence is
// logged but does not reject on its own (the token gate is the primary
// defense — see verifyOptionalSignature below).
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

// Enrollment statuses a webhook event should NOT act on again — same list
// as playbook-smartlead's ENROLLMENT_TERMINAL_STATUSES, duplicated here
// (Deno functions don't share application code across directories except
// via _shared/) so a replayed webhook after a terminal transition is a
// clean no-op rather than re-archiving/re-notifying.
const ENROLLMENT_TERMINAL_STATUSES = ["completed", "stopped", "replied", "bounced"];

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
 * against it (constant-time). Returns true when there's nothing to check
 * (no header present — logged by the caller, not treated as a failure since
 * the ?token= gate already authenticated the request) or when the signature
 * matches; false only on a PRESENT-but-WRONG signature.
 */
async function verifyOptionalSignature(rawBody: string, req: Request, secret: string): Promise<boolean> {
  const header = req.headers.get("X-Smartlead-Signature")
    ?? req.headers.get("x-smartlead-signature")
    ?? req.headers.get("X-Signature")
    ?? req.headers.get("X-Webhook-Signature");
  if (!header) {
    console.warn("campaign-webhooks: no signature header present; continuing (token gate already passed)");
    return true;
  }
  const presented = hexToBytes(header);
  if (!presented) {
    console.warn("campaign-webhooks: signature header is not valid hex; rejecting");
    return false;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const macBuf = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = new Uint8Array(macBuf);
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= presented[i] ^ expected[i];
  if (diff !== 0) {
    console.warn("campaign-webhooks: signature mismatch; rejecting");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// Small date helpers (whole-day shifts only — see EMAIL_SENT handling).
// ---------------------------------------------------------------------

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Whole-day delta between two "YYYY-MM-DD"-prefixed strings (b - a). */
function daysBetweenDateOnly(aISO: string, bISO: string): number {
  const a = Date.parse(`${dateOnly(aISO)}T00:00:00Z`);
  const b = Date.parse(`${dateOnly(bISO)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

function addDaysToIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
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

// ---------------------------------------------------------------------
// Task archiving (mirrors cancelPendingCampaignTasks in
// playbook-smartlead/index.ts, scoped to specific enrollment ids instead of
// a whole campaign). archived_by is null — these are system-triggered by a
// Smartlead event, not a human action, same convention as an automation-
// driven archive elsewhere in the app.
// ---------------------------------------------------------------------

async function archivePendingTasksForEnrollment(enrollmentId: string, reason: string): Promise<number> {
  const { data: pending, error: findErr } = await svc
    .from("activities")
    .select("id")
    .eq("campaign_enrollment_id", enrollmentId)
    .eq("is_campaign_generated", true)
    .is("completed_at", null)
    .is("archived_at", null);
  if (findErr) {
    console.error("campaign-webhooks: pending-task lookup failed:", findErr.message);
    return 0;
  }
  const ids = (pending ?? []).map((t) => t.id as string);
  if (!ids.length) return 0;
  const { error: updErr } = await svc
    .from("activities")
    .update({ archived_at: new Date().toISOString(), archived_by: null, archive_reason: reason })
    .in("id", ids);
  if (updErr) {
    console.error("campaign-webhooks: archive update failed:", updErr.message);
    return 0;
  }
  return ids.length;
}

/** Shift every still-pending campaign-generated task's due_at/reminder_at
 *  for one enrollment by `days` whole days — used when Smartlead's actual
 *  send date differs from the date we originally scheduled around. A small
 *  per-enrollment task set (a handful of CALL/LINKEDIN/EMAIL_HYBRID rows at
 *  most), so sequential per-row updates are fine — no batching needed. */
async function shiftEnrollmentTasks(enrollmentId: string, days: number): Promise<void> {
  if (!days) return;
  const { data: tasks, error } = await svc
    .from("activities")
    .select("id, due_at, reminder_at")
    .eq("campaign_enrollment_id", enrollmentId)
    .eq("is_campaign_generated", true)
    .is("completed_at", null)
    .is("archived_at", null);
  if (error) {
    console.error("campaign-webhooks: task lookup for re-date failed:", error.message);
    return;
  }
  for (const t of (tasks ?? []) as { id: string; due_at: string | null; reminder_at: string | null }[]) {
    const updates: Record<string, unknown> = {};
    if (t.due_at) updates.due_at = addDaysToIso(t.due_at, days);
    if (t.reminder_at) updates.reminder_at = addDaysToIso(t.reminder_at, days);
    if (Object.keys(updates).length) {
      const { error: updErr } = await svc.from("activities").update(updates).eq("id", t.id);
      if (updErr) console.error("campaign-webhooks: task re-date failed for", t.id, updErr.message);
    }
  }
}

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
  status: string;
  current_step: number;
  first_send_at: string | null;
  smartlead_lead_id: number | null;
}
interface Campaign {
  id: string;
  name: string;
  owner_user_id: string | null;
  webhook_secret: string | null;
}

async function resolveEnrollment(campaignId: string, email: string | null, leadId: number | null): Promise<Enrollment | null> {
  const cols = "id, contact_id, account_id, first_name, last_name, email, status, current_step, first_send_at, smartlead_lead_id";
  if (email) {
    const { data, error } = await svc
      .from("campaign_enrollments")
      .select(cols)
      .eq("campaign_id", campaignId)
      .eq("email", normalizeEmail(email))
      .maybeSingle();
    if (error) console.error("campaign-webhooks: enrollment lookup by email failed:", error.message);
    if (data) return data as unknown as Enrollment;
  }
  if (leadId != null) {
    const { data, error } = await svc
      .from("campaign_enrollments")
      .select(cols)
      .eq("campaign_id", campaignId)
      .eq("smartlead_lead_id", leadId)
      .maybeSingle();
    if (error) console.error("campaign-webhooks: enrollment lookup by lead id failed:", error.message);
    if (data) return data as unknown as Enrollment;
  }
  return null;
}

function displayName(e: Enrollment, fallbackEmail: string | null): string {
  const name = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim();
  if (name) return name;
  return e.email || fallbackEmail || "A contact";
}

// ---------------------------------------------------------------------
// Per-event-type handlers. Each is self-contained and idempotent.
// ---------------------------------------------------------------------

async function handleEmailSent(enrollment: Enrollment, leadId: number | null, occurredAtIso: string, rawPayload: unknown): Promise<void> {
  const updates: Record<string, unknown> = {};

  if (leadId != null && enrollment.smartlead_lead_id == null) {
    updates.smartlead_lead_id = leadId;
  }

  const sendDate = dateOnly(occurredAtIso);
  const isFirstSend = enrollment.current_step === 0
    || !enrollment.first_send_at
    || dateOnly(enrollment.first_send_at) !== sendDate;

  if (isFirstSend) {
    if (enrollment.first_send_at) {
      const delta = daysBetweenDateOnly(enrollment.first_send_at, occurredAtIso);
      if (delta !== 0) {
        await shiftEnrollmentTasks(enrollment.id, delta);
      }
    }
    updates.first_send_at = sendDate;
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

async function handleReplied(enrollment: Enrollment, campaign: Campaign, replyBody: string | null, fallbackEmail: string | null): Promise<void> {
  if (ENROLLMENT_TERMINAL_STATUSES.includes(enrollment.status)) return; // replay / already handled

  const { error } = await svc
    .from("campaign_enrollments")
    .update({ status: "replied", replied_at: new Date().toISOString(), paused_reason: "replied" })
    .eq("id", enrollment.id);
  if (error) console.error("campaign-webhooks: EMAIL_REPLIED status update failed:", error.message);

  await archivePendingTasksForEnrollment(enrollment.id, "Contact replied");

  if (!campaign.owner_user_id) return; // nobody to notify
  const who = displayName(enrollment, fallbackEmail);
  const link = `/playbook?campaign=${campaign.id}`;

  const { error: notifErr } = await svc.from("notifications").insert({
    user_id: campaign.owner_user_id,
    type: "engagement",
    title: "Reply received",
    message: `${who} replied in ${campaign.name} — their sequence stopped`,
    link,
  });
  if (notifErr) console.error("campaign-webhooks: reply notification insert failed:", notifErr.message);

  const nowIso = new Date().toISOString();
  const { error: taskErr } = await svc.from("activities").insert({
    activity_type: "task",
    owner_user_id: campaign.owner_user_id,
    subject: `Reply from ${who} — ${campaign.name}`,
    body: replyBody ? replyBody.slice(0, 2000) : null,
    due_at: nowIso,
    priority: "high",
    reminder_schedule: "once",
    reminder_at: nowIso,
    reminder_channels: ["in_app", "email"],
    is_campaign_generated: true,
    campaign_enrollment_id: enrollment.id,
    campaign_step_number: null,
    contact_id: enrollment.contact_id,
    account_id: enrollment.account_id,
  });
  if (taskErr) console.error("campaign-webhooks: reply follow-up task insert failed:", taskErr.message);
}

async function handleBounced(enrollment: Enrollment): Promise<void> {
  if (ENROLLMENT_TERMINAL_STATUSES.includes(enrollment.status)) return;
  const { error } = await svc
    .from("campaign_enrollments")
    .update({ status: "bounced", bounced_at: new Date().toISOString() })
    .eq("id", enrollment.id);
  if (error) console.error("campaign-webhooks: EMAIL_BOUNCED status update failed:", error.message);
  await archivePendingTasksForEnrollment(enrollment.id, "Email bounced");
}

async function handleUnsubscribed(enrollment: Enrollment): Promise<void> {
  if (ENROLLMENT_TERMINAL_STATUSES.includes(enrollment.status)) return;
  const { error } = await svc
    .from("campaign_enrollments")
    .update({ status: "stopped", unsubscribed_at: new Date().toISOString(), paused_reason: "unsubscribed" })
    .eq("id", enrollment.id);
  if (error) console.error("campaign-webhooks: EMAIL_UNSUBSCRIBED status update failed:", error.message);
  await archivePendingTasksForEnrollment(enrollment.id, "Unsubscribed");
  if (enrollment.contact_id) {
    const { error: contactErr } = await svc
      .from("contacts")
      .update({ do_not_contact: true })
      .eq("id", enrollment.contact_id);
    if (contactErr) console.error("campaign-webhooks: do_not_contact flag failed:", contactErr.message);
  }
}

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
  if (!(await verifyOptionalSignature(rawBody, req, campaignRow.webhook_secret))) {
    return json({ error: "unauthorized" }, 401);
  }

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

    if (!normalized.type) {
      return json({ received: true, note: "unrecognized event_type" });
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
        await handleReplied(enrollment, campaign, normalized.replyBody, normalized.email);
        break;
      case "EMAIL_BOUNCED":
        await handleBounced(enrollment);
        break;
      case "EMAIL_UNSUBSCRIBED":
        await handleUnsubscribed(enrollment);
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
