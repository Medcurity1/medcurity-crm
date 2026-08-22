// playbook-smartlead Edge Function — Smartlead read + write path (ported
// from Nexus server.js). Actions:
//   - status        : is Smartlead configured?
//   - email-accounts: list sending inboxes (for the campaign wizard)
//   - import        : pull all Smartlead campaigns -> campaigns
//                     (create new, refresh metrics/status on existing;
//                     preserves user-edited name/notes on update)
//   - sync          : refresh metrics + status on already-imported campaigns
//   - daily-sweep   : one daily run that makes the system correct even with
//                     zero webhooks (Campaigns overhaul Phase 2, S6) — sync +
//                     per-lead reconcile (first-send correction, reply/bounce
//                     detection) + meeting-booked pause + task-spawn
//                     catch-up + webhook self-heal + auto-complete. See its
//                     own doc comment below and
//                     20260722200000_campaigns_daily_sweep_cron.sql.
//   - launch        : create + start a campaign in Smartlead, record it,
//                     enroll every recipient (campaign_enrollments), and —
//                     when starting immediately — spawn the CALL/LINKEDIN/
//                     EMAIL_HYBRID steps as tasks (Campaigns overhaul S3)
//   - delete-campaign: delete in Smartlead + remove the Pulse row
//   - set-campaign-status: start/pause/resume/stop from the tracker (S4) —
//                     mirrors Smartlead's status, and on start-a-draft/stop
//                     also does the local first_send_at backfill + task
//                     spawn, or enrollment/task cancellation, respectively
//
// Campaigns unification (2026-07-22): reads/writes `campaigns`, not the
// retired `playbook_campaigns` (now playbook_campaigns_archived_20260722 —
// see 20260722100000_campaigns_unify.sql).
//
// Enrollment engine (2026-07-22, S3): reads/writes `campaign_enrollments`
// and spawns `activities` tasks off them — see
// 20260722120000_campaigns_enrollment_engine.sql and
// supabase/functions/_shared/campaign-scheduling.ts for the date math.
//
// Auth: admin only (caller JWT). Deploy: supabase functions deploy playbook-smartlead

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  smartleadConfigured,
  smartleadFetch,
  fetchCampaigns,
  fetchCampaignById,
  fetchCampaignAnalytics,
  fetchCampaignSequences,
  fetchEmailAccounts,
  fetchEmailAccountById,
  buildSmartleadMetrics,
  mapSmartleadStatus,
} from "../_shared/smartlead.ts";
import {
  resolveSyncedStatus,
  firstNumber,
  extractDailyLimit,
} from "../_shared/smartlead-sync.ts";
import { planTerminalEnrollmentReconcile } from "../_shared/campaign-terminal-enrollments.ts";
import {
  computeFirstSendDates,
  relativeStepOffsets,
  emailStepsToSmartleadSequence,
  taskDueAt,
} from "../_shared/campaign-scheduling.ts";
import { daysBetweenDateOnly, shiftEnrollmentTasks } from "../_shared/campaign-task-shift.ts";
import { sanitizeReplyCategory } from "../_shared/reply-category.ts";
import {
  ENROLLMENT_TERMINAL_STATUSES,
  archivePendingTasksForEnrollment,
  restoreArchivedTasksForEnrollment,
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
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function callerIsAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await asUser.rpc("is_admin");
  return !error && data === true;
}

/** The caller's user id (for archived_by on tasks cancelled by a Stop
 *  action), or null for a service-role/no-JWT caller — archived_by is
 *  nullable, so a null here just means "system cancelled it" rather than a
 *  named person. Best-effort: never throws. */
async function callerUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader) return null;
  try {
    const asUser = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data } = await asUser.auth.getUser();
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Scheduled invocations (GitHub Actions cron) call this with the
 * service-role key as the bearer (no user JWT), so callerIsAdmin would
 * reject them.
 *
 * This function deploys WITH JWT verification ON (no --no-verify-jwt in
 * CI), so the platform gateway has already cryptographically verified the
 * token's signature before we run — we can therefore trust its `role`
 * claim. We accept ANY valid service_role token by that claim rather than
 * exact-string-matching one specific key: an exact match breaks the moment
 * the project's injected SUPABASE_SERVICE_ROLE_KEY differs from the cron's
 * stored key (key rotation / dual legacy-vs-new keys / stray whitespace in
 * the GH secret) — that mismatch caused the 2026-07-05 email-sync outage.
 * Same pattern as sync-emails/index.ts. SECURITY NOTE: the role-claim
 * shortcut is only safe BECAUSE the gateway verifies the signature; if this
 * is ever redeployed --no-verify-jwt, restore real signature verification.
 */
function isServiceRole(authHeader: string | null): boolean {
  if (!authHeader) return false;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  try {
    const payload = JSON.parse(
      atob(m[1].trim().split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

/** Plain-text campaign notes from a Smartlead sequences response. */
function notesFromSequences(sequences: unknown): string {
  const seqArr = Array.isArray(sequences)
    ? sequences
    : ((sequences as Record<string, unknown>)?.sequences as unknown[]) ??
      ((sequences as Record<string, unknown>)?.data as unknown[]) ??
      [];
  if (!seqArr.length) return "";
  return (seqArr as Record<string, unknown>[])
    .map((seq, i) => {
      let step = `Step ${seq.seq_number ?? i + 1}`;
      if (seq.subject) step += `: ${seq.subject}`;
      if (seq.email_body) {
        const body = String(seq.email_body).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
        if (body) step += `\n${body.substring(0, 500)}`;
      }
      return step;
    })
    .join("\n\n");
}

/** Translate a launched AI-authored sequence (Smartlead-shaped: seq_number,
 *  delay_days = "days after previous") into the SequenceStep jsonb shape
 *  campaigns.steps expects (day_offset = days from campaign start,
 *  cumulative). Every launch gets real step data instead of an empty array.
 *  Only used for the AI-wizard path (no p.steps) — a mixed-channel launch
 *  supplies its own frozen steps array directly (see launch() below). */
function sequenceToSteps(sequence: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  let cumulativeDays = 0;
  return sequence.map((s, i) => {
    cumulativeDays += Number(s.delay_days) || 0;
    return {
      order: Number(s.seq_number) || i + 1,
      day_offset: cumulativeDays,
      channel: "EMAIL_AUTO",
      automation: "AUTO",
      subject_template: String(s.subject ?? ""),
      body_template: String(s.body_html ?? ""),
    };
  });
}

/**
 * Marketing-suppression partition — mirrors
 * src/features/playbook/suppression.ts:partitionSuppression. Deno can't
 * import that browser-side module here, so this is a small hand-kept copy;
 * keep the two in sync if the partition rule changes. Works on plain email
 * strings (the launch action only needs eligible/dropped email sets, not
 * full Recipient objects) — matching is on normalized (lowercased/trimmed)
 * email, same as the client twin and fetchSuppressionForEmails.
 */
function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}
/** Suppression reasons a launch-time "Include anyway" override can never
 *  bypass (outside-review fix 2): a recorded unsubscribe or a manual opt-out
 *  is a legal signal, not a business preference. 'optout_bounced' stays
 *  overridable — re-trying a once-bounced address is a business call. Kept
 *  in sync with NON_OVERRIDABLE_SUPPRESSION_REASONS in
 *  src/features/playbook/suppression.ts (the client twin). */
const NON_OVERRIDABLE_SUPPRESSION_REASONS = new Set(["optout_unsubscribed", "optout_manual"]);

function partitionSuppressedEmails(
  emails: string[],
  suppression: { email: string; reason: string }[],
  overrides: string[],
): { eligible: Set<string>; dropped: string[]; overriddenCount: number } {
  const reasonsByEmail = new Map<string, string[]>();
  for (const r of suppression) {
    const key = normalizeEmail(r.email);
    if (!key) continue;
    const list = reasonsByEmail.get(key);
    if (list) { if (!list.includes(r.reason)) list.push(r.reason); }
    else reasonsByEmail.set(key, [r.reason]);
  }
  const overrideSet = new Set(overrides.map(normalizeEmail));
  const eligible = new Set<string>();
  const dropped: string[] = [];
  let overriddenCount = 0;
  for (const raw of emails) {
    const key = normalizeEmail(raw);
    const reasons = key ? reasonsByEmail.get(key) : undefined;
    if (!key || !reasons) { eligible.add(key); continue; }
    // An override never beats a non-overridable reason — a stale override
    // list (person opted out AFTER the override was checked) fails safe.
    const locked = reasons.some((x) => NON_OVERRIDABLE_SUPPRESSION_REASONS.has(x));
    if (!locked && overrideSet.has(key)) { eligible.add(key); overriddenCount++; }
    else dropped.push(raw);
  }
  return { eligible, dropped, overriddenCount };
}

/** Batched (500/query) service-role suppression lookup — the server-side
 *  twin of fetchSuppressionForEmails (src/features/playbook/api.ts). Uses
 *  `svc` so it sees the full v_marketing_suppression result regardless of
 *  caller RLS (the view is security_invoker, but service_role bypasses RLS
 *  the same way every other `svc.from(...)` call in this file does). */
async function fetchSuppressionForEmails(emails: string[]): Promise<{ email: string; reason: string }[]> {
  const normalized = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
  if (!normalized.length) return [];
  const BATCH = 500;
  // PostgREST caps an un-paged select at 1000 rows SILENTLY, and one email
  // can match several suppression reasons — 500 emails × 2+ reasons would
  // truncate, dropping suppression rows (i.e. emailing Do-Not-Email people).
  // Page each batch to exhaustion, with a stable ORDER BY so LIMIT/OFFSET
  // pages can't skip or duplicate rows (outside-review amendment).
  const PAGE = 1000;
  const out: { email: string; reason: string }[] = [];
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await svc
        .from("v_marketing_suppression")
        .select("email, reason")
        .in("email", batch)
        .order("email", { ascending: true })
        .order("source_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error("Suppression check failed: " + error.message);
      const rows = (data ?? []) as { email: string; reason: string }[];
      for (const row of rows) out.push({ email: row.email, reason: row.reason });
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/** Batched (500/query) lookup of which of these normalized emails are
 *  currently ACTIVELY enrolled in ANY campaign (not just the one being
 *  launched) — the "no-double-enroll" rail (S3). Same shape/batching as
 *  fetchSuppressionForEmails, reading campaign_enrollments instead of
 *  v_marketing_suppression. Uses the partial (email) WHERE status='active'
 *  index from 20260722120000_campaigns_enrollment_engine.sql. */
async function fetchActiveEnrollmentEmails(emails: string[]): Promise<Set<string>> {
  const normalized = Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
  if (!normalized.length) return new Set();
  const BATCH = 500;
  // Same silent-1000-row-cap hazard as fetchSuppressionForEmails above (an
  // email can hold several active enrollments across campaigns) — page each
  // batch to exhaustion with a stable order.
  const PAGE = 1000;
  const out = new Set<string>();
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await svc
        .from("campaign_enrollments")
        .select("email, id")
        .eq("status", "active")
        .in("email", batch)
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error("Enrollment check failed: " + error.message);
      const rows = (data ?? []) as { email: string | null }[];
      for (const row of rows) {
        if (row.email) out.add(normalizeEmail(row.email));
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** {{first_name}}/{{last_name}}/{{company}} merge for a spawned task's
 *  subject/body — mirrors the readable() helper in
 *  src/features/playbook/SequenceTimeline.tsx (kept in sync manually; Deno
 *  can't import that browser-side module). Unlike SequenceTimeline's
 *  read-only PREVIEW version (which substitutes generic phrases like "the
 *  contact" for a template gallery card), this substitutes the real
 *  recipient's data since it's building an actual task. */
function mergeTemplate(tpl: string, vars: {
  first_name: string;
  last_name: string;
  company: string;
  sender_name: string;
  phone: string;
}): string {
  return tpl
    .replace(/\[\[\s*First name\s*\]\]/gi, () => vars.first_name)
    .replace(/\[\[\s*Organization\s*\]\]/gi, () => vars.company)
    .replace(/\[\[\s*Signature\s*\]\]/gi, () => vars.sender_name)
    .replace(/\[\[\s*Work phone\s*\]\]/gi, () => vars.phone)
    .replace(/\{\{\s*first_name\s*\}\}/gi, () => vars.first_name)
    .replace(/\{\{\s*last_name\s*\}\}/gi, () => vars.last_name)
    .replace(/\{\{\s*(?:company|company_name)\s*\}\}/gi, () => vars.company)
    .replace(/\{\{\s*sender_name\s*\}\}/gi, () => vars.sender_name)
    .replace(/\{\{\s*phone\s*\}\}/gi, () => vars.phone);
}

/** Provider-safe personalization generated at launch. Salespeople write with
 * friendly editor tokens; legacy templates may still contain raw merge fields.
 * Both routes land on the same missing-value fallbacks and automatic signature. */
function protectCampaignPersonalization(template: string): string {
  const source = template ?? "";
  const first = "{{#if first_name}}{{first_name}}{{else}}there{{/if}}";
  const company = "{{#if company_name}}{{company_name}}{{else}}your organization{{/if}}";
  const blocks: string[] = [];
  let sentinelPrefix = "__PULSE_LIQUID_BLOCK_";
  while (source.includes(sentinelPrefix)) sentinelPrefix = `_${sentinelPrefix}`;
  const keepBlock = (block: string) => {
    const sentinel = `${sentinelPrefix}${blocks.length}__`;
    blocks.push(block);
    return sentinel;
  };
  return source
    .replace(/\{\{#if\s+(?:first_name|company_name|company)\}\}[\s\S]*?\{\{\/if\}\}/gi, keepBlock)
    .replace(/\[\[\s*First name\s*\]\]/gi, () => keepBlock(first))
    .replace(/\[\[\s*Organization\s*\]\]/gi, () => keepBlock(company))
    .replace(/\[\[\s*Signature\s*\]\]/gi, "%signature%")
    .replace(/\{\{\s*company\s*\}\}/gi, "{{company_name}}")
    .replace(/\{\{\s*sender_name\s*\}\}/gi, "%signature%")
    .replace(/\{\{\s*first_name\s*\}\}/gi, () => keepBlock(first))
    .replace(/\{\{\s*company_name\s*\}\}/gi, () => keepBlock(company))
    .replace(new RegExp(`${sentinelPrefix}(\\d+)__`, "g"), (_match, index) => blocks[Number(index)] ?? "");
}

/**
 * Rep-access foundation (Campaigns overhaul Phase 5) — who's calling, and
 * are they an admin. Threaded into launch()/setCampaignStatus()/
 * setEnrollmentStatus() so each can allow a non-admin to act on ONLY a
 * campaign/enrollment they own. See the ownership checks inside each of
 * those three functions, and 20260723040000_campaigns_rep_access_rls.sql
 * for the read-side counterpart.
 *
 * Rep rollout flip point: this type and the checks that consume it are the
 * backend half of "reps can manage their own campaigns" — there is no UI
 * change in this slice (AdminGate on /playbook + the admin check in
 * ContactsList.tsx still gate the only way a browser reaches this
 * function). When that UI flip happens, these checks need no further
 * change; just confirm the flip's own gates are what actually changed.
 */
interface CallerContext {
  isAdmin: boolean;
  userId: string | null;
  /** Who to record in audit_logs.changed_by — resolved for HUMAN callers
   *  regardless of role (unlike userId, which stays null for admins because
   *  a non-null value triggers the rep ownership checks). Null for the
   *  service-role cron. */
  auditUserId?: string | null;
}

/** Best-effort audit trail for campaign actions (docket I19) — Campaigns
 *  previously wrote nothing to Pulse's audit system, so who launched or
 *  stopped what was unrecorded. Column names match audit_logs' REAL schema
 *  (20260331000000: table_name/record_id/action/changed_by/new_data — NOT
 *  the entity/performed_by names inbound-lead uses, whose inserts have been
 *  silently failing). Never throws and never blocks the action it records. */
async function auditCampaignAction(
  action: string,
  recordId: string,
  changedBy: string | null | undefined,
  newData: Record<string, unknown>,
  tableName = "campaigns",
): Promise<void> {
  try {
    const { error } = await svc.from("audit_logs").insert({
      table_name: tableName,
      record_id: recordId,
      action,
      changed_by: changedBy ?? null,
      // old_data: {} not null — AuditLogViewer's computeChanges bails on a
      // null side and would render every one of these rows as "No field
      // changes"; an empty object makes it list new_data as (empty) → value.
      old_data: {},
      new_data: newData,
    });
    if (error) console.error(`audit_logs insert failed for ${action} (continuing):`, error.message);
  } catch (err) {
    console.error(`audit_logs insert failed for ${action} (continuing):`, (err as Error).message);
  }
}

/** Random 32-byte hex secret for a campaign's webhook registration
 *  (Campaigns overhaul Phase 2, S5) — gates campaign-webhooks' inbound
 *  ?token= query param and, when Smartlead echoes it back, its optional
 *  HMAC signature verification. Generated fresh per launch; never reused
 *  across campaigns. */
function generateWebhookSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Best-effort: register ONE Smartlead webhook covering every event type the
 * campaign-webhooks function reacts to. Returns the Smartlead-assigned
 * webhook id on success, or null on ANY failure (404 — endpoint doesn't
 * exist on this Smartlead plan/tier; 403 — plan limitation; network error;
 * unexpected response shape). A launch must succeed whether or not webhooks
 * are available — the future daily reconciliation sweep (not built in this
 * slice) is the fallback for accounts without webhook support.
 *
 * Endpoint shape (unverified beyond "matches the /campaigns/{id}/<noun>
 * pattern every other Smartlead call in this file already uses" — e.g.
 * /campaigns/{id}/sequences, /campaigns/{id}/schedule,
 * /campaigns/{id}/email-accounts, /campaigns/{id}/status): POST
 * /campaigns/{id}/webhooks with {name, webhook_url, event_types}. If this
 * 404s against the real API (Smartlead's webhook API may require a Pro
 * plan, or use a different path), registerCampaignWebhook simply returns
 * null and launch() proceeds webhook-less — verify against a real account
 * post-deploy via the `webhook-status` diagnostic action below.
 */
// Smartlead's ACTUAL registration enum (verified live 2026-07-22 via the
// webhook-register diagnostic + api.smartlead.ai/api-reference/webhooks/events
// — the API rejected our first guess with `Invalid event_types - EMAIL_OPENED`):
// opens are EMAIL_OPEN, clicks EMAIL_LINK_CLICK, replies EMAIL_REPLY, bounces
// EMAIL_BOUNCE, unsubscribes LEAD_UNSUBSCRIBED. The receiving side
// (_shared/webhook-normalize.ts) maps by substring patterns, so these inbound
// names already canonicalize correctly (EMAIL_REPLY -> EMAIL_REPLIED, etc.).
// NOT adding LEAD_CATEGORY_UPDATED here (Phase 3, S9's category feature):
// this array is the live-verified registration enum — the API 400s on an
// unrecognized value (see the EMAIL_OPENED note above), and registration is
// ALL-OR-NOTHING per campaign (one bad value fails the whole call, dropping
// the already-working reply/bounce webhook too). Whether Smartlead sends
// LEAD_CATEGORY_UPDATED unprompted, or under a different subscribable name,
// is unverified — campaign-webhooks/index.ts's isLeadCategoryUpdateEvent
// parses one IF it arrives, but nothing here risks the existing
// registration to ask for it. The daily sweep's per-lead statistics parse
// (reconcileCampaignLeads) is the primary, always-on path for category data
// either way.
const SMARTLEAD_WEBHOOK_EVENT_TYPES = [
  "EMAIL_SENT",
  "EMAIL_OPEN",
  "EMAIL_LINK_CLICK",
  "EMAIL_REPLY",
  "EMAIL_BOUNCE",
  "LEAD_UNSUBSCRIBED",
];

/** The ONE registration routine (adversarial review — the old single-
 *  variant POST here is the exact shape documented as having failed the
 *  first live test; webhook-register's 3-variant loop is what actually
 *  worked). Tries each payload variant until one yields a usable id.
 *  Returns the id plus per-attempt outcomes (webhook-register's diagnostic
 *  response); launch and the sweep read just the id. */
async function registerCampaignWebhookVariants(
  smartleadCampaignId: number,
  secret: string,
): Promise<{ id: number | null; attempts: Array<Record<string, unknown>> }> {
  const webhookUrl = `${SUPABASE_URL}/functions/v1/campaign-webhooks?token=${secret}`;
  const base = { name: "Pulse campaign events", webhook_url: webhookUrl, event_types: SMARTLEAD_WEBHOOK_EVENT_TYPES };
  const variants: Array<Record<string, unknown>> = [
    { id: null, ...base },
    { id: null, ...base, categories: [] },
    { ...base },
  ];
  const attempts: Array<Record<string, unknown>> = [];
  for (const payload of variants) {
    try {
      const res = (await smartleadFetch(`/campaigns/${smartleadCampaignId}/webhooks`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      })) as Record<string, unknown>;
      attempts.push({ payload_keys: Object.keys(payload), ok: true, response: res });
      const rawId = res?.id ?? res?.webhook_id ?? (res?.data as Record<string, unknown> | undefined)?.id;
      if (typeof rawId === "number") return { id: rawId, attempts };
      if (typeof rawId === "string" && /^\d+$/.test(rawId)) return { id: Number(rawId), attempts };
    } catch (err) {
      attempts.push({ ok: false, error: (err as Error).message });
    }
  }
  console.warn(`webhook registration: no variant yielded a usable id for smartlead campaign ${smartleadCampaignId}`);
  return { id: null, attempts };
}

async function registerCampaignWebhook(smartleadCampaignId: number, secret: string): Promise<number | null> {
  const { id } = await registerCampaignWebhookVariants(smartleadCampaignId, secret);
  return id;
}

/** Find an ALREADY-registered Pulse webhook on this Smartlead campaign (by
 *  our function URL) — the sweep adopts it instead of blindly POSTing a
 *  duplicate every night when our row lost/never had the id (adversarial
 *  review). Returns the id + the token parsed from its URL, or null. */
async function findExistingPulseWebhook(
  smartleadCampaignId: number,
): Promise<{ id: number; token: string | null } | null> {
  try {
    const res = await smartleadFetch(`/campaigns/${smartleadCampaignId}/webhooks`);
    const rows = extractWebhookRows(res);
    if (!rows || !rows.length) return null;
    for (const w of rows) {
      const url = typeof w.webhook_url === "string" ? w.webhook_url : null;
      if (!url || !url.startsWith(`${SUPABASE_URL}/functions/v1/campaign-webhooks`)) continue;
      const rawId = w.id ?? w.webhook_id;
      const id = typeof rawId === "number" ? rawId : (typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : null);
      if (id == null) continue;
      const token = /[?&]token=([^&]+)/.exec(url)?.[1] ?? null;
      return { id, token };
    }
    return null;
  } catch {
    return null;
  }
}

/** Fallback task title when a step's manual_task_title_template is blank
 *  (SequenceEditor doesn't require one) — keeps every spawned task usable
 *  even for a hand-built sequence with no task copy written yet. */
function defaultTaskTitle(channel: string): string {
  if (channel === "CALL") return "Call {{first_name}}";
  if (channel === "LINKEDIN") return "LinkedIn — {{first_name}}";
  return "Review & send to {{first_name}}"; // EMAIL_HYBRID
}

/** The subset of SequenceStep (src/features/playbook/types.ts) this file
 *  reads. Deno can't import across the "@/" alias into src/, so this is a
 *  structurally-compatible local mirror (kept in sync manually) — a
 *  superset of campaign-scheduling.ts's SchedulingStep, so values typed as
 *  CampaignStep pass straight into computeFirstSendDates/relativeStepOffsets/
 *  emailStepsToSmartleadSequence with no cast needed. */
interface CampaignStep {
  order: number;
  day_offset: number;
  channel: "EMAIL_AUTO" | "EMAIL_HYBRID" | "CALL" | "LINKEDIN";
  send_window_start?: string;
  subject_template?: string;
  body_template?: string;
  manual_task_title_template?: string;
  manual_task_priority?: string;
  task_note_template?: string;
}

// resolveSyncedStatus (terminal-status regression guard) lives in
// _shared/smartlead-sync.ts (extracted 2026-07-31, docket I38, so
// tests/smartleadSyncStatus.test.ts can import it) — imported at top.

async function importCampaigns(deadline?: number) {
  const campaigns = await fetchCampaigns();
  if (!Array.isArray(campaigns)) throw new Error("Unexpected Smartlead response");
  let created = 0;
  let updated = 0;
  let capped = 0;
  const processedIds: number[] = [];
  const rows = campaigns as Record<string, unknown>[];
  for (let index = 0; index < rows.length; index++) {
    if (deadline != null && Date.now() > deadline) {
      capped = rows.length - index;
      break;
    }
    const camp = rows[index];
    const campId = camp.id as number;
    const { data: existing } = await svc
      .from("campaigns")
      .select("id, status, metrics")
      .eq("smartlead_campaign_id", campId)
      .maybeSingle();

    let analytics: Record<string, unknown> = {};
    let sequences: unknown = [];
    try { analytics = (await fetchCampaignAnalytics(campId)) as Record<string, unknown>; } catch { /* ignore */ }
    if (deadline != null && Date.now() > deadline) {
      capped = rows.length - index;
      break;
    }
    // Existing Pulse rows already carry their frozen sequence/notes. Only a
    // brand-new Smartlead campaign needs the sequence download for import;
    // fetching it for every known row doubled ordinary Sync latency.
    if (!existing) {
      try { sequences = await fetchCampaignSequences(campId); } catch { /* ignore */ }
    }

    const metrics = buildSmartleadMetrics(analytics);
    const notes = notesFromSequences(sequences);
    const mappedStatus = mapSmartleadStatus(camp.status as string);

    if (existing) {
      const merged = { ...(existing.metrics ?? {}), ...metrics };
      // Mirror Smartlead's status directly (bidirectional — Smartlead is
      // the source of truth for a linked campaign's send state, including
      // pause/resume, not just forward lifecycle progress) — but never
      // regress a Pulse-terminal status on an unrecognized/backward value;
      // see resolveSyncedStatus above. Freshness goes through the merge RPC
      // so a concurrent settings write cannot drop last_metrics_sync_at.
      const status = resolveSyncedStatus(existing.status as string, mappedStatus);
      const { error: applyErr } = await svc.rpc("campaign_sync_apply", {
        p_campaign_id: existing.id,
        p_metrics: merged,
        p_status: status,
        p_settings_patch: { last_metrics_sync_at: new Date().toISOString() },
      });
      if (applyErr) throw new Error(applyErr.message);
      updated++;
      processedIds.push(campId);
    } else {
      // Brand-new row: no prior status to preserve, and the status column
      // is NOT NULL — fall back to "draft" (the column's own default) if
      // Smartlead's status didn't map to anything recognized.
      await svc.from("campaigns").insert({
        name: (camp.name as string) || "Smartlead Campaign " + campId,
        origin: "smartlead_import",
        status: mappedStatus ?? "draft",
        smartlead_campaign_id: campId,
        notes,
        metrics,
        steps: [],
      });
      created++;
      processedIds.push(campId);
    }
  }
  return { created, updated, total: campaigns.length, capped, processedIds };
}

/** `deadline` (epoch ms, optional) caps how long the loop may run — the
 *  daily sweep passes a per-step budget so a slow Smartlead day can't eat
 *  the whole run and starve steps 2-7 (docket I8); the interactive Sync
 *  button passes none. Campaigns not reached before the deadline are
 *  reported in `capped` and simply wait for the next sync/sweep. Paged
 *  reads (docket I9) so the campaign list can outgrow the 1000-row cap. */
async function syncCampaigns(deadline?: number, reconcileTerminal = true, skipSmartleadIds = new Set<number>()) {
  const existing = await fetchAllRows<Record<string, unknown>>((from, to) =>
    svc
      .from("campaigns")
      .select("id, smartlead_campaign_id, status, metrics, settings")
      .not("smartlead_campaign_id", "is", null)
      .order("id", { ascending: true })
      .range(from, to));
  let synced = 0;
  let attempted = 0;
  let failed = 0;
  let capped = 0;
  const rows = existing ?? [];
  for (let idx = 0; idx < rows.length; idx++) {
    const c = rows[idx];
    if (skipSmartleadIds.has(Number(c.smartlead_campaign_id))) continue;
    if (deadline != null && Date.now() > deadline) {
      // Unprocessed = rows not yet REACHED — errored ones were attempted
      // and must not inflate the starvation signal (adversarial review).
      capped = rows.length - idx;
      break;
    }
    try {
      attempted++;
      const camp = (await fetchCampaignById(c.smartlead_campaign_id)) as Record<string, unknown>;
      if (deadline != null && Date.now() > deadline) {
        capped = rows.length - idx;
        break;
      }
      const analytics = (await fetchCampaignAnalytics(c.smartlead_campaign_id)) as Record<string, unknown>;
      const metrics = buildSmartleadMetrics(analytics);
      const merged = { ...(c.metrics ?? {}), ...metrics };
      const mappedStatus = mapSmartleadStatus(camp.status as string);
      // No-regress rule: never let a sync pass move an already-terminal
      // (stopped/completed) Pulse campaign back to draft/active, and never
      // apply a null (unrecognized Smartlead status) mapping — see
      // resolveSyncedStatus / mapSmartleadStatus's doc comments.
      const status = resolveSyncedStatus(c.status as string, mappedStatus);
      // last_metrics_sync_at = "the numbers on the card are this fresh" —
      // stamped for EVERY linked campaign on every sync/sweep, unlike
      // last_sweep_at (the per-lead reconcile's rotation cursor, capped at
      // 25 campaigns/run). The tracker's stale-numbers chip reads this
      // (needs-attention.ts, outside-review I27). Settings goes through the
      // server-side merge RPC (docket I36) — a read → spread → full-column
      // write here could drop a key another writer (the sweep's
      // last_sweep_at, a launch's suppression snapshot) landed in between.
      const { error: applyErr } = await svc.rpc("campaign_sync_apply", {
        p_campaign_id: c.id,
        p_metrics: merged,
        p_status: status,
        p_settings_patch: { last_metrics_sync_at: new Date().toISOString() },
      });
      if (applyErr) throw new Error(applyErr.message);
      synced++;
    } catch (error) {
      failed++;
      console.error(`sync: campaign ${c.smartlead_campaign_id} failed:`, (error as Error).message);
    }
  }
  // Interactive Sync also closes stale active enrollments on
  // campaigns that are already stopped/completed in Pulse. The daily sweep
  // still owns this as step 6 so a budget-capped sync cannot skip the
  // nightly catch-up.
  const reconciled = reconcileTerminal
    ? await reconcileTerminalEnrollments(deadline)
    : { enrollments_updated: 0, enrollments_deferred: 0, tasks_cancelled: 0, capped: 0 };
  return {
    synced,
    attempted,
    failed,
    capped: capped + reconciled.capped,
    enrollments_updated: reconciled.enrollments_updated,
    enrollments_deferred: reconciled.enrollments_deferred,
    tasks_cancelled: reconciled.tasks_cancelled,
  };
}

async function refreshSmartlead() {
  const deadline = Date.now() + 35_000;
  const imported = await importCampaigns(deadline);
  const synced = await syncCampaigns(deadline, true, new Set(imported.processedIds));
  return {
    created: imported.created,
    updated: imported.updated,
    total: imported.total,
    synced: synced.synced,
    attempted: synced.attempted,
    failed: synced.failed,
    capped: (imported.capped ?? 0) + (synced.capped ?? 0),
    enrollments_updated: synced.enrollments_updated ?? 0,
    enrollments_deferred: synced.enrollments_deferred ?? 0,
    tasks_cancelled: synced.tasks_cancelled ?? 0,
  };
}

/** Close active enrollments whose parent campaign is already stopped or
 *  completed. Matches daily-sweep step 6: stopped campaigns flip and
 *  archive pending tasks; completed campaigns only flip enrollments whose
 *  call/LinkedIn tasks are done. Never writes unsubscribe/bounce/replied
 *  rows — those are already terminal and excluded by the active filter. */
async function reconcileTerminalEnrollments(deadline?: number): Promise<{
  enrollments_updated: number;
  enrollments_deferred: number;
  tasks_cancelled: number;
  capped: number;
}> {
  let enrollments_updated = 0;
  let enrollments_deferred = 0;
  let tasks_cancelled = 0;
  let capped = 0;
  if (deadline != null && Date.now() > deadline) {
    return { enrollments_updated, enrollments_deferred, tasks_cancelled, capped: 1 };
  }
  const doneCampaigns = await fetchAllRows<{ id: string; status: string }>((from, to) =>
    svc
      .from("campaigns")
      .select("id, status")
      .in("status", ["completed", "stopped"])
      .neq("origin", "legacy")
      .order("id", { ascending: true })
      .range(from, to));
  const rows = (doneCampaigns ?? []) as { id: string; status: string }[];
  for (let idx = 0; idx < rows.length; idx++) {
    const c = rows[idx];
    if (deadline != null && Date.now() > deadline) {
      capped = rows.length - idx;
      break;
    }
    let stragglers: { id: string }[];
    try {
      stragglers = await fetchAllRows<{ id: string }>((from, to) =>
        svc
          .from("campaign_enrollments")
          .select("id")
          .eq("campaign_id", c.id)
          .eq("status", "active")
          .order("id", { ascending: true })
          .range(from, to));
    } catch (findErr) {
      console.error(`reconcile-terminal: straggler lookup failed for campaign ${c.id}:`, (findErr as Error).message);
      continue;
    }
    const ids = stragglers.map((e) => e.id);
    if (!ids.length) continue;

    const withPending = new Set<string>();
    if (c.status === "completed") {
      const PENDING_BATCH = 500;
      let pendingLookupFailed = false;
      for (let i = 0; i < ids.length; i += PENDING_BATCH) {
        const idBatch = ids.slice(i, i + PENDING_BATCH);
        const { data: pendingRows, error: pendErr } = await svc
          .from("activities")
          .select("campaign_enrollment_id")
          .in("campaign_enrollment_id", idBatch)
          .eq("is_campaign_generated", true)
          .is("completed_at", null)
          .is("archived_at", null);
        if (pendErr) {
          console.error(`reconcile-terminal: pending-task check failed for campaign ${c.id}:`, pendErr.message);
          pendingLookupFailed = true;
          break;
        }
        for (const row of (pendingRows ?? []) as { campaign_enrollment_id: string }[]) {
          withPending.add(row.campaign_enrollment_id);
        }
      }
      if (pendingLookupFailed) {
        enrollments_deferred += ids.length;
        continue;
      }
    }

    const plan = planTerminalEnrollmentReconcile({
      parentStatus: c.status,
      activeEnrollmentIds: ids,
      pendingTaskEnrollmentIds: withPending,
    });
    enrollments_deferred += plan.deferredIds.length;
    if (!plan.flipIds.length) continue;

    const { error: updErr } = await svc.from("campaign_enrollments").update({ status: "completed" }).in("id", plan.flipIds);
    if (updErr) {
      console.error(`reconcile-terminal: update failed for campaign ${c.id}:`, updErr.message);
      continue;
    }
    enrollments_updated += plan.flipIds.length;
    for (const id of plan.archiveTaskIds) {
      tasks_cancelled += await archivePendingTasksForEnrollment(svc, id, "Campaign stopped");
    }
  }
  return { enrollments_updated, enrollments_deferred, tasks_cancelled, capped };
}

/** Page a PostgREST select to exhaustion — a plain select silently caps at
 *  1000 rows (docket I9; meddy-sweep pages around the same cap). The
 *  factory must include a stable .order() so range windows can't skip or
 *  duplicate rows; every caller here orders by id. */
async function fetchAllRows<T>(
  make: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < pageSize) break;
  }
  return out;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

interface Recipient {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  contact_id?: string;
  account_id?: string;
}
interface LaunchInput {
  campaign_name: string;
  target_audience?: string;
  // AI-wizard path: a flat list of emails (seq_number/delay_days/subject/
  // body_html). Required unless `steps` is present.
  sequence?: Array<Record<string, unknown>>;
  // Mixed-channel path (template gallery / SequenceEditor "Launch this
  // sequence"): the FULL frozen step array — EMAIL_AUTO steps drive the
  // Smartlead sequence (via emailStepsToSmartleadSequence); every other
  // channel becomes a task at launch. When present this is the source of
  // truth and `sequence` is ignored entirely (S3).
  steps?: CampaignStep[];
  template_id?: string;
  // ISO "YYYY-MM-DD". Defaults to today — the anchor every enrollment's
  // throttle math (computeFirstSendDates) is computed from.
  anchor_date?: string;
  recipients: Recipient[];
  schedule?: Record<string, unknown>;
  email_account_id?: number;
  source_idea_id?: string;
  autoStart?: boolean;
  adaptiveEnabled?: boolean;
  owner_id?: string;
  authoring_method?: "ai" | "write_own" | "template";
  // Normalized emails the caller deliberately included despite being on the
  // Do-Not-Email list (per-person "Include anyway" in CampaignRecipients.tsx).
  // The client's own filtering is not trusted — see the suppression re-check
  // in launch() below.
  suppression_overrides?: string[];
  // Normalized emails the caller deliberately double-enrolled despite
  // already being actively enrolled in another campaign (per-person "Enroll
  // anyway" in CampaignRecipients.tsx, S3).
  enrollment_overrides?: string[];
}

interface AddRecipientsInput {
  campaign_id: string;
  recipients: Recipient[];
  suppression_overrides?: string[];
  enrollment_overrides?: string[];
}

/** Add people to an existing Pulse-owned Smartlead campaign without creating
 * another campaign. This deliberately reuses the launch rails (suppression,
 * global active-enrollment check, launch claims, Smartlead upload,
 * first-send scheduling and idempotent task spawning). Local enrollment is
 * written only for addresses Smartlead accepted. If the local write fails,
 * every uploaded lead is removed from Smartlead; rollback residue is named
 * explicitly rather than returning a false success. */
async function addRecipientsToExistingCampaign(p: AddRecipientsInput, callerCtx: CallerContext) {
  if (!p.campaign_id || !Array.isArray(p.recipients) || !p.recipients.length) {
    throw new Error("campaign_id and recipients are required");
  }
  if (p.recipients.length > 10_000) throw new Error("Add at most 10,000 recipients at a time.");

  const { data: campaign, error: campaignErr } = await svc
    .from("campaigns")
    .select("id, name, owner_user_id, smartlead_campaign_id, status, anchor_date, leads_per_day, settings")
    .eq("id", p.campaign_id)
    .maybeSingle();
  if (campaignErr) throw new Error("Couldn't load campaign: " + campaignErr.message);
  if (!campaign) throw new Error("Campaign not found.");
  if (!callerCtx.isAdmin && (!callerCtx.userId || campaign.owner_user_id !== callerCtx.userId)) {
    throw new Error("You can only add people to campaigns you own.");
  }
  if (campaign.status !== "active" && campaign.status !== "draft") {
    throw new Error("People can only be added to a draft or active campaign.");
  }
  const smartleadCampaignId = Number(campaign.smartlead_campaign_id);
  if (!Number.isInteger(smartleadCampaignId) || smartleadCampaignId <= 0) {
    throw new Error("This campaign is not connected to Smartlead.");
  }

  // Deterministic input dedupe: same contact OR same normalized email is one
  // person. Invalid/blank addresses are excluded before any external write.
  const seenEmails = new Set<string>();
  const seenContacts = new Set<string>();
  const unique: Recipient[] = [];
  let duplicates_dropped = 0;
  let invalid_dropped = 0;
  for (const recipient of p.recipients) {
    const email = normalizeEmail(recipient.email);
    if (!email || !email.includes("@")) { invalid_dropped++; continue; }
    if (seenEmails.has(email) || (!!recipient.contact_id && seenContacts.has(recipient.contact_id))) {
      duplicates_dropped++;
      continue;
    }
    seenEmails.add(email);
    if (recipient.contact_id) seenContacts.add(recipient.contact_id);
    unique.push({ ...recipient, email });
  }
  if (!unique.length) throw new Error("No valid, unique email addresses were provided.");

  const suppression = await fetchSuppressionForEmails(unique.map((r) => r.email));
  const suppressionOverrides = Array.isArray(p.suppression_overrides) ? p.suppression_overrides : [];
  const partition = partitionSuppressedEmails(unique.map((r) => r.email), suppression, suppressionOverrides);
  const afterSuppression = unique.filter((r) => partition.eligible.has(r.email));
  const suppression_dropped = unique.length - afterSuppression.length;
  if (!afterSuppression.length) throw new Error("Every recipient is on the Do-Not-Email list.");

  // Same-campaign duplicates are never overridable. Global active enrollment
  // in another campaign remains an explicit user override, matching launch.
  const sameCampaign = new Set<string>();
  for (let offset = 0; offset < afterSuppression.length; offset += 500) {
    const emailBatch = afterSuppression.slice(offset, offset + 500).map((r) => r.email);
    const { data: sameCampaignRows, error: sameErr } = await svc
      .from("campaign_enrollments")
      .select("email")
      .eq("campaign_id", campaign.id)
      .in("email", emailBatch);
    if (sameErr) throw new Error("Couldn't check existing campaign members: " + sameErr.message);
    for (const row of sameCampaignRows ?? []) sameCampaign.add(normalizeEmail(row.email as string));
  }
  const notAlreadyHere = afterSuppression.filter((r) => !sameCampaign.has(r.email));
  const already_in_campaign_dropped = afterSuppression.length - notAlreadyHere.length;
  if (!notAlreadyHere.length) throw new Error("Everyone selected is already in this campaign.");

  const overrides = new Set((p.enrollment_overrides ?? []).map(normalizeEmail));
  const activeElsewhere = await fetchActiveEnrollmentEmails(notAlreadyHere.map((r) => r.email));
  const enrollable = notAlreadyHere.filter((r) => !activeElsewhere.has(r.email) || overrides.has(r.email));
  const active_elsewhere_dropped = notAlreadyHere.length - enrollable.length;
  if (!enrollable.length) throw new Error("Everyone selected is already active in another campaign.");

  const claimEmails = enrollable.map((r) => r.email);
  const { data: conflictRows, error: claimErr } = await svc.rpc("campaign_launch_claim_emails", { p_emails: claimEmails });
  if (claimErr) throw new Error("Couldn't reserve recipients: " + claimErr.message);
  const conflicts = new Set((conflictRows ?? []) as string[]);
  const claimed = claimEmails.filter((email) => !conflicts.has(email));
  const ready = enrollable.filter((r) => !conflicts.has(r.email));
  const concurrent_dropped = enrollable.length - ready.length;
  if (!ready.length) throw new Error("Every recipient is being added by another launch right now. Try again shortly.");

  const uploaded: Recipient[] = [];
  const failed_emails: string[] = [];
  const insertedIds: string[] = [];
  let smartlead_rollback_failed = 0;
  let local_rollback_failed = false;
  try {
    for (let offset = 0; offset < ready.length; offset += 400) {
      const batch = ready.slice(offset, offset + 400);
      const leads = batch.map((r) => ({
        email: r.email, first_name: r.first_name ?? "", last_name: r.last_name ?? "", company_name: r.company_name ?? "",
      }));
      let accepted = false;
      for (let attempt = 0; attempt < 2 && !accepted; attempt++) {
        try {
          await smartleadFetch(`/campaigns/${smartleadCampaignId}/leads`, {
            method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ lead_list: leads }),
          });
          accepted = true;
        } catch {
          if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (accepted) uploaded.push(...batch);
      else failed_emails.push(...batch.map((r) => r.email));
    }
    if (!uploaded.length) throw new Error("Smartlead did not accept any recipients.");

    const rows = uploaded.map((r) => ({
      contact_id: r.contact_id ?? null,
      account_id: r.account_id ?? null,
      owner_user_id: campaign.owner_user_id,
      email: r.email,
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      company: r.company_name ?? "",
      status: "active",
      current_step: 0,
      first_send_at: null,
    }));
    const { data: inserted, error: insertErr } = await svc.rpc("campaign_enrollments_append", {
      p_campaign_id: campaign.id,
      p_rows: rows,
    });
    if (insertErr) throw new Error("Enrollment insert failed: " + insertErr.message);
    insertedIds.push(...((inserted ?? []) as { id: string }[]).map((row) => row.id));

    let tasks_created = 0;
    if (campaign.status === "active") {
      const { data: allEnrollments, error: allErr } = await svc
        .from("campaign_enrollments")
        .select("id, enroll_position, first_send_at")
        .eq("campaign_id", campaign.id)
        .order("enroll_position", { ascending: true });
      if (allErr) throw new Error("Couldn't schedule new enrollments: " + allErr.message);
      const settings = (campaign.settings ?? {}) as Record<string, unknown>;
      const delivery = (settings.delivery ?? settings.schedule ?? {}) as Record<string, unknown>;
      const days = Array.isArray(delivery.days_of_week) ? delivery.days_of_week as number[] : [1, 2, 3, 4, 5];
      await backfillFirstSendDates(
        (allEnrollments ?? []) as { id: string; enroll_position: number; first_send_at?: string | null }[],
        (campaign.anchor_date as string | null) ?? todayISODate(),
        Number(campaign.leads_per_day) || 20,
        days,
      );
      tasks_created = (await spawnCampaignTasks(campaign.id)).tasksCreated;
    }

    // Enrollment is not delivery. Do not manufacture a sent-email CRM
    // activity here, especially for draft campaigns; authoritative webhook
    // events create delivery history only after Smartlead actually sends.
    try {
      await auditCampaignAction("campaign_recipients_added", campaign.id, callerCtx.auditUserId, {
        requested: p.recipients.length, enrolled: insertedIds.length, smartlead_failed: failed_emails.length,
      });
    } catch (auditErr) {
      // Auditing is observability, not part of the cross-system transaction.
      // Never unwind already-scheduled enrollments solely because it failed.
      console.error("add-recipients: audit logging failed:", (auditErr as Error).message);
    }
    return {
      success: true,
      requested: p.recipients.length,
      enrolled: insertedIds.length,
      suppression_dropped,
      active_elsewhere_dropped,
      already_in_campaign_dropped,
      duplicates_dropped,
      invalid_dropped,
      concurrent_dropped,
      smartlead_failed: failed_emails.length,
      failed_emails: failed_emails.slice(0, 200),
      tasks_created,
    };
  } catch (error) {
    // If local rows landed but later scheduling failed, remove those rows
    // before removing Smartlead leads so a retry cannot duplicate either side.
    if (insertedIds.length) {
      const { error: localDeleteErr } = await svc.from("campaign_enrollments").delete().in("id", insertedIds);
      local_rollback_failed = !!localDeleteErr;
    }
    for (const recipient of uploaded) {
      try {
        const leadId = await resolveSmartleadLeadId(smartleadCampaignId, recipient.email);
        if (leadId == null) { smartlead_rollback_failed++; continue; }
        await smartleadFetch(`/campaigns/${smartleadCampaignId}/leads/${leadId}`, { method: "DELETE" });
      } catch { smartlead_rollback_failed++; }
    }
    if (local_rollback_failed || smartlead_rollback_failed) {
      const residue = [
        local_rollback_failed ? "local enrollment rows" : "",
        smartlead_rollback_failed ? `${smartlead_rollback_failed} Smartlead lead(s)` : "",
      ].filter(Boolean).join(" and ");
      throw new Error(`${(error as Error).message} Rollback could not remove ${residue}; review the campaign before retrying.`);
    }
    throw error;
  } finally {
    if (claimed.length) {
      try { await svc.rpc("campaign_launch_release_emails", { p_emails: claimed }); } catch { /* TTL backstop */ }
    }
  }
}

/**
 * For every ACTIVE enrollment on this campaign that hasn't had its tasks
 * spawned yet (tasks_spawned_at is null) and has a known first_send_at,
 * create an `activities` task for every non-EMAIL_AUTO step (CALL, LINKEDIN,
 * EMAIL_HYBRID — the steps a rep does by hand; EMAIL_AUTO sends through
 * Smartlead and never becomes a task).
 *
 * Idempotent: pre-checks which (enrollment, step) pairs already have a task
 * before inserting, rather than relying on the partial unique index
 * (uq_activities_campaign_enrollment_step, 20260722120000) via an upsert's
 * ON CONFLICT — the Supabase JS client's upsert({onConflict}) param is a
 * bare column list and can't target a PARTIAL index (Postgres requires the
 * ON CONFLICT target's predicate to match the index's predicate exactly),
 * so this does the equivalent check-then-insert in application code
 * instead. The DB index is still real protection if anything else ever
 * writes here directly.
 *
 * Chunks are built PER-ENROLLMENT (never splitting one enrollment's task set
 * across a chunk boundary), so after a chunk insert we know precisely which
 * enrollments are now fully covered and mark tasks_spawned_at only for
 * those — an enrollment caught in a failed chunk keeps tasks_spawned_at =
 * null and is simply picked up again the next time this runs.
 */
async function spawnCampaignTasks(campaignId: string): Promise<{ tasksCreated: number }> {
  const { data: campaign, error: campErr } = await svc
    .from("campaigns")
    .select("id, owner_user_id, steps")
    .eq("id", campaignId)
    .single();
  if (campErr || !campaign) {
    console.error("spawnCampaignTasks: couldn't load campaign:", campErr?.message);
    return { tasksCreated: 0 };
  }

  const steps = (campaign.steps ?? []) as CampaignStep[];
  const nonEmailSteps = steps.filter((s) => s.channel !== "EMAIL_AUTO");
  if (!nonEmailSteps.length) return { tasksCreated: 0 };
  const offsets = relativeStepOffsets(steps);

  const { data: enrollments, error: enrErr } = await svc
    .from("campaign_enrollments")
    .select("id, first_name, last_name, company, email, first_send_at, owner_user_id")
    .eq("campaign_id", campaignId)
    .eq("status", "active")
    .is("tasks_spawned_at", null)
    .not("first_send_at", "is", null);
  if (enrErr) {
    console.error("spawnCampaignTasks: couldn't load enrollments:", enrErr.message);
    return { tasksCreated: 0 };
  }
  if (!enrollments?.length) return { tasksCreated: 0 };

  const taskOwnerIds = Array.from(new Set(enrollments.map((e) =>
    (e.owner_user_id as string | null) ?? (campaign.owner_user_id as string | null),
  ).filter((id): id is string => !!id)));
  const ownerProfiles = new Map<string, { full_name: string; outreach_phone: string }>();
  if (taskOwnerIds.length) {
    const { data: profiles, error: profileErr } = await svc
      .from("user_profiles")
      .select("id, full_name, outreach_phone")
      .in("id", taskOwnerIds);
    if (profileErr) {
      console.error("spawnCampaignTasks: couldn't load outreach profiles:", profileErr.message);
    } else {
      for (const profile of profiles ?? []) {
        ownerProfiles.set(profile.id as string, {
          full_name: (profile.full_name as string | null) || "Your campaign owner",
          outreach_phone: (profile.outreach_phone as string | null) || "[add your work phone in My Settings]",
        });
      }
    }
  }

  // Pre-check: which (enrollment, step) pairs already have a spawned task —
  // covers a retry after a previous partial failure without duplicating.
  const enrollmentIds = enrollments.map((e) => e.id as string);
  const existingPairs = new Set<string>();
  const CHECK_BATCH = 500;
  for (let i = 0; i < enrollmentIds.length; i += CHECK_BATCH) {
    const idBatch = enrollmentIds.slice(i, i + CHECK_BATCH);
    const { data: existing, error: exErr } = await svc
      .from("activities")
      .select("campaign_enrollment_id, campaign_step_number")
      .in("campaign_enrollment_id", idBatch);
    if (exErr) {
      console.error("spawnCampaignTasks: existing-task check failed (continuing; DB unique index still guards against dupes):", exErr.message);
      continue;
    }
    for (const row of (existing ?? []) as { campaign_enrollment_id: string; campaign_step_number: number | null }[]) {
      if (row.campaign_step_number != null) {
        existingPairs.add(`${row.campaign_enrollment_id}:${row.campaign_step_number}`);
      }
    }
  }

  // Build one row-group per enrollment (only the steps it's still missing).
  const rowsByEnrollment = new Map<string, Record<string, unknown>[]>();
  for (const e of enrollments) {
    const taskOwnerId = (e.owner_user_id as string | null) ?? (campaign.owner_user_id as string | null);
    const ownerProfile = taskOwnerId ? ownerProfiles.get(taskOwnerId) : undefined;
    const vars = {
      // A blank first name reads as "Call " (trailing space, no name at
      // all) in a spawned task title — fall back to the email address so
      // the task is always identifiable ("Call jane@clinic.org").
      first_name: (e.first_name as string) || (e.email as string) || "",
      last_name: (e.last_name as string) || "",
      company: (e.company as string) || "their organization",
      sender_name: ownerProfile?.full_name || "Your campaign owner",
      phone: ownerProfile?.outreach_phone || "[add your work phone in My Settings]",
    };
    const rows: Record<string, unknown>[] = [];
    for (const step of nonEmailSteps) {
      if (existingPairs.has(`${e.id}:${step.order}`)) continue;
      const relOffset = offsets.get(step.order) ?? 0;
      const dueAt = taskDueAt(e.first_send_at as string, relOffset, step.send_window_start);
      const note = mergeTemplate(step.task_note_template || "", vars);
      rows.push({
        activity_type: "task",
        // Owner routing (outside-review group 2): the person's own owner
        // does their calls/LinkedIn touches; the campaign owner only covers
        // enrollments without one (CSV/paste people, unowned contacts).
        owner_user_id: taskOwnerId,
        subject: mergeTemplate(step.manual_task_title_template || defaultTaskTitle(step.channel), vars),
        body: note || null,
        due_at: dueAt,
        priority: step.manual_task_priority || "normal",
        reminder_schedule: "once",
        reminder_at: dueAt,
        reminder_channels: ["in_app", "email"],
        campaign_enrollment_id: e.id,
        campaign_step_number: step.order,
        is_campaign_generated: true,
      });
    }
    rowsByEnrollment.set(e.id as string, rows);
  }

  const ROW_CHUNK = 500;
  let created = 0;
  const doneEnrollmentIds: string[] = [];
  let pendingRows: Record<string, unknown>[] = [];
  let pendingIds: string[] = [];

  const flush = async () => {
    if (!pendingRows.length) {
      // Whole group was already spawned (existingPairs covered every step)
      // — nothing new to insert, but it's still "done".
      doneEnrollmentIds.push(...pendingIds);
      pendingRows = [];
      pendingIds = [];
      return;
    }
    const { error } = await svc.from("activities").insert(pendingRows);
    if (error) {
      console.error("spawnCampaignTasks: chunk insert failed (will retry on the next run):", error.message);
    } else {
      created += pendingRows.length;
      doneEnrollmentIds.push(...pendingIds);
    }
    pendingRows = [];
    pendingIds = [];
  };

  for (const e of enrollments) {
    const rows = rowsByEnrollment.get(e.id as string) ?? [];
    if (pendingRows.length && pendingRows.length + rows.length > ROW_CHUNK) {
      await flush();
    }
    pendingRows.push(...rows);
    pendingIds.push(e.id as string);
  }
  await flush();

  if (doneEnrollmentIds.length) {
    const now = new Date().toISOString();
    const MARK_BATCH = 500;
    for (let i = 0; i < doneEnrollmentIds.length; i += MARK_BATCH) {
      const idBatch = doneEnrollmentIds.slice(i, i + MARK_BATCH);
      const { error } = await svc
        .from("campaign_enrollments")
        .update({ tasks_spawned_at: now })
        .in("id", idBatch);
      if (error) console.error("spawnCampaignTasks: tasks_spawned_at mark failed:", error.message);
    }
  }

  return { tasksCreated: created };
}

/**
 * Computes and persists first_send_at for a freshly-inserted batch of
 * enrollments once a campaign has actually started sending — called once,
 * right after Smartlead's START call succeeds (see launch()). A draft
 * campaign's enrollments are left with first_send_at = NULL until a later
 * "Start" action (S4, not built in this slice) does the same computation.
 *
 * Upserts by `id` (the PRIMARY KEY — NOT the partial index
 * spawnCampaignTasks has to work around above), so this can safely use the
 * JS client's upsert() for a real bulk "different value per row" update.
 */
async function backfillFirstSendDates(
  enrollmentsInOrder: { id: string; enroll_position: number; first_send_at?: string | null }[],
  anchorDate: string,
  leadsPerDay: number,
  sendDays: number[],
): Promise<void> {
  if (!enrollmentsInOrder.length) return;
  const sorted = [...enrollmentsInOrder].sort((a, b) => a.enroll_position - b.enroll_position);
  const dates = computeFirstSendDates(sorted.length, anchorDate, leadsPerDay, sendDays);

  // NOT an upsert: .upsert() with only {id, first_send_at} is an INSERT
  // under the hood for PostgREST's constraint check, and campaign_enrollments
  // has NOT NULL columns (campaign_id) the partial row can't satisfy — the
  // whole batch fails with a not-null violation. (Found live 2026-07-22: the
  // silent version of this left every enrollment date NULL and zero tasks
  // spawned.) Instead, group ids by their computed date — there are only
  // ceil(n / leadsPerDay) distinct dates — and issue one real UPDATE per
  // date. Rows that already have a first_send_at are left alone (re-running
  // Start must never re-date someone whose schedule is already live).
  const idsByDate = new Map<string, string[]>();
  sorted.forEach((e, i) => {
    if (e.first_send_at) return;
    const d = dates[i];
    if (!idsByDate.has(d)) idsByDate.set(d, []);
    idsByDate.get(d)!.push(e.id);
  });
  const BATCH = 500;
  for (const [date, ids] of idsByDate) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const { error } = await svc
        .from("campaign_enrollments")
        .update({ first_send_at: date })
        .in("id", ids.slice(i, i + BATCH));
      if (error) throw new Error("first_send_at backfill failed: " + error.message);
    }
  }
}

/**
 * Cancel every still-pending campaign-generated task tied to this campaign's
 * enrollments (CALL/LINKEDIN/EMAIL_HYBRID tasks spawned by spawnCampaignTasks)
 * — used by a Stop action. "Pending" = is_campaign_generated, not already
 * completed, not already archived. Uses the SAME archive convention as the
 * rest of the app's task cancel/delete path (useArchiveActivity in
 * src/features/activities/api.ts): stamps archived_at/archived_by/
 * archive_reason rather than deleting the row, so the task stays visible in
 * Archive Manager for audit. Batched (500/query) on both the read and the
 * write side.
 */
async function cancelPendingCampaignTasks(
  campaignId: string,
  archivedBy: string | null,
): Promise<{ tasksCancelled: number; complete: boolean }> {
  // `complete` = every lookup and archive write succeeded (outside-review
  // fix 3 amendment): errors here used to be console-only, so a Stop could
  // report success while pending call/LinkedIn tasks survived on a dead
  // campaign — and, once the campaigns row said 'stopped', the tracker no
  // longer offered Stop, stranding the user without the retry the error
  // message promises. setCampaignStatus's stop path now throws BEFORE the
  // campaigns-row write when complete is false, keeping Stop retryable.
  const { data: enrollments, error: enrErr } = await svc
    .from("campaign_enrollments")
    .select("id")
    .eq("campaign_id", campaignId);
  if (enrErr) {
    console.error("cancelPendingCampaignTasks: couldn't load enrollments:", enrErr.message);
    return { tasksCancelled: 0, complete: false };
  }
  const enrollmentIds = (enrollments ?? []).map((e) => e.id as string);
  if (!enrollmentIds.length) return { tasksCancelled: 0, complete: true };

  let cancelled = 0;
  let complete = true;
  const BATCH = 500;
  const now = new Date().toISOString();
  for (let i = 0; i < enrollmentIds.length; i += BATCH) {
    const idBatch = enrollmentIds.slice(i, i + BATCH);
    const { data: pending, error: findErr } = await svc
      .from("activities")
      .select("id")
      .in("campaign_enrollment_id", idBatch)
      .eq("is_campaign_generated", true)
      .is("completed_at", null)
      .is("archived_at", null);
    if (findErr) {
      console.error("cancelPendingCampaignTasks: task lookup failed:", findErr.message);
      complete = false;
      continue;
    }
    const taskIds = (pending ?? []).map((t) => t.id as string);
    if (!taskIds.length) continue;
    const { error: updErr } = await svc
      .from("activities")
      .update({
        archived_at: now,
        archived_by: archivedBy,
        archive_reason: "Campaign stopped",
      })
      .in("id", taskIds);
    if (updErr) {
      console.error("cancelPendingCampaignTasks: archive update failed:", updErr.message);
      complete = false;
      continue;
    }
    cancelled += taskIds.length;
  }
  return { tasksCancelled: cancelled, complete };
}

interface SetStatusInput {
  id: string;
  action: "start" | "pause" | "resume" | "stop";
}

// action -> Smartlead's /campaigns/{id}/status payload value. Same endpoint
// shape as the existing autoStart call in launch() below (POST, {status}).
const SMARTLEAD_STATUS_FOR_ACTION: Record<SetStatusInput["action"], string> = {
  start: "START",
  resume: "START",
  pause: "PAUSED",
  stop: "STOPPED",
};
// action -> the Pulse campaigns.status value it lands on.
const PULSE_STATUS_FOR_ACTION: Record<SetStatusInput["action"], "active" | "paused" | "stopped"> = {
  start: "active",
  resume: "active",
  pause: "paused",
  stop: "stopped",
};
// campaign_enrollments statuses a Stop should NOT touch — already at rest.
// ENROLLMENT_TERMINAL_STATUSES itself now comes from
// _shared/campaign-enrollment-actions.ts (S6) — was duplicated identically
// in this file and campaign-webhooks/index.ts before that extraction; both
// import the same list now (see the top-of-file import).

/**
 * Start / pause / resume / stop a campaign from the tracker (Campaigns
 * overhaul S4). For a Smartlead-linked campaign (smartlead_campaign_id set),
 * mirrors the action to Smartlead first — same POST .../status call the
 * launch() autoStart path already uses — then updates the Pulse row. A
 * non-linked row (e.g. a legacy-origin campaign with no Smartlead
 * counterpart) just updates the row.
 *
 * `start` on a DRAFT additionally closes the draft->live loop this slice was
 * built for: anchors the campaign to today, backfills every enrollment's
 * first_send_at (same math as an immediate-start launch), and spawns the
 * CALL/LINKEDIN/EMAIL_HYBRID tasks off it. `start` on anything already past
 * draft (shouldn't happen from the UI, but defensive) just re-mirrors the
 * status — it does NOT re-run the backfill/spawn a second time.
 *
 * `stop` additionally moves every non-terminal enrollment to 'stopped' and
 * archives (never deletes — see cancelPendingCampaignTasks) any pending
 * campaign-generated task tied to this campaign.
 *
 * `pause`/`resume` touch only the campaigns row in this slice — per-
 * enrollment pause/resume is out of scope for v1 (see the spec).
 */
async function setCampaignStatus(p: SetStatusInput, archivedBy: string | null, callerCtx: CallerContext) {
  if (!p.id || !p.action || !(p.action in SMARTLEAD_STATUS_FOR_ACTION)) {
    throw new Error("id and a valid action (start|pause|resume|stop) are required");
  }
  const { data: campaign, error: campErr } = await svc
    .from("campaigns")
    .select("id, status, smartlead_campaign_id, leads_per_day, settings, anchor_date, owner_user_id, sending_email_account_id")
    .eq("id", p.id)
    .single();
  if (campErr || !campaign) throw new Error("Campaign not found: " + (campErr?.message ?? p.id));

  // Rep rollout flip point: remove/adjust this admin gate when reps get UI
  // access to Campaigns (see the same note in launch() above).
  if (!callerCtx.isAdmin && (!callerCtx.userId || campaign.owner_user_id !== callerCtx.userId)) {
    throw new Error("You can only manage campaigns you own.");
  }

  // State preconditions — these are correctness, not permission, so they
  // apply to admins/service-role too. Without them a "start" or "resume"
  // call re-mirrors an already-live status to Smartlead and re-runs the
  // schedule-fill path regardless of the campaign's actual current state,
  // which let a Stopped campaign be resumed (re-arming sending) or
  // re-showed the tracker's Delete action after a bad state transition.
  // The tracker UI only ever offers Start on a draft campaign and Resume on
  // a paused one (CampaignStatusControls in CampaignCard.tsx gates the
  // buttons on c.status), so these mirror what the UI already enforces —
  // this closes the gap for any other caller (API misuse, a stale tab with
  // a cached status, a future non-UI caller).
  if (p.action === "resume" && campaign.status !== "paused") {
    throw new Error("Only a paused campaign can be resumed.");
  }
  if (p.action === "start" && campaign.status !== "draft") {
    throw new Error("Only a draft campaign can be started.");
  }
  if (p.action === "pause" && campaign.status !== "active") {
    throw new Error("Only an active campaign can be paused.");
  }
  // stop is allowed from any non-terminal status (draft/active/paused) —
  // no precondition needed; a stopped/completed campaign has no UI path to
  // re-trigger stop (CampaignStatusControls only renders Stop for
  // active/paused), so this can't be reached from the tracker either way.

  // Inbox-cap recheck at START (adversarial review): computeInboxRoom only
  // counts ACTIVE campaigns, and every launch lands as a draft first — so
  // three drafts on one inbox each saw full room at launch time. Starting
  // is the moment a draft actually claims room, so it's rechecked here,
  // BEFORE the Smartlead mirror. Zero room refuses (the campaign stays a
  // draft, retry-safe); partial room clamps leads_per_day with an honest
  // warning. Smartlead's own schedule keeps the rate it got at launch (we
  // don't re-POST it) — the clamp governs Pulse's throttle math and the
  // Sending Inboxes panel, which is what the cap protects.
  let startClampWarning: string | undefined;
  if (p.action === "start" && campaign.sending_email_account_id != null) {
    const roomAtStart = await computeInboxRoom(Number(campaign.sending_email_account_id));
    if (roomAtStart != null) {
      if (roomAtStart <= 0) {
        throw new Error(
          "That sending inbox is already at its daily limit across its active campaigns — stop or slow another campaign, or relaunch this one on a different inbox.",
        );
      }
      if ((campaign.leads_per_day ?? 0) > roomAtStart) {
        const { error: clampErr } = await svc
          .from("campaigns")
          .update({ leads_per_day: roomAtStart })
          .eq("id", p.id);
        if (clampErr) {
          console.error("set-campaign-status: start-time leads_per_day clamp failed:", clampErr.message);
        } else {
          campaign.leads_per_day = roomAtStart;
          startClampWarning = `New-people-per-day was lowered to ${roomAtStart} to stay inside the sending inbox's daily limit.`;
        }
      }
    }
  }

  if (campaign.smartlead_campaign_id != null) {
    await smartleadFetch(`/campaigns/${campaign.smartlead_campaign_id}/status`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ status: SMARTLEAD_STATUS_FOR_ACTION[p.action] }),
    });
  }

  const newStatus = PULSE_STATUS_FOR_ACTION[p.action];
  let tasksCreated = 0;
  let tasksCancelled = 0;
  let warning: string | undefined = startClampWarning;

  if (p.action === "start" || p.action === "resume") {
    // Retry-safe: runs on every start AND resume, not just draft→start. A
    // draft start anchors to today; anything else (re-click, resume) keeps
    // the stored anchor and only fills what's missing — backfill skips
    // enrollments that already have a date, and spawnCampaignTasks is
    // idempotent, so this can never re-date someone's live schedule. Running
    // it on resume gives the tracker a natural retry path if a start's
    // scheduling half ever failed (the card shows Pause/Resume by then).
    const isDraft = campaign.status === "draft";
    const anchorDate = isDraft
      ? todayISODate()
      : ((campaign.anchor_date as string | null) ?? todayISODate());
    const { data: enrollments, error: eErr } = await svc
      .from("campaign_enrollments")
      .select("id, enroll_position, first_send_at")
      .eq("campaign_id", p.id)
      .order("enroll_position", { ascending: true });
    if (eErr) throw new Error("Could not load enrollments: " + eErr.message);

    const settings = (campaign.settings ?? {}) as Record<string, unknown>;
    const scheduleSettings = (settings.schedule ?? {}) as Record<string, unknown>;
    const sendDays = Array.isArray(scheduleSettings.days_of_week)
      ? (scheduleSettings.days_of_week as number[])
      : [1, 2, 3, 4, 5];

    // Checked AND compare-and-set (outside-review fix 3 + docket I7): the
    // write only lands if the status is still what this call read, so a
    // Stop racing an in-flight Start can't be silently overwritten (and
    // tasks can't be spawned onto a campaign someone just killed). Losing
    // the race throws a plain retry message; the row is unchanged on every
    // failure path, so preconditions still pass on retry and the Smartlead
    // mirror above is idempotent.
    const { data: casStart, error: statusErr } = await svc
      .from("campaigns")
      .update(isDraft ? { anchor_date: anchorDate, status: newStatus } : { status: newStatus })
      .eq("id", p.id)
      .eq("status", campaign.status)
      .select("id");
    if (statusErr) {
      throw new Error(`Couldn't record the campaign as ${newStatus}: ${statusErr.message} — try the action again.`);
    }
    if (!casStart?.length) {
      // Smartlead was already told START above — the honest recovery is
      // pause+resume (which re-runs the idempotent scheduling), not a
      // retry of Start, whose draft-only precondition would now fail
      // (adversarial review).
      throw new Error("The campaign's status changed under this call. If it's sending, pause and resume it to finish scheduling; otherwise refresh and try again.");
    }

    // The campaign IS started in Smartlead by this point — a bookkeeping
    // failure below must not present as "start failed". One internal retry,
    // then report as a warning; everything here is idempotent, so pausing
    // and resuming the campaign re-runs it safely.
    const fillSchedule = async () => {
      await backfillFirstSendDates(
        (enrollments ?? []) as { id: string; enroll_position: number; first_send_at?: string | null }[],
        anchorDate,
        campaign.leads_per_day ?? 20,
        sendDays,
      );
      const spawned = await spawnCampaignTasks(p.id);
      tasksCreated = spawned.tasksCreated;
    };
    try {
      try {
        await fillSchedule();
      } catch (firstErr) {
        console.error("set-campaign-status: scheduling failed, retrying once:", (firstErr as Error).message);
        await new Promise((r) => setTimeout(r, 1000));
        await fillSchedule();
      }
    } catch (postErr) {
      console.error("set-campaign-status: scheduling failed after retry:", (postErr as Error).message);
      const schedNote =
        "The campaign started, but scheduling its call/LinkedIn tasks hit a snag — pause and resume it to finish scheduling.";
      warning = warning ? `${warning} ${schedNote}` : schedNote;
    }
  } else if (p.action === "stop") {
    // All writes checked (outside-review fix 3): Smartlead is already
    // stopped by the mirror above, so what a silently failed write left
    // behind was live-looking Pulse state — active enrollments, pending
    // call/LinkedIn tasks, an 'active' card — on a campaign that was
    // actually dead, with the handler still reporting success. Ordered
    // enrollments -> tasks -> campaigns row so any failure leaves the row
    // non-stopped => the tracker still shows Stop and a retry re-runs
    // everything idempotently.
    const { error: enrollStopErr } = await svc
      .from("campaign_enrollments")
      .update({ status: "stopped" })
      .eq("campaign_id", p.id)
      .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`);
    if (enrollStopErr) {
      throw new Error(`Sending is stopped, but the campaign's people couldn't be marked stopped: ${enrollStopErr.message} — press Stop again to finish.`);
    }
    const result = await cancelPendingCampaignTasks(p.id, archivedBy);
    tasksCancelled = result.tasksCancelled;
    if (!result.complete) {
      throw new Error("Sending is stopped, but some of the campaign's pending tasks couldn't be archived — press Stop again to finish.");
    }
    // CAS here too (docket I7) — stop wins only from the status it read;
    // a retry re-reads fresh, so "press Stop again" still works.
    const { data: casStop, error: stopErr } = await svc
      .from("campaigns")
      .update({ status: newStatus })
      .eq("id", p.id)
      .eq("status", campaign.status)
      .select("id");
    if (stopErr) {
      throw new Error(`Sending is stopped, but the campaign's status couldn't be updated: ${stopErr.message} — press Stop again to finish.`);
    }
    if (!casStop?.length) {
      throw new Error("Sending is stopped, but the campaign's status changed under you — refresh and press Stop again to finish.");
    }
  } else {
    // pause, resume, or start-on-a-non-draft (defensive no-op path above).
    const { data: casPause, error: pauseErr } = await svc
      .from("campaigns")
      .update({ status: newStatus })
      .eq("id", p.id)
      .eq("status", campaign.status)
      .select("id");
    if (pauseErr) {
      throw new Error(`Couldn't record the campaign as ${newStatus}: ${pauseErr.message} — try the action again.`);
    }
    if (!casPause?.length) {
      throw new Error("Someone else just changed this campaign's status — refresh and try again.");
    }
  }

  await auditCampaignAction(`campaign_${p.action}`, p.id, callerCtx.auditUserId, {
    from_status: campaign.status,
    to_status: newStatus,
    tasks_created: tasksCreated,
    tasks_cancelled: tasksCancelled,
  });

  return {
    success: true,
    id: p.id,
    status: newStatus,
    tasks_created: tasksCreated,
    tasks_cancelled: tasksCancelled,
    ...(warning ? { warning } : {}),
  };
}

interface SetEnrollmentStatusInput {
  enrollment_id: string;
  action: "pause" | "resume" | "stop";
}

/** Plain-English label for a terminal enrollment status, used in the "nothing
 *  to change" error message below. */
const TERMINAL_STATUS_LABEL: Record<string, string> = {
  completed: "finished",
  stopped: "was stopped",
  replied: "ended — they replied",
  bounced: "ended — the email bounced",
};

/**
 * Extract a plausible array of lead objects from Smartlead's
 * GET /campaigns/{id}/leads response — same "check data/leads/rows, fall
 * back to top-level array" defensiveness as extractStatRows/extractWebhookRows
 * above (the exact response shape isn't verified against a live account).
 */
function extractLeadRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (typeof res !== "object" || res === null) return [];
  const obj = res as Record<string, unknown>;
  for (const key of ["data", "leads", "rows"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

/**
 * Resolve a Smartlead lead id for one email within a campaign, for
 * enrollments enrolled before smartlead_lead_id capture existed (S5) or
 * whose first EMAIL_SENT webhook never arrived. Smartlead's per-lead listing
 * appears to nest the actual lead under a `lead` key alongside a
 * campaign-lead-map id (matches the shape every other Smartlead campaign
 * sub-resource in this file uses: paginated, `data`/array at the top).
 * Paginated, capped at 10 pages x 100 (1000 leads/campaign) — enough for any
 * real campaign here without eating the whole request on a huge one. Returns
 * null on ANY failure (404/plan limitation/network/no match) — a per-lead
 * Smartlead pause is always best-effort (see setEnrollmentStatus below).
 */
async function resolveSmartleadLeadId(smartleadCampaignId: number, email: string): Promise<number | null> {
  const target = normalizeEmail(email);
  if (!target) return null;
  const PAGE_SIZE = 100;
  const MAX_PAGES = 10;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await smartleadFetch(`/campaigns/${smartleadCampaignId}/leads?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`);
    const rows = extractLeadRows(res);
    for (const raw of rows) {
      const lead = (typeof raw.lead === "object" && raw.lead !== null) ? raw.lead as Record<string, unknown> : raw;
      const leadEmail = lead.email ?? lead.lead_email;
      if (typeof leadEmail !== "string" || normalizeEmail(leadEmail) !== target) continue;
      const rawId = lead.id ?? raw.lead_id ?? raw.campaign_lead_map_id ?? raw.id;
      if (typeof rawId === "number") return rawId;
      if (typeof rawId === "string" && /^\d+$/.test(rawId)) return Number(rawId);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return null;
}

/**
 * Pause/resume ONE lead within a Smartlead campaign — the
 * per-person analog of setCampaignStatus's campaign-wide POST
 * /campaigns/{id}/status. Smartlead's official v1 API documents these
 * campaign-scoped pause/resume endpoints. Throws on failure so callers never
 * mark Pulse paused while Smartlead is still able to send.
 */
async function smartleadSetLeadPauseState(smartleadCampaignId: number, leadId: number, pause: boolean): Promise<void> {
  const verb = pause ? "pause" : "resume";
  await smartleadFetch(`/campaigns/${smartleadCampaignId}/leads/${leadId}/${verb}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({}),
  });
}

/**
 * Pause / resume / stop ONE person's enrollment from the campaign detail
 * sheet (Campaigns overhaul S8) — the per-person analog of
 * setCampaignStatus. Unlike the campaign-wide action, this always does the
 * Pulse-side bookkeeping regardless of whether the Smartlead side succeeds:
 * Smartlead's per-lead pause/resume endpoint shape is unverified (see
 * smartleadSetLeadPauseState's doc comment), so a failure there is reported
 * back as `warning` — plain English, never silently swallowed — rather than
 * failing the whole action. The person's Pulse-side state (and, for stop,
 * their cancelled tasks) is the source of truth either way.
 *
 * - stop: enrollment -> 'stopped', archives pending tasks (reason "Stopped
 *   by user", attributed to the caller).
 * - pause: enrollment -> 'paused'. Tasks are left alone (they may resume).
 * - resume: enrollment -> 'active', but only from 'paused' AND only when the
 *   pause reason is one this action itself can safely clear (paused_by_user
 *   or meeting_booked) — never resumes someone paused for an unrecognized
 *   reason without a human actually looking, and never touches a 'replied'/
 *   'bounced'/etc. enrollment (those are terminal, not "paused").
 */
async function setEnrollmentStatus(p: SetEnrollmentStatusInput, archivedBy: string | null, callerCtx: CallerContext) {
  if (!p.enrollment_id || !["pause", "resume", "stop"].includes(p.action)) {
    throw new Error("enrollment_id and a valid action (pause|resume|stop) are required");
  }
  const { data: enrollment, error: eErr } = await svc
    .from("campaign_enrollments")
    .select("id, campaign_id, email, status, paused_reason, smartlead_lead_id")
    .eq("id", p.enrollment_id)
    .single();
  if (eErr || !enrollment) throw new Error("Enrollment not found: " + (eErr?.message ?? p.enrollment_id));

  if (ENROLLMENT_TERMINAL_STATUSES.includes(enrollment.status)) {
    const label = TERMINAL_STATUS_LABEL[enrollment.status] ?? "already ended";
    throw new Error(`This person's sequence ${label} — there's nothing to change.`);
  }
  if (p.action === "resume" && enrollment.status !== "paused") {
    throw new Error("This person isn't paused — there's nothing to resume.");
  }
  if (p.action === "pause" && enrollment.status !== "active") {
    throw new Error("This person is already paused.");
  }
  if (p.action === "resume") {
    const reason = enrollment.paused_reason as string | null;
    if (reason && reason !== "paused_by_user" && reason !== "meeting_booked") {
      throw new Error("This person was paused automatically for a reason Pulse won't clear on its own — check their status before resuming.");
    }
  }

  const { data: campaign, error: cErr } = await svc
    .from("campaigns")
    .select("id, name, smartlead_campaign_id, owner_user_id")
    .eq("id", enrollment.campaign_id)
    .single();
  if (cErr || !campaign) throw new Error("Campaign not found: " + (cErr?.message ?? enrollment.campaign_id));

  // Rep rollout flip point: remove/adjust this admin gate when reps get UI
  // access to Campaigns (see the same note in launch() above).
  if (!callerCtx.isAdmin && (!callerCtx.userId || campaign.owner_user_id !== callerCtx.userId)) {
    throw new Error("You can only manage enrollments in campaigns you own.");
  }

  let warning: string | undefined;

  // Best-effort Smartlead side — resolve the lead id if we don't have one
  // yet, then pause/resume it there. Never blocks the Pulse-side update.
  if (campaign.smartlead_campaign_id != null) {
    let leadId = enrollment.smartlead_lead_id as number | null;
    let lookupError: string | null = null;
    if (leadId == null && enrollment.email) {
      try {
        leadId = await resolveSmartleadLeadId(campaign.smartlead_campaign_id, enrollment.email);
        if (leadId != null) {
          await svc.from("campaign_enrollments").update({ smartlead_lead_id: leadId }).eq("id", enrollment.id);
        }
      } catch (err) {
        lookupError = (err as Error).message;
        console.warn("set-enrollment-status: lead id lookup failed:", lookupError);
      }
    }
    const wantPause = p.action !== "resume"; // pause AND stop both pause the lead in Smartlead
    if (leadId != null) {
      try {
        await smartleadSetLeadPauseState(campaign.smartlead_campaign_id, leadId, wantPause);
      } catch (err) {
        warning = p.action === "stop"
          ? `Stopped in Pulse and their tasks are cancelled, but Smartlead may still send remaining emails — pause them in Smartlead or stop the whole campaign. (Smartlead error: ${(err as Error).message})`
          : `Updated in Pulse, but couldn't ${wantPause ? "pause" : "resume"} them in Smartlead — they may keep sending/skipping on the old schedule there. (Smartlead error: ${(err as Error).message})`;
      }
    } else {
      // Never a silent fail here either — if the lookup itself errored
      // (rather than just finding no match), say so with the raw message
      // rather than the generic "couldn't find them" (those are different
      // failure modes: one is "this person may not be enrolled in Smartlead
      // at all", the other is "Smartlead's API didn't cooperate").
      const detail = lookupError ? ` (Smartlead error: ${lookupError})` : "";
      warning = p.action === "stop"
        ? `Stopped in Pulse and their tasks are cancelled, but Pulse couldn't find this person in Smartlead to pause their emails there — check Smartlead directly if needed.${detail}`
        : `Updated in Pulse, but Pulse couldn't find this person in Smartlead to sync their pause state there — check Smartlead directly if needed.${detail}`;
    }
  }

  let newStatus: string;
  if (p.action === "stop") {
    newStatus = "stopped";
    const { error } = await svc
      .from("campaign_enrollments")
      .update({ status: "stopped", paused_reason: "stopped_by_user" })
      .eq("id", enrollment.id);
    if (error) throw new Error("Couldn't stop this person: " + error.message);
    await archivePendingTasksForEnrollment(svc, enrollment.id, "Stopped by user", archivedBy);
  } else if (p.action === "pause") {
    newStatus = "paused";
    const { error } = await svc
      .from("campaign_enrollments")
      .update({ status: "paused", paused_reason: "paused_by_user" })
      .eq("id", enrollment.id);
    if (error) throw new Error("Couldn't pause this person: " + error.message);
  } else {
    newStatus = "active";
    const wasMeetingPause = enrollment.paused_reason === "meeting_booked";
    const { error } = await svc
      .from("campaign_enrollments")
      .update({
        status: "active",
        paused_reason: null,
        // A human clearing a meeting-booked pause is final for the
        // opportunities that existed at the time: the daily sweep only
        // re-pauses when a NEW qualifying opp is created after this stamp
        // (outside-review group 2, docket I5 — it used to revert the
        // human's resume every single day).
        ...(wasMeetingPause ? { meeting_pause_dismissed_at: new Date().toISOString() } : {}),
      })
      .eq("id", enrollment.id);
    if (error) throw new Error("Couldn't resume this person: " + error.message);

    // Resume is now actually the reverse of the meeting-booked pause: the
    // call/LinkedIn tasks that pause archived come back (overdue ones
    // re-dated to tomorrow) — docket I4.
    if (wasMeetingPause) {
      const restored = await restoreArchivedTasksForEnrollment(svc, enrollment.id, ["Opportunity opened"]);
      if (restored > 0) {
        const note = `Their ${restored} paused task${restored === 1 ? "" : "s"} came back too (overdue ones moved to tomorrow).`;
        warning = warning ? `${warning} ${note}` : note;
      }
    }
  }

  return { success: true, status: newStatus, ...(warning ? { warning } : {}) };
}

/**
 * Launch a campaign into Smartlead (ported from server.js:3294-3541, then
 * extended by S2's suppression re-check and S3's enrollment engine):
 * create -> sequence (rollback/delete on failure) -> schedule -> attach
 * inbox -> suppression re-check -> no-double-enroll re-check -> add leads
 * (400-batch) -> record in Pulse -> enroll every recipient -> optionally
 * START -> (if started) backfill first_send_at + spawn CALL/LINKEDIN/
 * EMAIL_HYBRID tasks.
 *
 * autoStart defaults to FALSE so the campaign lands as a Smartlead DRAFT (no
 * emails sent, no tasks spawned) until the user reviews + starts it. On
 * success, records the campaign in Pulse, enrolls every recipient actually
 * added to Smartlead, and logs an email_sent activity on each linked contact
 * (suppressed/dropped/already-enrolled recipients excluded from all three).
 */
async function launch(p: LaunchInput, callerCtx: CallerContext) {
  const usingSteps = Array.isArray(p.steps) && p.steps.length > 0;
  if (!p.campaign_name || !p.recipients?.length || (!usingSteps && !p.sequence?.length)) {
    throw new Error("campaign_name, a sequence (or steps), and recipients are required");
  }
  if (p.recipients.length > 10_000) {
    throw new Error("A campaign can include at most 10,000 recipients. Split this audience into smaller launches.");
  }
  // A non-admin launch always belongs to its authenticated caller. Do not
  // trust owner_id from the browser: forcing it here prevents both accidental
  // late failures from a stale owner picker and deliberate cross-user writes.
  // Admins retain the existing ability to launch on another active user's
  // behalf.
  if (!callerCtx.isAdmin) {
    if (!callerCtx.userId) throw new Error("Sign in again before launching a campaign.");
    p.owner_id = callerCtx.userId;
  }
  const delay = () => new Promise((r) => setTimeout(r, 300));

  // Validate template_id if supplied — reject launch with unpublished or
  // missing templates BEFORE any Smartlead mutation. Template-less launches
  // (write-your-own, AI-generated) skip this entirely.
  if (p.template_id) {
    const { data: tmpl } = await svc
      .from("campaign_templates")
      .select("id, publish_state")
      .eq("id", p.template_id)
      .maybeSingle();
    if (!tmpl || tmpl.publish_state !== "published") {
      throw new Error(
        "This template is no longer available for launch. It may have been unpublished or removed — pick a different template and try again.",
      );
    }
  }

  // Mixed-channel launch (template gallery / SequenceEditor "Launch this
  // sequence"): p.steps is the frozen source of truth — subject/body edits
  // made in the wizard are already folded into it client-side. Derive
  // Smartlead's flat email sequence FROM it and ignore p.sequence entirely.
  // AI-wizard launch (no p.steps): p.sequence drives Smartlead directly and
  // sequenceToSteps() backfills campaigns.steps for the tracker.
  const rawSteps: CampaignStep[] = usingSteps
    ? p.steps!
    : (sequenceToSteps(p.sequence!) as unknown as CampaignStep[]);
  const steps: CampaignStep[] = rawSteps.map((step) => step.channel === "EMAIL_AUTO"
    ? {
        ...step,
        content_ai_draft: false,
        subject_template: protectCampaignPersonalization(step.subject_template || ""),
        body_template: protectCampaignPersonalization(step.body_template || ""),
      }
    : step);
  const firstEmailOrder = Math.min(...steps.filter((step) => step.channel === "EMAIL_AUTO").map((step) => step.order));
  const incompleteEmails = steps.filter((step) => step.channel === "EMAIL_AUTO" && (
    step.content_ai_draft === true ||
    (step.order === firstEmailOrder && !String(step.subject_template ?? "").trim()) ||
    !String(step.body_template ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").trim()
  ));
  if (incompleteEmails.length) {
    throw new Error(
      `${incompleteEmails.length === 1 ? "One automated email is" : `${incompleteEmails.length} automated emails are`} missing visible wording. Finish the copy in Pulse before launching.`,
    );
  }
  const emailSequence: Array<Record<string, unknown>> = usingSteps
    ? (emailStepsToSmartleadSequence(steps) as unknown as Array<Record<string, unknown>>)
    : (emailStepsToSmartleadSequence(steps) as unknown as Array<Record<string, unknown>>);

  // The launch date every enrollment's throttle math anchors to — "payload
  // date or today" per the S3 spec, resolved ONCE and reused below for both
  // campaigns.anchor_date and computeFirstSendDates, so the two can never
  // disagree about what "the anchor" was.
  const anchorDate = (typeof p.anchor_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(p.anchor_date))
    ? p.anchor_date.slice(0, 10)
    : todayISODate();

  // 1. Create
  const createRes = (await smartleadFetch("/campaigns/create", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: p.campaign_name }),
  })) as { id: number };
  const campaignId = createRes.id;
  await delay();

  // 1.5. Webhook registration (Phase 2, S5) — best-effort, right after
  // create so it's registered before any leads/sends happen. A failure here
  // (404/403/plan limitation) must NEVER fail the launch — see
  // registerCampaignWebhook's doc comment. webhookId stays null when
  // registration didn't succeed, and the campaigns row below only persists
  // webhook_secret alongside a real webhookId (no orphaned secret sitting
  // on a row nothing will ever call in with).
  const webhookSecret = generateWebhookSecret();
  const webhookId = await registerCampaignWebhook(campaignId, webhookSecret);

  // Everything after the create is wrapped: any failure best-effort DELETES
  // the just-created Smartlead campaign (and the Pulse campaigns row, if it
  // already exists by that point), so we never leave an orphaned campaign
  // behind and a retry starts clean.
  let leadsAdded = 0;
  let leadsFailed = 0;
  let autoStarted = false;
  let pulseCampaignId: string | null = null;
  // Declared outside the try so the final return (after the try/catch) can
  // report them even though they're only computed inside.
  let suppressionDropped = 0;
  let alreadyEnrolledDropped = 0;
  let enrolledCount = 0;
  // In-flight launch claims held by THIS launch (docket E4) — released on
  // success and on rollback; the table's TTL reaps anything a crash leaves.
  let claimedEmails: string[] = [];
  let tasksCreated = 0;
  // Non-fatal launch problems the user must still hear about (partial lead
  // upload, a failed post-start bookkeeping write) — returned as `warning`
  // and toasted by the wizard (outside-review fix 3).
  let launchWarning: string | undefined;
  // A failed webhook registration used to be swallowed entirely — and the
  // nightly self-repair then skipped webhook-less campaigns, so the
  // campaign stayed without real-time replies forever (docket I1). Now the
  // user hears about it AND the heal step covers it tonight.
  if (webhookId == null) {
    launchWarning =
      "Live reply alerts couldn't be connected for this campaign — tonight's automatic self-repair will retry, or press \"Repair live updates\" on the campaign's detail view.";
  }
  try {
    // 2. Sequence. Skipped entirely for an all-task sequence (no EMAIL_AUTO
    // steps at all) — Smartlead doesn't need an empty sequences payload, and
    // a mixed-channel launch is allowed to be call/LinkedIn-only.
    if (emailSequence.length) {
      await smartleadFetch(`/campaigns/${campaignId}/sequences`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          sequences: emailSequence.map((s, i) => ({
            seq_number: Number(s.seq_number) || i + 1,
            seq_delay_details: { delay_in_days: Number(s.delay_days) || 0 },
            subject: String(s.subject ?? ""),
            email_body: String(s.body_html ?? ""),
          })),
        }),
      });
      await delay();
    }

    // 3. Schedule (required for sending; warn-continue on failure).
    // max_new_leads_per_day is computed ONCE here and reused for
    // campaigns.leads_per_day in step 7 below — these two used to be
    // sourced independently (this call defaulted to 25, the campaigns-row
    // default was 20) and could silently disagree; there is now
    // structurally only one value, so they can't drift apart again.
    const sendDays = Array.isArray(p.schedule?.days_of_week)
      ? (p.schedule!.days_of_week as number[])
      : [1, 2, 3, 4, 5];
    let maxNewLeadsPerDay = Number(p.schedule?.max_new_leads_per_day) || 25;

    // Server-side inbox cap (outside-review group 2, docket I25): the 7/27
    // wizard clamp is client-only — a stale tab, an API caller, or a future
    // UI path could still oversubscribe a mailbox. Same math as the Sending
    // Inboxes panel: Smartlead's daily limit minus what active campaigns
    // already draw. Unknown limit = no cap (never treated as 0); zero room
    // = refuse (the rollback in the outer catch cleans up the just-created
    // Smartlead campaign).
    if (p.email_account_id != null) {
      const room = await computeInboxRoom(p.email_account_id);
      if (room != null) {
        if (room <= 0) {
          throw new Error(
            "That sending inbox is already at its daily limit across its active campaigns — pick a different inbox, or lower another campaign's daily volume first.",
          );
        }
        if (maxNewLeadsPerDay > room) {
          const capNote = `New-people-per-day was capped at ${room} to stay inside the sending inbox's daily limit.`;
          launchWarning = launchWarning ? `${launchWarning} ALSO: ${capNote}` : capNote;
          maxNewLeadsPerDay = room;
        }
      }
    }
    try {
      await smartleadFetch(`/campaigns/${campaignId}/schedule`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          timezone: p.schedule?.timezone ?? "America/Los_Angeles",
          days_of_the_week: sendDays,
          start_hour: p.schedule?.start_hour ?? "09:00",
          end_hour: p.schedule?.end_hour ?? "17:00",
          min_time_btw_emails: p.schedule?.min_time_btw_emails ?? 15,
          max_new_leads_per_day: maxNewLeadsPerDay,
        }),
      });
      await delay();
    } catch { /* schedule optional for a draft */ }

    // 4. Attach sending inbox.
    if (p.email_account_id) {
      try {
        await smartleadFetch(`/campaigns/${campaignId}/email-accounts`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ email_account_ids: [p.email_account_id] }),
        });
        await delay();
      } catch { /* continue */ }
    }

    // 5. Suppression re-check (defense in depth). The client already filters
    // via v_marketing_suppression (fetchSuppressionForEmails +
    // partitionSuppression in src/features/playbook/), but the server never
    // trusts the client: re-check every recipient email here with the
    // service-role client, and drop anything suppressed that the caller
    // didn't explicitly list in suppression_overrides. Recorded on the
    // campaigns row below (settings.suppression) and returned so the UI can
    // toast it.
    const recipientEmails = p.recipients.map((r) => r.email);
    const suppressionRows = await fetchSuppressionForEmails(recipientEmails);
    const overrides = Array.isArray(p.suppression_overrides) ? p.suppression_overrides : [];
    const { eligible: eligibleEmails, dropped: suppressionDroppedEmails, overriddenCount: suppressionOverriddenCount } =
      partitionSuppressedEmails(recipientEmails, suppressionRows, overrides);
    const suppressionChecked = recipientEmails.length;
    suppressionDropped = suppressionDroppedEmails.length;
    const recipients = suppressionDropped > 0
      ? p.recipients.filter((r) => eligibleEmails.has(normalizeEmail(r.email)))
      : p.recipients;
    if (recipients.length === 0) {
      throw new Error(
        `All ${suppressionChecked} recipient(s) are on the Do-Not-Email list — nothing to send. ` +
        `Use "Include anyway" on the people you really mean to email.`,
      );
    }

    // 5.4. Concurrent-launch claims (docket E4) — MUST run BEFORE the
    // active-enrollment check below. The check-then-insert rail can't see
    // another launch that's mid-flight (its enrollments aren't committed
    // yet), so two simultaneous launches could both pass it and both enroll
    // — and SEND to — the same person. Claiming first closes the window
    // from both sides: an overlapping launch hits our claims, and a launch
    // that starts after we finish sees our committed enrollments in the
    // check. Conflicted recipients are dropped with an honest warning
    // unless the caller explicitly overrode them (enrollment_overrides
    // means "double-enroll deliberately", which covers this rail too).
    const enrollmentOverrideSet = new Set(
      (Array.isArray(p.enrollment_overrides) ? p.enrollment_overrides : []).map(normalizeEmail),
    );
    const claimCandidates = Array.from(new Set(recipients.map((r) => normalizeEmail(r.email)).filter(Boolean)));
    let claimConflicts = new Set<string>();
    const { data: conflictArr, error: claimErr } = await svc.rpc("campaign_launch_claim_emails", {
      p_emails: claimCandidates,
    });
    if (claimErr) throw new Error("Couldn't reserve this launch's recipients: " + claimErr.message);
    claimConflicts = new Set((conflictArr ?? []) as string[]);
    claimedEmails = claimCandidates.filter((e) => !claimConflicts.has(e));
    let concurrentLaunchDropped = 0;
    const claimClearedRecipients = recipients.filter((r) => {
      const key = normalizeEmail(r.email);
      if (!claimConflicts.has(key)) return true;
      if (enrollmentOverrideSet.has(key)) return true;
      concurrentLaunchDropped++;
      return false;
    });
    if (concurrentLaunchDropped > 0) {
      const claimNote =
        `${concurrentLaunchDropped} ${concurrentLaunchDropped === 1 ? "person is" : "people are"} being launched by someone else right now ` +
        `and ${concurrentLaunchDropped === 1 ? "was" : "were"} left out of this one — if they really belong here too, launch them again in a few minutes.`;
      launchWarning = launchWarning ? `${launchWarning} ALSO: ${claimNote}` : claimNote;
    }
    if (claimClearedRecipients.length === 0) {
      throw new Error(
        "Every recipient in this launch is already being launched by someone else right now — try again in a few minutes.",
      );
    }

    // 5.5. No-double-enroll rail (S3): is this email ALREADY actively
    // enrolled in ANY campaign (not just this one)? Mirrors the suppression
    // rail immediately above — same batch/override/all-dropped pattern,
    // different source table. Someone already receiving one cadence
    // shouldn't silently be dropped into a second at the same time unless a
    // human deliberately says so (enrollment_overrides).
    const enrollmentChecked = claimClearedRecipients.length;
    const activeEnrollmentEmails = await fetchActiveEnrollmentEmails(claimClearedRecipients.map((r) => r.email));
    let alreadyActiveOverridden = 0;
    const enrollableRecipients = claimClearedRecipients.filter((r) => {
      const key = normalizeEmail(r.email);
      if (!activeEnrollmentEmails.has(key)) return true;
      if (enrollmentOverrideSet.has(key)) { alreadyActiveOverridden++; return true; }
      alreadyEnrolledDropped++;
      return false;
    });
    if (enrollableRecipients.length === 0) {
      throw new Error(
        `All ${enrollmentChecked} recipient(s) are already actively enrolled in a campaign — nothing to add. ` +
        `Use "Enroll anyway" on the people you really mean to add.`,
      );
    }

    // 6. Add leads in batches of 400, retrying a failed batch once before
    // counting it failed (a single transient blip shouldn't drop ~400 leads).
    // Tracks WHICH recipients actually landed (outside-review fix 3): every
    // downstream step — enrollments, contact-timeline activities, task
    // spawning — must only cover people the sending platform really has,
    // not the full pre-upload list.
    const batchSize = 400;
    const totalBatches = Math.ceil(enrollableRecipients.length / batchSize);
    const uploadedRecipients: typeof enrollableRecipients = [];
    const failedUploadEmails: string[] = [];
    for (let i = 0; i < totalBatches; i++) {
      const batch = enrollableRecipients.slice(i * batchSize, (i + 1) * batchSize);
      const leadList = batch.map((r) => ({
        email: r.email,
        first_name: r.first_name ?? "",
        last_name: r.last_name ?? "",
        company_name: r.company_name ?? "",
      }));
      let ok = false;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        if (attempt > 0) await delay();
        try {
          await smartleadFetch(`/campaigns/${campaignId}/leads`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ lead_list: leadList }),
          });
          ok = true;
        } catch { /* retry once */ }
      }
      if (ok) {
        leadsAdded += batch.length;
        uploadedRecipients.push(...batch);
      } else {
        leadsFailed += batch.length;
        failedUploadEmails.push(...batch.map((r) => r.email));
      }
      if (i < totalBatches - 1) await delay();
    }
    if (leadsAdded === 0 && leadsFailed > 0) {
      throw new Error("All lead batches failed; campaign created but has no leads.");
    }
    if (leadsFailed > 0) {
      const leadNote =
        `${leadsFailed} ${leadsFailed === 1 ? "person" : "people"} couldn't be added to the sending platform ` +
        `and were left out of this campaign — they got no enrollment and no tasks. ` +
        `Re-add them in a follow-up launch when you're ready.`;
      // Append, never overwrite — the webhook-registration warning set
      // above must survive alongside this one (adversarial review).
      launchWarning = launchWarning ? `${launchWarning} ALSO: ${leadNote}` : leadNote;
    }

    // 7. Record in Pulse (BEFORE any START, so a rollback never deletes a
    // live send). Treat a failed insert as fatal so the campaign is rolled
    // back rather than silently orphaned. Starts as 'draft'; step 10 flips
    // it to 'active' only once the Smartlead START call actually succeeds,
    // so the row never claims to be sending when it isn't.
    const { data: inserted, error: insErr } = await svc
      .from("campaigns")
      .insert({
        name: p.campaign_name,
        origin: "pulse",
        status: "draft",
        template_id: p.template_id ?? null,
        smartlead_campaign_id: campaignId,
        owner_user_id: p.owner_id ?? null,
        sending_email_account_id: p.email_account_id != null ? String(p.email_account_id) : null,
        leads_per_day: maxNewLeadsPerDay,
        anchor_date: anchorDate,
        // The EXACT launched steps (any email edits already folded in) —
        // this is the frozen record the tracker + Phase 2 engine read.
        steps,
        smartlead_webhook_id: webhookId,
        webhook_secret: webhookId != null ? webhookSecret : null,
        notes: emailSequence
          .map((s, i) => `Step ${s.seq_number ?? i + 1}: ${s.subject ?? ""}`)
          .join("\n"),
        adaptive_enabled: !!p.adaptiveEnabled,
        settings: {
          suppression: {
            checked: suppressionChecked,
            dropped: suppressionDropped,
            overridden: suppressionOverriddenCount,
            // Capped so a huge suppressed batch can't bloat the row.
            dropped_emails: suppressionDroppedEmails.slice(0, 200),
          },
          enrollment: {
            checked: enrollmentChecked,
            already_active_dropped: alreadyEnrolledDropped,
            overridden: alreadyActiveOverridden,
          },
          // Durable record of what the Smartlead upload actually did — the
          // toast disappears; this doesn't (outside-review fix 3).
          upload: {
            added: leadsAdded,
            failed: leadsFailed,
            failed_emails: failedUploadEmails.slice(0, 200),
          },
          delivery: {
            days_of_week: sendDays,
            timezone: p.schedule?.timezone ?? "America/Los_Angeles",
            start_hour: p.schedule?.start_hour ?? "09:00",
            end_hour: p.schedule?.end_hour ?? "17:00",
            min_time_btw_emails: p.schedule?.min_time_btw_emails ?? 15,
            max_new_leads_per_day: maxNewLeadsPerDay,
          },
          sender: { email_account_id: p.email_account_id ?? null },
          authoring_method: p.authoring_method ?? (p.template_id ? "template" : "ai"),
        },
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw new Error("Smartlead campaign created but the Pulse record failed: " + (insErr?.message ?? "unknown"));
    }
    pulseCampaignId = inserted.id;

    // 7.5. Enrollments (S3) — one row per person actually added to Smartlead
    // above (uploadedRecipients — recipients from FAILED upload batches get
    // no enrollment, no timeline entry, and no tasks; outside-review fix 3
    // made this comment true), in upload order (enroll_position drives the
    // throttle math).
    // Always inserted with first_send_at = NULL; it's only computed once we
    // know sending has actually started (step 10 below) — a draft
    // campaign's enrollments stay NULL until a later "Start" action
    // computes it fresh (S4, not built in this slice).
    //
    // Failure here is FATAL: the catch below deletes the just-created
    // campaigns row too (not just the Smartlead campaign), which cascades
    // to any enrollments already inserted (campaign_enrollments.campaign_id
    // is ON DELETE CASCADE, 20260625000001).
    //
    // De-dupe by contact_id first: uq_enrollment_campaign_contact
    // (campaign_id, contact_id) — 20260625000001 — rejects a second row with
    // the same non-null contact_id, and that unique-violation aborts the
    // WHOLE insert batch it lands in (not just the offending row), which
    // would abort the whole enrollment for every recipient already queued
    // in Smartlead above. Drop later duplicates, keep the first occurrence
    // (preserves upload order for the survivors' enroll_position). NULL
    // contact_id (CSV/paste recipients with no contact match) is exempt —
    // Postgres treats NULLs as distinct, so they never collide with each
    // other on this index.
    const preDedupeCount = uploadedRecipients.length;
    const seenContactIds = new Set<string>();
    const seenEmails = new Set<string>();
    const dedupedRecipients = uploadedRecipients.filter((r) => {
      // Email dedupe FIRST (docket I3): two contact records sharing one
      // address used to create two enrollments, and the webhook's
      // by-email lookup then failed for that address forever. One email =
      // one enrollment, first occurrence wins (keeps upload order). Also
      // covers the right-click quick path, which bypasses the client's
      // own byEmail merge.
      const emailKey = normalizeEmail(r.email);
      if (emailKey) {
        if (seenEmails.has(emailKey)) return false;
        seenEmails.add(emailKey);
      }
      if (!r.contact_id) return true;
      if (seenContactIds.has(r.contact_id)) return false;
      seenContactIds.add(r.contact_id);
      return true;
    });

    // Owner routing (outside-review group 2): each enrollment carries the
    // CONTACT's owner so tasks, reply bells, and follow-ups land on the rep
    // who owns the relationship — the campaign owner (the launcher / the
    // wizard's owner picker) is only the fallback for CSV/paste people and
    // unowned contacts. Looked up server-side so every launch path (wizard,
    // right-click quick campaign) gets it without trusting the client.
    const ownerLookupIds = Array.from(new Set(
      dedupedRecipients.map((r) => r.contact_id).filter(Boolean) as string[],
    ));
    const contactOwner = new Map<string, string>();
    const OWNER_BATCH = 500;
    for (let i = 0; i < ownerLookupIds.length; i += OWNER_BATCH) {
      const batch = ownerLookupIds.slice(i, i + OWNER_BATCH);
      const { data: ownerRows, error: ownerErr } = await svc
        .from("contacts")
        .select("id, owner_user_id")
        .in("id", batch);
      if (ownerErr) {
        // Non-fatal: fall back to the campaign owner for this batch rather
        // than failing a launch over routing metadata.
        console.error("playbook launch: contact owner lookup failed (falling back to campaign owner):", ownerErr.message);
        continue;
      }
      for (const c of (ownerRows ?? []) as { id: string; owner_user_id: string | null }[]) {
        if (c.owner_user_id) contactOwner.set(c.id, c.owner_user_id);
      }
    }
    // Deactivated owners don't get tasks (adversarial review): a contact
    // still owned by a departed rep must fall through to the campaign
    // owner — a live human — not an account nobody signs into.
    const candidateOwnerIds = Array.from(new Set(contactOwner.values()));
    if (candidateOwnerIds.length) {
      const activeOwners = new Set<string>();
      for (let i = 0; i < candidateOwnerIds.length; i += OWNER_BATCH) {
        const batch = candidateOwnerIds.slice(i, i + OWNER_BATCH);
        const { data: profRows, error: profErr } = await svc
          .from("user_profiles")
          .select("id, is_active")
          .in("id", batch);
        if (profErr) {
          console.error("playbook launch: owner is_active check failed (keeping contact owners as-is):", profErr.message);
          batch.forEach((id) => activeOwners.add(id));
          continue;
        }
        for (const u of (profRows ?? []) as { id: string; is_active: boolean | null }[]) {
          if (u.is_active !== false) activeOwners.add(u.id);
        }
      }
      for (const [contactId, ownerId] of contactOwner) {
        if (!activeOwners.has(ownerId)) contactOwner.delete(contactId);
      }
    }

    if (preDedupeCount > dedupedRecipients.length) {
      const merged = preDedupeCount - dedupedRecipients.length;
      const mergeNote = `${merged} duplicate ${merged === 1 ? "person was" : "people were"} merged (same email or contact) — each address is enrolled once.`;
      launchWarning = launchWarning ? `${launchWarning} ALSO: ${mergeNote}` : mergeNote;
    }
    const enrollmentRows = dedupedRecipients.map((r, i) => ({
      campaign_id: pulseCampaignId,
      contact_id: r.contact_id ?? null,
      account_id: r.account_id ?? null, // tag-source recipients carry it; CSV/paste don't (no lookup in v1)
      owner_user_id: (r.contact_id ? contactOwner.get(r.contact_id) : undefined) ?? p.owner_id ?? null,
      enroll_position: i + 1,
      email: normalizeEmail(r.email),
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      company: r.company_name ?? "",
      status: "active",
      current_step: 0,
      first_send_at: null,
    }));
    const insertedEnrollments: { id: string; enroll_position: number }[] = [];
    const ENROLL_BATCH = 500;
    for (let i = 0; i < enrollmentRows.length; i += ENROLL_BATCH) {
      const chunk = enrollmentRows.slice(i, i + ENROLL_BATCH);
      const { data: ins, error: eErr } = await svc
        .from("campaign_enrollments")
        .insert(chunk)
        .select("id, enroll_position");
      if (eErr) {
        throw new Error("Enrollment insert failed: " + eErr.message);
      }
      insertedEnrollments.push(...((ins ?? []) as { id: string; enroll_position: number }[]));
    }
    enrolledCount = insertedEnrollments.length;

    // 8. Mark the source idea executed.
    if (p.source_idea_id && pulseCampaignId) {
      await svc
        .from("playbook_ideas")
        .update({ status: "executed", executed_campaign_id: pulseCampaignId })
        .eq("id", p.source_idea_id);
    }

    // 9. Log an email activity on each linked contact (timeline visibility).
    // Non-fatal: a bad FK in one row shouldn't fail the whole launch. Only
    // people actually uploaded to Smartlead — a timeline entry saying
    // "added to campaign" for someone whose upload failed would be a lie
    // (outside-review fix 3).
    const subject = String(emailSequence[0]?.subject ?? p.campaign_name);
    // dedupedRecipients, not uploadedRecipients (adversarial review): a
    // contact dropped by the shared-email/contact dedupe has NO enrollment
    // — a timeline entry claiming they were added would be a lie.
    const acts = dedupedRecipients
      .filter((r) => r.contact_id)
      .map((r) => ({
        activity_type: "email",
        subject: `Campaign: ${p.campaign_name}`,
        body: `Added to Smartlead campaign "${p.campaign_name}". First subject: ${subject}`,
        email_direction: "sent",
        email_to: [r.email],
        contact_id: r.contact_id,
        account_id: r.account_id ?? null,
        owner_user_id: p.owner_id ?? null,
        activity_date: new Date().toISOString(),
      }));
    if (acts.length) {
      const { error: actErr } = await svc.from("activities").insert(acts);
      if (actErr) console.error("playbook launch: activity log insert failed:", actErr.message);
    }

    // 10. Optionally START (default OFF — leave as a Smartlead draft). Done
    // last so the Pulse record already exists; on success promote to
    // active, then compute first_send_at for every enrollment and spawn the
    // CALL/LINKEDIN/EMAIL_HYBRID tasks off it (S3 — this is the moment the
    // orchestrator model comes alive). That post-processing is wrapped
    // separately and never rethrows past this point: by the time we get
    // here Smartlead is already sending real email, so a bookkeeping hiccup
    // in date math or task creation must NOT roll back an otherwise-live
    // campaign (the outer catch below only fires for failures ABOVE this
    // line, i.e. before anything was actually sent).
    if (p.autoStart === true) {
      try {
        await smartleadFetch(`/campaigns/${campaignId}/status`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ status: "START" }),
        });
        autoStarted = true;
        // Checked, not fire-and-forget (outside-review fix 3): Smartlead is
        // LIVE by this point, so a failed write here used to leave the Pulse
        // row saying 'draft' while real email went out — and reported
        // success. Can't throw (the outer catch would roll back a live
        // campaign); instead skip the schedule bookkeeping (it belongs to an
        // active campaign) and hand the user the exact recovery step — the
        // tracker's Start on the still-draft row re-runs all of it
        // idempotently.
        const { error: activateErr } = await svc
          .from("campaigns")
          .update({ status: "active" })
          .eq("id", pulseCampaignId);
        if (activateErr) {
          console.error("playbook launch: campaign is LIVE in Smartlead but the Pulse status write failed:", activateErr.message);
          // Append, never overwrite — a partial-upload warning set earlier
          // must survive alongside this one (adversarial review).
          const startWarning =
            "The campaign IS sending, but Pulse couldn't record it as started — open it in the tracker and press Start to finish the bookkeeping.";
          launchWarning = launchWarning ? `${launchWarning} ALSO: ${startWarning}` : startWarning;
        } else {
          try {
            await backfillFirstSendDates(insertedEnrollments, anchorDate, maxNewLeadsPerDay, sendDays);
            const spawned = await spawnCampaignTasks(pulseCampaignId);
            tasksCreated = spawned.tasksCreated;
          } catch (postErr) {
            console.error(
              "playbook launch: post-start task spawn failed (campaign is live; not rolling back):",
              (postErr as Error).message,
            );
            const taskWarning =
              "The campaign IS sending, but Pulse couldn't finish scheduling the call and LinkedIn tasks. Open the campaign tracker and press Pause, then Resume, to retry the task setup.";
            launchWarning = launchWarning ? `${launchWarning} ALSO: ${taskWarning}` : taskWarning;
          }
        }
      } catch (startErr) {
        console.error("playbook launch: Smartlead start failed; campaign remains a draft:", (startErr as Error).message);
        const startWarning =
          "The campaign was created, but Smartlead did not start it. Open it in the Pulse campaign tracker and press Start to retry.";
        launchWarning = launchWarning ? `${launchWarning} ALSO: ${startWarning}` : startWarning;
      }
    }
  } catch (err) {
    try { await smartleadFetch(`/campaigns/${campaignId}`, { method: "DELETE" }); } catch { /* best-effort */ }
    // If the Pulse campaigns row already exists (e.g. the enrollment insert
    // failed AFTER it was created), delete it too so a retry starts clean —
    // cascades to any campaign_enrollments rows already inserted (ON DELETE
    // CASCADE). Any activities/tasks already spawned would only be orphaned
    // (campaign_enrollment_id set null, ON DELETE SET NULL) rather than
    // deleted, but that's moot here: task spawning only ever runs AFTER
    // this rollback's failure window has passed (step 10's own
    // non-rethrowing wrapper above), so the two paths never overlap.
    if (pulseCampaignId) {
      try { await svc.from("campaigns").delete().eq("id", pulseCampaignId); } catch { /* best-effort */ }
    }
    // Release this launch's claims so a corrected retry isn't blocked for
    // the TTL (docket E4). Best-effort — the TTL is the real backstop.
    if (claimedEmails.length) {
      try { await svc.rpc("campaign_launch_release_emails", { p_emails: claimedEmails }); } catch { /* TTL reaps */ }
    }
    throw err;
  }

  if (claimedEmails.length) {
    try { await svc.rpc("campaign_launch_release_emails", { p_emails: claimedEmails }); } catch { /* TTL reaps */ }
  }

  if (pulseCampaignId) {
    await auditCampaignAction("campaign_launch", pulseCampaignId, callerCtx.auditUserId, {
      name: p.campaign_name,
      smartlead_campaign_id: campaignId,
      enrolled: enrolledCount,
      leads_added: leadsAdded,
      leads_failed: leadsFailed,
      suppression_dropped: suppressionDropped,
      already_enrolled_dropped: alreadyEnrolledDropped,
      auto_started: autoStarted,
    });
  }

  return {
    success: true,
    smartlead_campaign_id: campaignId,
    pulse_campaign_id: pulseCampaignId,
    leads_added: leadsAdded,
    leads_failed: leadsFailed,
    auto_started: autoStarted,
    suppression_dropped: suppressionDropped,
    already_enrolled_dropped: alreadyEnrolledDropped,
    enrolled: enrolledCount,
    tasks_created: tasksCreated,
    smartlead_url: `https://app.smartlead.ai/app/email-campaign/${campaignId}/analytics`,
    ...(launchWarning ? { warning: launchWarning } : {}),
  };
}

// ============================================================
// inbox-health (Campaigns overhaul Phase 5) — "Sending inboxes" panel
// ------------------------------------------------------------
// Plain-English capacity/warmup view of every Smartlead sending inbox, so a
// rep can tell "is this inbox safe to keep loading up" without opening
// Smartlead. Two data sources per inbox: Smartlead's own warmup-stats
// endpoint (best-effort, unverified shape — see fetchInboxWarmup) and our
// own campaigns table (which active campaigns are already sending through
// this inbox, and how many new people/day that adds up to).
// ============================================================

interface InboxHealthWarmup {
  sent_7d: number | null;
  /** Percent, 0-100 (already unwrapped from any trailing "%"). */
  inbox_rate: number | null;
  /** Percent, 0-100. */
  spam_rate: number | null;
  status: string | null;
}

interface InboxHealthCampaignSummary {
  id: string;
  name: string;
  leads_per_day: number;
  status: string;
}

interface InboxHealthEntry {
  id: number;
  from_email: string | null;
  from_name: string | null;
  daily_limit: number | null;
  sent_today: number | null;
  warmup: InboxHealthWarmup | null;
  campaigns: InboxHealthCampaignSummary[];
  total_leads_per_day: number;
  signature: string | null;
  warmup_enabled: boolean | null;
  account_status: string | null;
}

function extractAccountSignature(account: Record<string, unknown>): string | null {
  for (const key of ["signature", "email_signature", "account_signature"]) {
    const value = account[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function unwrapEmailAccountDetail(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  for (const key of ["data", "email_account", "account"]) {
    if (typeof row[key] === "object" && row[key] !== null) return row[key] as Record<string, unknown>;
  }
  return row;
}

function firstBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }
  return null;
}

// firstNumber lives in _shared/smartlead-sync.ts (extracted 2026-07-31,
// docket I38) — imported at top.

/**
 * Best-effort per-inbox warmup read — GET /email-accounts/{id}/warmup-stats.
 * Endpoint shape UNVERIFIED beyond "matches the /email-accounts/{id}/<noun>
 * pattern the rest of Smartlead's REST API uses" — same unverified-but-
 * best-guess posture as registerCampaignWebhook and resolveSmartleadLeadId
 * elsewhere in this file. Reads every plausible field-name variant for the
 * 7-day sent/inbox/spam numbers and a status string; returns null (NEVER
 * throws, and never fabricates a number) on any failure or unrecognized
 * shape — a missing warmup read must never break the panel, it just shows
 * "No warmup data" for that inbox.
 */
async function fetchInboxWarmup(emailAccountId: number): Promise<InboxHealthWarmup | null> {
  try {
    const raw = await smartleadFetch(`/email-accounts/${emailAccountId}/warmup-stats`);
    if (typeof raw !== "object" || raw === null) return null;
    const res = raw as Record<string, unknown>;
    const sent7d = firstNumber(res.sent_count, res.total_sent_count, res.warmup_email_sent_count, res.sent);
    const inboxRate = firstNumber(res.inbox_percentage, res.inbox_rate, res.landed_inbox_percentage, res.inbox_placement);
    const spamRate = firstNumber(res.spam_percentage, res.spam_rate, res.landed_spam_percentage, res.spam_placement);
    const statusRaw = res.warmup_status ?? res.status;
    const status = typeof statusRaw === "string" && statusRaw.trim() ? statusRaw.trim() : null;
    if (sent7d == null && inboxRate == null && spamRate == null && status == null) return null;
    return { sent_7d: sent7d, inbox_rate: inboxRate, spam_rate: spamRate, status };
  } catch (err) {
    console.warn(`inbox-health: warmup-stats fetch failed for email account ${emailAccountId} (showing "no data"):`, (err as Error).message);
    return null;
  }
}

// extractDailyLimit lives in _shared/smartlead-sync.ts (extracted
// 2026-07-31, docket I38, so tests/smartleadSyncStatus.test.ts can exercise
// its never-fabricate-a-0 posture) — imported at top.

/** Defensive top-level extraction for the /email-accounts response — same
 *  "array, or data/rows nested under a key" posture as extractLeadRows/
 *  extractStatRows above (fetchEmailAccounts' shape beyond "an array" isn't
 *  pinned down either). */
function extractEmailAccountRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (typeof res !== "object" || res === null) return [];
  const obj = res as Record<string, unknown>;
  for (const key of ["data", "email_accounts", "rows"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

/**
 * Remaining new-leads/day room on one sending inbox (outside-review group
 * 2): Smartlead's daily limit minus what ACTIVE campaigns already draw
 * through it — the same math the Sending Inboxes panel and the wizard's
 * client-side clamp use, now enforced at launch time on the server. Returns
 * null for "unknown" (inbox not found, limit field unrecognized, lookup
 * failed) — the caller must treat null as NO CAP, never as 0.
 */
async function computeInboxRoom(emailAccountId: number): Promise<number | null> {
  try {
    const rawAccounts = await fetchEmailAccounts();
    const account = extractEmailAccountRows(rawAccounts).find((a) => String(a.id) === String(emailAccountId));
    if (!account) return null;
    const limit = extractDailyLimit(account);
    if (limit == null) return null;
    const { data: active, error } = await svc
      .from("campaigns")
      .select("leads_per_day")
      .eq("status", "active")
      .eq("sending_email_account_id", String(emailAccountId));
    if (error) {
      console.warn("computeInboxRoom: active-campaign lookup failed (treating room as unknown):", error.message);
      return null;
    }
    const draw = ((active ?? []) as { leads_per_day: number | null }[])
      .reduce((sum, c) => sum + (c.leads_per_day || 0), 0);
    return Math.max(0, limit - draw);
  } catch (err) {
    console.warn("computeInboxRoom: failed (treating room as unknown):", (err as Error).message);
    return null;
  }
}

/** Admin-only (see the Deno.serve dispatch below). Capped at the first 10
 *  inboxes — a real Smartlead account here has a handful of sending
 *  inboxes, and each one costs a live warmup-stats round trip through the
 *  same rate-limited smartleadFetch queue every other Smartlead call in
 *  this file shares, so an unbounded list could push a slow account past
 *  the edge function's runtime budget. */
async function inboxHealth(): Promise<{ inboxes: InboxHealthEntry[] }> {
  const rawAccounts = await fetchEmailAccounts();
  const accounts = extractEmailAccountRows(rawAccounts).slice(0, 10);
  if (!accounts.length) return { inboxes: [] };

  const ids = accounts
    .map((a) => (a.id != null ? String(a.id) : null))
    .filter((id): id is string => id != null);
  const { data: activeCampaigns, error } = ids.length
    ? await svc
      .from("campaigns")
      .select("id, name, leads_per_day, status, sending_email_account_id")
      .eq("status", "active")
      .in("sending_email_account_id", ids)
    : { data: [], error: null };
  if (error) console.error("inbox-health: campaign lookup failed (showing every inbox as feeding nothing):", error.message);

  const campaignsByInbox = new Map<string, InboxHealthCampaignSummary[]>();
  for (const c of activeCampaigns ?? []) {
    const key = c.sending_email_account_id as string;
    if (!campaignsByInbox.has(key)) campaignsByInbox.set(key, []);
    campaignsByInbox.get(key)!.push({
      id: c.id as string, name: c.name as string,
      leads_per_day: (c.leads_per_day as number) ?? 0, status: c.status as string,
    });
  }

  // Warmup reads are sequential in effect anyway (smartleadFetch's own
  // module-level queue serializes every outbound Smartlead call), so
  // Promise.all here doesn't create a request burst — it just lets each
  // inbox's warmup fetch and the (already-in-hand) campaign lookup resolve
  // together without hand-rolled sequencing.
  const inboxes = await Promise.all(accounts.map(async (a) => {
    const id = Number(a.id);
    const key = String(a.id);
    const campaigns = campaignsByInbox.get(key) ?? [];
    const totalLeadsPerDay = campaigns.reduce((sum, c) => sum + (c.leads_per_day || 0), 0);
    const [warmup, accountDetail] = Number.isFinite(id)
      ? await Promise.all([
        fetchInboxWarmup(id),
        fetchEmailAccountById(id).catch((err) => {
          console.warn(`inbox-health: account detail fetch failed for ${id} (signature unavailable):`, (err as Error).message);
          return null;
        }),
      ])
      : [null, null];
    const detailedAccount = unwrapEmailAccountDetail(accountDetail) ?? a;
    const warmupConfig = typeof detailedAccount.warmup === "object" && detailedAccount.warmup !== null
      ? detailedAccount.warmup as Record<string, unknown>
      : {};
    return {
      id,
      from_email: typeof a.from_email === "string" ? a.from_email : null,
      from_name: typeof a.from_name === "string" ? a.from_name : null,
      daily_limit: extractDailyLimit(a),
      sent_today: (() => {
        const value = firstNumber(a.daily_sent_count);
        return value != null && value >= 0 ? value : null;
      })(),
      warmup,
      campaigns,
      total_leads_per_day: totalLeadsPerDay,
      signature: extractAccountSignature(detailedAccount),
      warmup_enabled: firstBoolean(
        detailedAccount.warmup_enabled,
        detailedAccount.is_warmup_enabled,
        warmupConfig.enabled,
      ),
      account_status: typeof detailedAccount.status === "string"
        ? detailedAccount.status
        : typeof detailedAccount.connection_status === "string" ? detailedAccount.connection_status : null,
    };
  }));

  return { inboxes };
}

async function updateEmailAccountSignature(emailAccountId: unknown, signature: unknown): Promise<{ success: true; signature: string }> {
  const id = Number(emailAccountId);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Choose a valid sending inbox.");
  if (typeof signature !== "string") throw new Error("Signature must be text or HTML.");
  if (signature.length > 20_000) throw new Error("Signature is too long (20,000 character limit).");
  await smartleadFetch(`/email-accounts/${id}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ signature }),
  });
  const refreshed = await fetchEmailAccountById(id);
  const row = unwrapEmailAccountDetail(refreshed) ?? {};
  const actual = extractAccountSignature(row);
  if (actual !== signature) throw new Error("Smartlead did not confirm the updated signature. Refresh and try again.");
  return { success: true, signature: actual };
}

async function updateEmailAccountDailyLimit(emailAccountId: unknown, dailyLimit: unknown): Promise<{ success: true; daily_limit: number }> {
  const id = Number(emailAccountId);
  const limit = Number(dailyLimit);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Choose a valid sending inbox.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Daily limit must be a whole number from 1 to 500.");
  await smartleadFetch(`/email-accounts/${id}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ max_email_per_day: limit }),
  });
  const refreshed = unwrapEmailAccountDetail(await fetchEmailAccountById(id)) ?? {};
  const actual = extractDailyLimit(refreshed);
  if (actual !== limit) throw new Error("Smartlead did not confirm the updated daily limit. Refresh and try again.");
  return { success: true, daily_limit: actual };
}

// ============================================================
// daily-sweep (Campaigns overhaul Phase 2, slice S6)
// ------------------------------------------------------------
// Makes the system correct even with zero webhooks — the sweep re-derives
// everything a webhook would have told us, from Smartlead's own campaign
// data, once a day. Runs as six independently-wrapped steps (one step's
// failure never stops the rest) under an overall ~100s runtime budget (the
// edge function limit is 150s) — any work left over after the budget is
// simply picked up on the next scheduled run via the oldest-swept-first
// ordering (campaigns.settings.last_sweep_at).
//
// See supabase/migrations/20260722200000_campaigns_daily_sweep_cron.sql for
// the schedule (13:10 UTC daily) and docs/campaigns/campaigns-plan.md for
// the overall orchestrator model.
// ============================================================

interface DailySweepReport {
  campaigns_synced: number;
  campaigns_reconciled: number;
  enrollments_updated: number;
  replies_detected: number;
  meetings_paused: number;
  tasks_created: number;
  tasks_cancelled: number;
  webhooks_healed: number;
  skipped_for_budget: number;
  insights_generated: number;
  /** Abandoned wizard drafts removed by step 0 (docket I37). */
  drafts_pruned: number;
  /** Plain-English step-failure notes (group 2, docket I10) — persisted to
   *  campaign_sweep_runs; empty = the run was clean (ok = true). */
  errors: string[];
}

const SWEEP_BUDGET_MS = 100_000; // stop starting new campaign work after ~100s (150s edge limit)
const STEP1_BUDGET_MS = 35_000; // metrics sync's own slice of the budget (docket I8)
const SWEEP_RECONCILE_CAP = 25; // campaigns/run for the per-lead reconcile step
const SWEEP_INSIGHTS_CAP = 3; // campaigns/run for the AI insights step (each is a Claude call — keep small)

/** Loosely-typed row shape read off `campaigns` by the sweep's various
 *  steps — a structural subset, same convention as CampaignStep above. */
interface SweepCampaignRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  smartlead_campaign_id: number;
  smartlead_webhook_id?: number | null;
  webhook_secret?: string | null;
  settings?: Record<string, unknown> | null;
}

/** First plausible ISO-ish timestamp string among candidate reads, else
 *  null — small local twin of webhook-normalize.ts's toIsoOrNull (not
 *  imported: that module deliberately has zero cross-file deps, and this is
 *  the only place in this file that needs it). Never throws. */
function toIsoOrNullLocal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return null;
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!s) return null;
  const asNumber = Number(s);
  const d = Number.isFinite(asNumber) && /^\d+$/.test(s)
    ? new Date(asNumber > 1e12 ? asNumber : asNumber * 1000) // ms vs unix-seconds
    : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

interface LeadStatRow {
  email: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  bouncedAt: string | null;
  /** Unsubscribe signal, when the statistics endpoint happens to expose one
   *  (outside-review fix 2) — unverified field names, same defensive-read
   *  posture as reply/bounce: if Smartlead never sends it here, the branch
   *  simply never fires and the webhook remains the unsubscribe source. */
  unsubscribedAt: string | null;
  /** Smartlead's lead-category classification (Interested / Meeting Request
   *  / Not Interested / etc.), when the statistics endpoint happens to
   *  include it — unverified field name, same defensive-read posture as
   *  everything else in this function (Campaigns overhaul Phase 3, S9). */
  category: string | null;
}

/** Defensive per-lead-row extraction — Smartlead's exact field names for the
 *  statistics endpoint aren't nailed down in the docs we could verify (same
 *  situation as webhook-normalize.ts's event-type parsing), so this reads
 *  every plausible variant: an explicit timestamp field, OR (for
 *  reply/bounce) a truthy boolean flag with no timestamp at all — in which
 *  case `nowIso` (the sweep's own run time) stands in for "when", since we
 *  only just discovered it. */
function normalizeLeadStatRow(raw: Record<string, unknown>, nowIso: string): LeadStatRow {
  const emailRaw = raw.lead_email ?? raw.email ?? raw.to_email ?? raw.recipient_email;
  const email = typeof emailRaw === "string" ? normalizeEmail(emailRaw) : null;

  const sentAt = toIsoOrNullLocal(raw.sent_time ?? raw.sent_at ?? raw.email_sent_time ?? raw.sent_date ?? raw.first_sent_time);

  let repliedAt = toIsoOrNullLocal(raw.reply_time ?? raw.replied_at ?? raw.email_reply_time ?? raw.reply_date);
  if (!repliedAt && (raw.is_replied === true || raw.replied === true)) repliedAt = nowIso;

  let bouncedAt = toIsoOrNullLocal(raw.bounce_time ?? raw.bounced_at ?? raw.email_bounce_time ?? raw.bounce_date);
  if (!bouncedAt && (raw.is_bounced === true || raw.bounced === true)) bouncedAt = nowIso;

  let unsubscribedAt = toIsoOrNullLocal(raw.unsubscribed_time ?? raw.unsubscribed_at ?? raw.unsubscribe_time ?? raw.unsubscribe_date);
  if (!unsubscribedAt && (raw.is_unsubscribed === true || raw.unsubscribed === true)) unsubscribedAt = nowIso;

  const categoryRaw = raw.category ?? raw.lead_category ?? raw.category_name ?? raw.reply_category;
  // Canonicalized (docket I11) — same rule as the webhook path, so no
  // free-text ever reaches campaign_enrollments.reply_category.
  const category = typeof categoryRaw === "string" ? sanitizeReplyCategory(categoryRaw) : null;

  return { email: email || null, sentAt, repliedAt, bouncedAt, unsubscribedAt, category };
}

function extractStatRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (typeof res !== "object" || res === null) return [];
  const obj = res as Record<string, unknown>;
  for (const key of ["data", "statistics", "rows"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

/** Sentinel thrown when the statistics endpoint 404s — distinguishes "this
 *  Smartlead plan/tier doesn't expose per-lead statistics for this campaign"
 *  (skip reconcile for it, metrics stay synced from step 1) from a real
 *  transient failure (bubble up, logged, campaign retried next run). */
const STATISTICS_NOT_FOUND = Symbol("STATISTICS_NOT_FOUND");

/** Paginated per-lead statistics fetch, capped at 5 pages x 500 rows (2500
 *  leads/campaign/run — comfortably above any real Smartlead campaign size
 *  here) so one huge campaign can't eat the whole sweep's time budget. */
async function fetchCampaignLeadStatistics(smartleadCampaignId: number): Promise<Record<string, unknown>[]> {
  const PAGE_SIZE = 500;
  const MAX_PAGES = 5;
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let res: unknown;
    try {
      res = await smartleadFetch(`/campaigns/${smartleadCampaignId}/statistics?offset=${page * PAGE_SIZE}&limit=${PAGE_SIZE}`);
    } catch (err) {
      if (page === 0 && /Smartlead API 404/.test((err as Error).message)) {
        throw STATISTICS_NOT_FOUND;
      }
      throw err;
    }
    const batch = extractStatRows(res);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

interface ReconcileResult {
  enrollmentsUpdated: number;
  repliesDetected: number;
  tasksCancelled: number;
}

/**
 * Per-lead reconcile for one campaign (daily-sweep step 2). Matches
 * Smartlead's per-lead statistics rows against this campaign's non-terminal
 * enrollments by normalized email, then applies EXACTLY the same
 * transitions a real-time webhook would have:
 *   (a) actual first send differs from what we recorded -> correct
 *       first_send_at + shift pending tasks by the day delta
 *       (_shared/campaign-task-shift.ts — same helper the EMAIL_SENT webhook
 *       handler uses)
 *   (b) lead shows a reply -> stopEnrollmentForReply (same routine the
 *       EMAIL_REPLIED webhook handler uses)
 *   (c) lead shows a bounce -> stopEnrollmentForBounce (same routine the
 *       EMAIL_BOUNCED webhook handler uses)
 *   (d) lead shows an unsubscribe -> stopEnrollmentForUnsubscribe (same
 *       routine the EMAIL_UNSUBSCRIBED webhook handler uses; outside-review
 *       fix 2 — this reconcile previously had no unsubscribe branch at all)
 * Order: bounce, else reply, THEN unsubscribe on top of either — the
 * bounce/reply branch owns the status + notification, the unsubscribe
 * branch always records the opt-out (its transition no-ops when a prior
 * branch already ended the enrollment). A post-loop backstop also records
 * unsubscribes for ALREADY-terminal enrollments, which the main query
 * filters out.
 */
async function reconcileCampaignLeads(campaign: SweepCampaignRow): Promise<ReconcileResult> {
  const nowIso = new Date().toISOString();
  let statRows: Record<string, unknown>[];
  try {
    statRows = await fetchCampaignLeadStatistics(campaign.smartlead_campaign_id);
  } catch (err) {
    if (err === STATISTICS_NOT_FOUND) {
      console.warn(`daily-sweep: /campaigns/${campaign.smartlead_campaign_id}/statistics not available (404) — skipping reconcile for "${campaign.name}" (metrics still synced by step 1)`);
      return { enrollmentsUpdated: 0, repliesDetected: 0, tasksCancelled: 0 };
    }
    throw err;
  }
  if (!statRows.length) return { enrollmentsUpdated: 0, repliesDetected: 0, tasksCancelled: 0 };

  const byEmail = new Map<string, LeadStatRow>();
  for (const raw of statRows) {
    const row = normalizeLeadStatRow(raw, nowIso);
    if (row.email) byEmail.set(row.email, row);
  }
  if (!byEmail.size) return { enrollmentsUpdated: 0, repliesDetected: 0, tasksCancelled: 0 };

  let enrollments: Record<string, unknown>[];
  try {
    enrollments = await fetchAllRows<Record<string, unknown>>((from, to) =>
      svc
        .from("campaign_enrollments")
        .select("id, contact_id, account_id, first_name, last_name, email, company, owner_user_id, status, first_send_at, actual_first_send_at, reply_category")
        .eq("campaign_id", campaign.id)
        .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`)
        .order("id", { ascending: true })
        .range(from, to));
  } catch (err) {
    throw new Error("Enrollment lookup for reconcile failed: " + (err as Error).message);
  }
  if (!enrollments?.length) return { enrollmentsUpdated: 0, repliesDetected: 0, tasksCancelled: 0 };

  const campaignForActions = { id: campaign.id, name: campaign.name, owner_user_id: campaign.owner_user_id };

  let enrollmentsUpdated = 0;
  let repliesDetected = 0;
  let tasksCancelled = 0;

  // Category updates batch by VALUE (docket E3): categories are the hot
  // write in this loop — Smartlead re-categorizes routinely, while the
  // bounce/reply/unsubscribe transitions below are one-shot per enrollment
  // and side-effectful (notifications, task cancels, opt-outs), so THOSE
  // stay per-row by design. There are at most 7 canonical categories, so
  // grouping turns N single-row updates into ≤7 `.in()` statements.
  const categoryUpdates = new Map<string, string[]>();

  for (const e of enrollments as {
    id: string; contact_id: string | null; account_id: string | null;
    first_name: string | null; last_name: string | null; email: string | null;
    company: string | null; owner_user_id: string | null;
    status: string; first_send_at: string | null; actual_first_send_at: string | null;
    reply_category: string | null;
  }[]) {
    const key = e.email ? normalizeEmail(e.email) : "";
    const row = key ? byEmail.get(key) : undefined;
    if (!row) continue;

    // Category (S9) — independent of the reply/bounce/sent branches below;
    // a category can arrive on the same statistics row as a reply, or on its
    // own before/after one.
    if (row.category && row.category !== e.reply_category) {
      const ids = categoryUpdates.get(row.category) ?? [];
      ids.push(e.id);
      categoryUpdates.set(row.category, ids);
    }

    // (c)/(b) — bounce beats reply (a bounced lead never sends a real
    // reply); reply beats unsubscribe for the STATUS + owner notification,
    // because an unsubscribe routinely rides along with a real reply ("take
    // me off your list") and the rep must still be told about the reply
    // (adversarial-review fix — the unsub branch running FIRST silently
    // killed the bell + follow-up task + Replies-feed row for that case).
    let signalHandled = false;
    if (row.bouncedAt) {
      const result = await stopEnrollmentForBounce(svc, e, campaign.id, { occurredAt: row.bouncedAt, source: "daily-sweep" });
      if (result.updated) {
        enrollmentsUpdated++;
        tasksCancelled += result.tasksCancelled;
      }
      signalHandled = true;
    } else if (row.repliedAt) {
      const result = await stopEnrollmentForReply(svc, e, campaignForActions, null, e.email, { occurredAt: row.repliedAt, source: "daily-sweep" });
      if (result.updated) {
        enrollmentsUpdated++;
        repliesDetected++;
        tasksCancelled += result.tasksCancelled;
      }
      signalHandled = true;
    }

    // (d) unsubscribe — the one signal this reconcile previously ignored
    // (outside-review fix 2). Runs AFTER (not instead of) the branches
    // above: its opt-out side effects are unconditional, and its status
    // transition simply no-ops when a bounce/reply already ended the
    // enrollment — the opt-out is recorded either way.
    if (row.unsubscribedAt) {
      const result = await stopEnrollmentForUnsubscribe(svc, e, campaign.id, { occurredAt: row.unsubscribedAt, source: "daily-sweep" });
      if (result.updated) {
        enrollmentsUpdated++;
        tasksCancelled += result.tasksCancelled;
      }
      signalHandled = true;
    }
    if (signalHandled) continue;

    // (a) first-send date reconcile — SAME one-time-correction gate as
    // campaign-webhooks' handleEmailSent (see actual_first_send_at's column
    // comment, 20260723060000_campaigns_audit_fixes.sql): once a real send
    // has been confirmed for this enrollment (by either this sweep or the
    // live webhook), it must never be corrected/shifted again. Without this
    // gate the sweep would re-"correct" first_send_at (and re-shift tasks)
    // every single run for as long as row.sentAt (Smartlead's reported first
    // send) differed from the stored value for any reason — the exact same
    // re-anchor-on-every-send bug FIX 1 closes on the webhook side, just
    // triggered by a cron tick instead of a later EMAIL_SENT event.
    if (row.sentAt && !e.actual_first_send_at) {
      const sentDate = row.sentAt.slice(0, 10);
      const mismatched = !e.first_send_at || e.first_send_at.slice(0, 10) !== sentDate;
      if (mismatched) {
        const delta = e.first_send_at ? daysBetweenDateOnly(e.first_send_at, row.sentAt) : 0;
        const { error: updErr } = await svc
          .from("campaign_enrollments")
          .update({ first_send_at: sentDate, actual_first_send_at: row.sentAt })
          .eq("id", e.id);
        if (updErr) {
          console.error(`daily-sweep: first_send_at correction failed for enrollment ${e.id}:`, updErr.message);
          continue;
        }
        if (delta !== 0) await shiftEnrollmentTasks(svc, e.id, delta);
        enrollmentsUpdated++;
      } else {
        // Already correct (matches what we'd have set) — still stamp
        // actual_first_send_at so the gate closes even when there was
        // nothing to shift, matching handleEmailSent's behavior of always
        // setting it on the first confirmed send.
        const { error: stampErr } = await svc
          .from("campaign_enrollments")
          .update({ actual_first_send_at: row.sentAt })
          .eq("id", e.id);
        if (stampErr) console.error(`daily-sweep: actual_first_send_at stamp failed for enrollment ${e.id}:`, stampErr.message);
      }
    }
  }

  // Flush the batched category updates (docket E3) — one `.in()` per
  // distinct category value, chunked to stay inside sane statement sizes.
  const CAT_CHUNK = 500;
  for (const [category, ids] of categoryUpdates) {
    for (let i = 0; i < ids.length; i += CAT_CHUNK) {
      const chunk = ids.slice(i, i + CAT_CHUNK);
      const { error: catErr } = await svc
        .from("campaign_enrollments")
        .update({ reply_category: category })
        .in("id", chunk);
      if (catErr) console.error(`daily-sweep: batched reply_category update failed (${category}, ${chunk.length} rows):`, catErr.message);
    }
  }

  // Post-terminal unsubscribe backstop (adversarial review): the loop above
  // only iterates NON-terminal enrollments, but an unsubscribe Smartlead
  // reports after a reply/bounce/completion belongs in marketing_optouts
  // regardless — that's the entire point of fix 2, and on a webhook-less
  // campaign this reconcile is the only path that will ever see it. One
  // extra targeted query for just the unsubscribed emails that didn't match
  // a live enrollment; stopEnrollmentForUnsubscribe's transition no-ops on
  // these rows, so only the opt-out side effects fire. Capped — a backstop,
  // not a bulk path.
  const liveEmails = new Set(
    ((enrollments ?? []) as { email: string | null }[])
      .map((x) => (x.email ? normalizeEmail(x.email) : ""))
      .filter(Boolean),
  );
  const unmatchedUnsubEmails = [...byEmail.entries()]
    .filter(([em, r]) => r.unsubscribedAt && !liveEmails.has(em))
    .map(([em]) => em)
    .slice(0, 200);
  if (unmatchedUnsubEmails.length) {
    const { data: terminalRows, error: termErr } = await svc
      .from("campaign_enrollments")
      .select("id, contact_id, account_id, first_name, last_name, email, company, status")
      .eq("campaign_id", campaign.id)
      .in("email", unmatchedUnsubEmails);
    if (termErr) {
      console.error("daily-sweep: post-terminal unsubscribe lookup failed:", termErr.message);
    } else {
      for (const t of (terminalRows ?? []) as {
        id: string; contact_id: string | null; account_id: string | null;
        first_name: string | null; last_name: string | null; email: string | null;
        company: string | null; status: string;
      }[]) {
        const row = t.email ? byEmail.get(normalizeEmail(t.email)) : undefined;
        if (!row?.unsubscribedAt) continue;
        await stopEnrollmentForUnsubscribe(svc, t, campaign.id, { occurredAt: row.unsubscribedAt, source: "daily-sweep" });
      }
    }
  }

  return { enrollmentsUpdated, repliesDetected, tasksCancelled };
}

/** Extract a plausible array of webhook objects from Smartlead's
 *  GET /campaigns/{id}/webhooks response (same "check data/webhooks/rows,
 *  fall back to top-level array" defensiveness as extractStatRows /
 *  webhook-status's raw passthrough). */
/** null = UNRECOGNIZED response shape ("we can't tell"), distinct from []
 *  = a well-formed response whose list is genuinely empty ("our webhook is
 *  really gone"). Collapsing the two was docket I2: an unparsed 200 read as
 *  "unhealthy" and re-registered a duplicate webhook every night, double-
 *  counting every event from then on. */
function extractWebhookRows(res: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (typeof res !== "object" || res === null) return null;
  const obj = res as Record<string, unknown>;
  for (const key of ["data", "webhooks", "rows"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return null;
}

/** Is our webhook still registered AND not explicitly disabled on this
 *  Smartlead campaign? On an uncertain check (fetch failure, unrecognized
 *  response shape) this returns true — a false negative here would attempt
 *  to register a SECOND webhook alongside a perfectly healthy first one,
 *  which is worse than skipping a heal for one day. A well-formed EMPTY
 *  list, however, is a real "it's gone" and correctly reads unhealthy. */
async function isWebhookHealthy(smartleadCampaignId: number, webhookId: number): Promise<boolean> {
  try {
    const res = await smartleadFetch(`/campaigns/${smartleadCampaignId}/webhooks`);
    const rows = extractWebhookRows(res);
    if (rows === null) return true; // can't tell — honor the doc contract above
    if (!rows.length) return false;
    return rows.some((w) => {
      const wid = w.id ?? w.webhook_id;
      if (wid == null || String(wid) !== String(webhookId)) return false;
      const enabled = w.is_active ?? w.enabled ?? w.status;
      if (enabled === undefined) return true;
      if (typeof enabled === "boolean") return enabled;
      if (typeof enabled === "string") return !/disab|inactive|paused/i.test(enabled);
      return true;
    });
  } catch (err) {
    console.warn(`daily-sweep: webhook health check failed for campaign ${smartleadCampaignId} (assuming healthy; best-effort):`, (err as Error).message);
    return true;
  }
}

/**
 * Run-log wrapper around dailySweep (outside-review group 2, docket I10):
 * the report used to live only in this HTTP response body — which pg_cron's
 * net.http_post DISCARDS, and pg_cron records "succeeded" the moment the
 * request is queued — so the sweep could fail every night with nobody the
 * wiser. campaign_sweep_runs (20260728150000) is the durable record; the
 * scheduled-job watchdog reads its freshness + ok flag and pages admins.
 */
async function runDailySweepWithLog(): Promise<DailySweepReport> {
  let runId: string | null = null;
  const { data: runRow, error: insErr } = await svc
    .from("campaign_sweep_runs")
    .insert({ started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (insErr) console.error("daily-sweep: run-log insert failed (continuing unlogged):", insErr.message);
  else runId = (runRow?.id as string | undefined) ?? null;

  let report: DailySweepReport;
  try {
    report = await dailySweep();
  } catch (err) {
    // Every step inside dailySweep is individually caught, so reaching here
    // means a structural failure (bad deploy, DB down). Record it before
    // rethrowing — a half-row with finished_at set and ok=false is exactly
    // what the watchdog surfaces.
    if (runId) {
      const { error: crashErr } = await svc.from("campaign_sweep_runs").update({
        finished_at: new Date().toISOString(),
        ok: false,
        error: ("sweep crashed: " + (err as Error).message).slice(0, 2000),
      }).eq("id", runId);
      if (crashErr) console.error("daily-sweep: run-log crash finalize failed:", crashErr.message);
    }
    throw err;
  }

  if (runId) {
    const ok = report.errors.length === 0;
    const { error: updErr } = await svc.from("campaign_sweep_runs").update({
      finished_at: new Date().toISOString(),
      ok,
      report: report as unknown as Record<string, unknown>,
      error: ok ? null : report.errors.join("; ").slice(0, 2000),
    }).eq("id", runId);
    if (updErr) console.error("daily-sweep: run-log finalize failed:", updErr.message);
  }
  return report;
}

async function dailySweep(): Promise<DailySweepReport> {
  const startedAt = Date.now();
  const hasBudget = () => Date.now() - startedAt < SWEEP_BUDGET_MS;

  const report: DailySweepReport = {
    campaigns_synced: 0,
    campaigns_reconciled: 0,
    enrollments_updated: 0,
    replies_detected: 0,
    meetings_paused: 0,
    tasks_created: 0,
    tasks_cancelled: 0,
    webhooks_healed: 0,
    skipped_for_budget: 0,
    insights_generated: 0,
    drafts_pruned: 0,
    errors: [],
  };

  // ---- 0. Abandoned wizard-draft prune (docket I37) ----------------
  // Ignore-the-resume-banner + build fresh + walk away leaves the old
  // campaign_drafts row forever (cleanup only ran on a successful launch).
  // One cheap DELETE, before the budgeted steps: any draft untouched for
  // 30 days is abandoned — the wizard autosaves on every edit, so a draft
  // someone still cares about always has a recent updated_at.
  try {
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data: pruned, error: pruneErr } = await svc
      .from("campaign_drafts")
      .delete()
      .lt("updated_at", cutoff)
      .select("id");
    if (pruneErr) throw new Error(pruneErr.message);
    report.drafts_pruned = (pruned ?? []).length;
  } catch (err) {
    console.error("daily-sweep: draft prune failed:", (err as Error).message);
    report.errors.push("step 0 (draft prune): " + (err as Error).message);
  }

  // ---- 1. Metrics + status refresh ---------------------------------
  // Budgeted (docket I8): step 1 used to run uncapped BEFORE any
  // hasBudget() check — a Smartlead 429 window could spend the entire
  // 100s here and starve every later step, every night.
  try {
    // The sweep's dedicated step 6 owns terminal reconciliation; do not
    // duplicate that work inside metrics sync and spend the same budget twice.
    const { synced, capped } = await syncCampaigns(Date.now() + STEP1_BUDGET_MS, false);
    report.campaigns_synced = synced;
    if (capped > 0) {
      report.skipped_for_budget += capped;
      console.warn(`daily-sweep: metrics sync hit its ${STEP1_BUDGET_MS / 1000}s budget with ${capped} campaigns left (they'll sync next run)`);
    }
  } catch (err) {
    console.error("daily-sweep: metrics/status sync failed:", (err as Error).message);
    report.errors.push("step 1 (metrics/status sync): " + (err as Error).message);
  }

  // ---- 2. Per-lead reconcile (cap 25/run, oldest-swept-first) ------
  try {
    const activeCampaigns = await fetchAllRows<Record<string, unknown>>((from, to) =>
      svc
        .from("campaigns")
        .select("id, name, owner_user_id, smartlead_campaign_id, settings")
        .eq("status", "active")
        .not("smartlead_campaign_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to));

    const sorted = ((activeCampaigns ?? []) as SweepCampaignRow[]).slice().sort((a, b) => {
      const at = (a.settings?.last_sweep_at as string) || "";
      const bt = (b.settings?.last_sweep_at as string) || "";
      return at < bt ? -1 : at > bt ? 1 : 0;
    });

    let reconciledThisRun = 0;
    for (let i = 0; i < sorted.length; i++) {
      if (reconciledThisRun >= SWEEP_RECONCILE_CAP || !hasBudget()) {
        report.skipped_for_budget += sorted.length - i;
        break;
      }
      const camp = sorted[i];

      const { count, error: countErr } = await svc
        .from("campaign_enrollments")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", camp.id)
        .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`);
      if (countErr) {
        console.error(`daily-sweep: non-terminal-enrollment count failed for campaign ${camp.id}:`, countErr.message);
        continue;
      }
      if (!count) continue; // nothing to reconcile right now — doesn't consume the cap

      try {
        const result = await reconcileCampaignLeads(camp);
        report.campaigns_reconciled++;
        report.enrollments_updated += result.enrollmentsUpdated;
        report.replies_detected += result.repliesDetected;
        report.tasks_cancelled += result.tasksCancelled;
      } catch (err) {
        console.error(`daily-sweep: reconcile failed for campaign ${camp.id} "${camp.name}" (continuing):`, (err as Error).message);
        report.errors.push(`step 2 (reconcile "${camp.name}"): ` + (err as Error).message);
      }
      reconciledThisRun++;

      // Merge RPC, not spread-update (docket I36) — see campaign_sync_apply's
      // comment in syncCampaigns for the clobber window this closes.
      const { error: settingsErr } = await svc.rpc("campaign_settings_merge", {
        p_campaign_id: camp.id,
        p_patch: { last_sweep_at: new Date().toISOString() },
      });
      if (settingsErr) console.error(`daily-sweep: last_sweep_at update failed for campaign ${camp.id}:`, settingsErr.message);
    }
  } catch (err) {
    console.error("daily-sweep: per-lead reconcile step failed:", (err as Error).message);
    report.errors.push("step 2 (per-lead reconcile): " + (err as Error).message);
  }

  // ---- 3. Meeting-booked pause --------------------------------------
  try {
    const candidates = await fetchAllRows<Record<string, unknown>>((from, to) =>
      svc
        .from("campaign_enrollments")
        .select("id, campaign_id, contact_id, account_id, first_name, last_name, email, owner_user_id, status, paused_reason, enrolled_at, meeting_pause_dismissed_at, smartlead_lead_id")
        .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`)
        .or("contact_id.not.is.null,account_id.not.is.null")
        .order("id", { ascending: true })
        .range(from, to));

    const eligible = (candidates ?? []).filter(
      (e) => !(e.status === "paused" && e.paused_reason === "meeting_booked"),
    ) as {
      id: string; campaign_id: string; contact_id: string | null; account_id: string | null;
      first_name: string | null; last_name: string | null; email: string | null;
      owner_user_id: string | null;
      status: string; paused_reason: string | null; enrolled_at: string;
      meeting_pause_dismissed_at: string | null;
      smartlead_lead_id: number | null;
    }[];

    if (eligible.length) {
      // Resolve account_id for enrollments that only carry a contact_id
      // (contacts.account_id is NOT NULL, so every contact resolves).
      const missingAccountContactIds = Array.from(new Set(
        eligible.filter((e) => !e.account_id && e.contact_id).map((e) => e.contact_id as string),
      ));
      const contactToAccount = new Map<string, string>();
      const LOOKUP_BATCH = 500;
      for (let i = 0; i < missingAccountContactIds.length; i += LOOKUP_BATCH) {
        const batch = missingAccountContactIds.slice(i, i + LOOKUP_BATCH);
        const { data: contactRows, error: cErr } = await svc.from("contacts").select("id, account_id").in("id", batch);
        if (cErr) { console.error("daily-sweep: contact->account lookup failed:", cErr.message); continue; }
        for (const c of (contactRows ?? []) as { id: string; account_id: string | null }[]) {
          if (c.account_id) contactToAccount.set(c.id, c.account_id);
        }
      }

      const enrollmentAccountId = new Map<string, string>();
      for (const e of eligible) {
        const accId = e.account_id ?? (e.contact_id ? contactToAccount.get(e.contact_id) : undefined);
        if (accId) enrollmentAccountId.set(e.id, accId);
      }
      const relevantAccountIds = Array.from(new Set(Array.from(enrollmentAccountId.values())));

      // One batched query for open/won opportunities across every relevant
      // account (not one query per enrollment).
      const oppsByAccount = new Map<string, { created_at: string }[]>();
      for (let i = 0; i < relevantAccountIds.length; i += LOOKUP_BATCH) {
        const batch = relevantAccountIds.slice(i, i + LOOKUP_BATCH);
        const { data: opps, error: oErr } = await svc
          .from("opportunities")
          .select("account_id, created_at")
          .in("account_id", batch)
          .neq("stage", "closed_lost");
        if (oErr) { console.error("daily-sweep: opportunity lookup failed:", oErr.message); continue; }
        for (const o of (opps ?? []) as { account_id: string; created_at: string }[]) {
          const list = oppsByAccount.get(o.account_id) ?? [];
          list.push({ created_at: o.created_at });
          oppsByAccount.set(o.account_id, list);
        }
      }

      // Batch campaign owner/name lookups once rather than per-pause.
      const campaignIds = Array.from(new Set(eligible.map((e) => e.campaign_id)));
      const campaignInfo = new Map<string, { owner_user_id: string | null; name: string; smartlead_campaign_id: number | null }>();
      for (let i = 0; i < campaignIds.length; i += LOOKUP_BATCH) {
        const batch = campaignIds.slice(i, i + LOOKUP_BATCH);
        const { data: campRows, error: campErr } = await svc.from("campaigns").select("id, owner_user_id, name, smartlead_campaign_id").in("id", batch);
        if (campErr) { console.error("daily-sweep: campaign lookup for meeting-pause failed:", campErr.message); continue; }
        for (const c of (campRows ?? []) as { id: string; owner_user_id: string | null; name: string; smartlead_campaign_id: number | null }[]) {
          campaignInfo.set(c.id, { owner_user_id: c.owner_user_id, name: c.name, smartlead_campaign_id: c.smartlead_campaign_id });
        }
      }

      for (let i = 0; i < eligible.length; i++) {
        if (!hasBudget()) { report.skipped_for_budget += eligible.length - i; break; }
        const e = eligible[i];
        const accId = enrollmentAccountId.get(e.id);
        if (!accId) continue;
        const opps = oppsByAccount.get(accId) ?? [];
        // A qualifying opp must be newer than the enrollment AND newer than
        // any human dismissal of a previous meeting-booked pause — the
        // sweep used to re-pause a human-resumed enrollment every single
        // day for as long as the same opp stayed open (outside-review
        // group 2, docket I5). A genuinely NEW opportunity still pauses.
        const dismissedAt = e.meeting_pause_dismissed_at ? new Date(e.meeting_pause_dismissed_at) : null;
        const hasQualifyingOpp = opps.some((o) => {
          const created = new Date(o.created_at);
          return created > new Date(e.enrolled_at) && (!dismissedAt || created > dismissedAt);
        });
        if (!hasQualifyingOpp) continue;

        // Stop the actual sender before changing Pulse. A Pulse-only pause is
        // dangerously misleading because Smartlead would keep emailing.
        const info = campaignInfo.get(e.campaign_id);
        if (!info?.smartlead_campaign_id) {
          const message = `meeting-pause skipped for enrollment ${e.id}: campaign has no Smartlead id`;
          console.error(`daily-sweep: ${message}`);
          report.errors.push(message);
          continue;
        }
        let leadId = e.smartlead_lead_id;
        if (!leadId && e.email) {
          try {
            leadId = await resolveSmartleadLeadId(info.smartlead_campaign_id, e.email);
            if (leadId) {
              await svc.from("campaign_enrollments").update({ smartlead_lead_id: leadId }).eq("id", e.id);
            }
          } catch (err) {
            const message = `meeting-pause could not resolve Smartlead lead for enrollment ${e.id}: ${(err as Error).message}`;
            console.error(`daily-sweep: ${message}`);
            report.errors.push(message);
            continue;
          }
        }
        if (!leadId) {
          const message = `meeting-pause skipped for enrollment ${e.id}: Smartlead lead was not found`;
          console.error(`daily-sweep: ${message}`);
          report.errors.push(message);
          continue;
        }
        try {
          await smartleadSetLeadPauseState(info.smartlead_campaign_id, leadId, true);
        } catch (err) {
          const message = `meeting-pause failed in Smartlead for enrollment ${e.id}: ${(err as Error).message}`;
          console.error(`daily-sweep: ${message}`);
          report.errors.push(message);
          continue;
        }

        const { error: updErr } = await svc
          .from("campaign_enrollments")
          .update({ status: "paused", paused_reason: "meeting_booked" })
          .eq("id", e.id);
        if (updErr) {
          console.error(`daily-sweep: meeting-pause update failed for enrollment ${e.id}:`, updErr.message);
          continue;
        }
        report.tasks_cancelled += await archivePendingTasksForEnrollment(svc, e.id, "Opportunity opened");
        report.meetings_paused++;

        // Owner routing (group 2): notify the person's own owner; the
        // campaign owner is the fallback.
        const pauseNotifyUserId = e.owner_user_id ?? info?.owner_user_id ?? null;
        if (pauseNotifyUserId) {
          const who = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() || e.email || "A contact";
          const { error: notifErr } = await svc.from("notifications").insert({
            user_id: pauseNotifyUserId,
            type: "engagement",
            title: "Opportunity opened — sequence paused",
            // info can be undefined (campaign lookup batch failed / row
            // gone) now that the notify gate keys on the ENROLLMENT's owner
            // — an unguarded info.name here crashed the rest of step 3's
            // loop (final-sweep catch). The name is cosmetic; never throw
            // over it.
            message: `${who} has a new opportunity — paused their ${info?.name ?? "campaign"} sequence`,
            link: `/playbook?campaign=${e.campaign_id}`,
          });
          if (notifErr) console.error("daily-sweep: meeting-pause notification insert failed:", notifErr.message);
        }
      }
    }
  } catch (err) {
    console.error("daily-sweep: meeting-booked pause step failed:", (err as Error).message);
    report.errors.push("step 3 (meeting-booked pause): " + (err as Error).message);
  }

  // Steps 4-6 run in a daily-rotated order (docket I8): they share the
  // tail of the budget with no cursors of their own, so a fixed order made
  // the same steps the permanent losers whenever earlier steps ran long.
  // Rotation keys off the day number — deterministic, no stored state.
  const stepTaskSpawnCatchUp = async () => {
  // ---- 4. Task spawn catch-up ----------------------------------------
  try {
    const active = await fetchAllRows<{ id: string }>((from, to) =>
      svc.from("campaigns").select("id").eq("status", "active").order("id", { ascending: true }).range(from, to));
    for (let i = 0; i < (active?.length ?? 0); i++) {
      if (!hasBudget()) { report.skipped_for_budget += (active!.length - i); break; }
      const c = active![i];
      try {
        const spawned = await spawnCampaignTasks(c.id);
        report.tasks_created += spawned.tasksCreated;
      } catch (err) {
        console.error(`daily-sweep: task spawn catch-up failed for campaign ${c.id} (continuing):`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("daily-sweep: task spawn catch-up step failed:", (err as Error).message);
    report.errors.push("step 4 (task spawn catch-up): " + (err as Error).message);
  }

  };

  const stepWebhookHealth = async () => {
  // ---- 5. Webhook health ----------------------------------------------
  // Covers ALL active Smartlead-linked campaigns, including those whose
  // registration failed at launch and were saved webhook-less — the old
  // `.not("smartlead_webhook_id","is",null)` filter excluded exactly the
  // campaigns that most needed healing, leaving them permanently without
  // real-time replies (docket I1). Webhook-less rows register fresh;
  // unhealthy ones get their stale registration deleted (best-effort)
  // before the replacement, so a heal can never accumulate duplicates.
  try {
    const withWebhook = await fetchAllRows<Record<string, unknown>>((from, to) =>
      svc
        .from("campaigns")
        .select("id, smartlead_campaign_id, smartlead_webhook_id, webhook_secret")
        .eq("status", "active")
        .not("smartlead_campaign_id", "is", null)
        .order("id", { ascending: true })
        .range(from, to));
    for (let i = 0; i < (withWebhook?.length ?? 0); i++) {
      if (!hasBudget()) { report.skipped_for_budget += (withWebhook!.length - i); break; }
      const c = withWebhook![i] as { id: string; smartlead_campaign_id: number; smartlead_webhook_id: number | null; webhook_secret: string | null };
      try {
        const staleId = c.smartlead_webhook_id;
        if (staleId != null) {
          const healthy = await isWebhookHealthy(c.smartlead_campaign_id, staleId);
          if (healthy) continue;
        } else {
          // Webhook-less row: ADOPT any Pulse webhook already live on the
          // Smartlead side before registering — a blind nightly POST would
          // mint one duplicate per night whenever a past registration
          // succeeded but its id wasn't recognized (adversarial review).
          const existing = await findExistingPulseWebhook(c.smartlead_campaign_id);
          if (existing) {
            const { error: adoptErr } = await svc
              .from("campaigns")
              .update({
                smartlead_webhook_id: existing.id,
                ...(existing.token ? { webhook_secret: existing.token } : {}),
              })
              .eq("id", c.id);
            if (adoptErr) console.error(`daily-sweep: webhook adopt write failed for campaign ${c.id}:`, adoptErr.message);
            else {
              report.webhooks_healed++;
              // Audit the heal (docket I19): live updates silently coming
              // (back) online is worth a trail — it explains gaps in a
              // campaign's event history after the fact.
              await auditCampaignAction("campaign_webhook_healed", c.id, null, {
                mode: "adopted",
                webhook_id: existing.id,
              });
            }
            continue;
          }
        }
        const secret = c.webhook_secret ?? generateWebhookSecret();
        // Register FIRST, delete the stale one only after the replacement
        // lands (adversarial review): delete-first turned a health-check
        // false negative into destroying a working webhook.
        const newId = await registerCampaignWebhook(c.smartlead_campaign_id, secret);
        if (newId != null) {
          if (staleId != null && staleId !== newId) {
            try {
              await smartleadFetch(`/campaigns/${c.smartlead_campaign_id}/webhooks/${staleId}`, { method: "DELETE" });
            } catch { /* best-effort — a duplicate beats a destroyed working webhook */ }
          }
          const { error: healErr } = await svc.from("campaigns").update({ smartlead_webhook_id: newId, webhook_secret: secret }).eq("id", c.id);
          if (healErr) console.error(`daily-sweep: webhook heal write failed for campaign ${c.id}:`, healErr.message);
          else {
            report.webhooks_healed++;
            await auditCampaignAction("campaign_webhook_healed", c.id, null, {
              mode: staleId != null ? "replaced" : "registered",
              webhook_id: newId,
              ...(staleId != null ? { stale_webhook_id: staleId } : {}),
            });
          }
        }
      } catch (err) {
        console.warn(`daily-sweep: webhook heal failed for campaign ${c.id} (best-effort, continuing):`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("daily-sweep: webhook health step failed:", (err as Error).message);
    report.errors.push("step 5 (webhook health): " + (err as Error).message);
  }

  };

  const stepAutoComplete = async () => {
  // ---- 6. Auto-complete straggler enrollments -------------------------
  // Shared with interactive Sync. Stopped campaigns flip remaining active
  // enrollments and archive pending call/LinkedIn tasks. Completed campaigns
  // only flip enrollments whose manual touches are done; the rest stay
  // active so a later reply/unsubscribe can still land.
  try {
    const deadline = startedAt + SWEEP_BUDGET_MS;
    const reconciled = await reconcileTerminalEnrollments(deadline);
    report.enrollments_updated += reconciled.enrollments_updated;
    report.tasks_cancelled += reconciled.tasks_cancelled;
    report.skipped_for_budget += reconciled.capped;
  } catch (err) {
    console.error("daily-sweep: auto-complete step failed:", (err as Error).message);
    report.errors.push("step 6 (auto-complete): " + (err as Error).message);
  }

  };

  // Step 4 is PINNED first (adversarial review): it's the only one of the
  // three that's time-sensitive — it creates TODAY's call/LinkedIn tasks
  // for running campaigns, while webhook health and auto-complete are
  // idempotent catch-up. Only 5 and 6 rotate.
  await stepTaskSpawnCatchUp();
  const lateSteps = [stepWebhookHealth, stepAutoComplete];
  const rot = Math.floor(Date.now() / 86_400_000) % lateSteps.length;
  for (let k = 0; k < lateSteps.length; k++) {
    await lateSteps[(rot + k) % lateSteps.length]();
  }

  // ---- 7. AI insights (Campaigns overhaul Phase 4) ---------------------
  // Auto-generate campaign-insights (playbook-ai) for campaigns that have
  // enough data to be worth analyzing and haven't been yet: finished
  // campaigns (completed/stopped), or an active campaign that's already
  // sent to a meaningful number of people (>=20 — an active campaign can
  // keep accumulating sends for months, so this doesn't wait for it to
  // finish). Capped at SWEEP_INSIGHTS_CAP/run since each is a Claude call;
  // best-effort per campaign (one failure never blocks the rest of the
  // sweep or the campaigns already processed above).
  //
  // Server-to-server invocation: playbook-ai's isServiceRole gate accepts
  // any cryptographically-valid service_role JWT by its `role` claim (see
  // that function's doc comment) — same trust model this function's own
  // auth gate uses, and the same SERVICE_ROLE_KEY this function already
  // holds for its own `svc` client, so no new secret/GUC is needed here.
  try {
    if (hasBudget()) {
      // Two candidate sets (docket I12 — a campaign used to get exactly ONE
      // analysis ever, usually at ~20 sends, the thinnest possible data):
      //   (a) never analyzed — as before;
      //   (b) analyzed while still ACTIVE, now finished — re-analyzed once
      //       at completion, when the real results exist. settings
      //       .analysis_final marks "the finished-campaign analysis has
      //       run", stamped below after a successful (a)-or-(b) call on a
      //       finished campaign.
      type InsightCand = { id: string; status: string; metrics: Record<string, unknown> | null; settings: Record<string, unknown> | null };
      // Legacy snapshot rows are excluded outright (adversarial review):
      // after the I16 migration they're all 'completed', and analyzing an
      // empty steps/metrics husk burns a Claude call AND distils a
      // permanent training note from nothing.
      const neverAnalyzed = await fetchAllRows<InsightCand>((from, to) =>
        svc
          .from("campaigns")
          .select("id, status, metrics, settings")
          .is("analyzed_at", null)
          .in("status", ["completed", "stopped", "active"])
          .neq("origin", "legacy")
          .order("id", { ascending: true })
          .range(from, to));
      const finishedNeedingFinal = await fetchAllRows<InsightCand>((from, to) =>
        svc
          .from("campaigns")
          .select("id, status, metrics, settings")
          .not("analyzed_at", "is", null)
          .in("status", ["completed", "stopped"])
          .is("settings->>analysis_final", null)
          .neq("origin", "legacy")
          .order("id", { ascending: true })
          .range(from, to));
      const seenIds = new Set<string>();
      const candidates = [...neverAnalyzed, ...finishedNeedingFinal].filter((c) => {
        if (seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
      });

      const eligible = candidates
        .filter((c) => {
          // A finished campaign with zero sends has nothing to learn from
          // (adversarial review) — don't burn a Claude call on it.
          const sent = parseInt(String(c.metrics?.sent ?? ""), 10);
          if (c.status === "completed" || c.status === "stopped") return !isNaN(sent) && sent > 0;
          if (c.status === "active") return !isNaN(sent) && sent >= 20;
          return false;
        });

      for (let i = 0; i < eligible.length; i++) {
        if (i >= SWEEP_INSIGHTS_CAP || !hasBudget()) {
          report.skipped_for_budget += eligible.length - i;
          break;
        }
        const c = eligible[i];
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/playbook-ai`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "campaign-insights", campaign_id: c.id }),
          });
          const resBody = await res.json().catch(() => ({}));
          if (!res.ok || resBody?.error) {
            console.error(`daily-sweep: campaign-insights failed for campaign ${c.id}:`, resBody?.error ?? `HTTP ${res.status}`);
            continue;
          }
          report.insights_generated++;
          // A finished campaign's analysis is the FINAL one — mark it so
          // the (b) set above never re-queues it (docket I12). Merge RPC,
          // not spread-update (adversarial review): c.settings here was
          // read BEFORE a loop of per-campaign AI round trips — the widest
          // read→write gap in this file, exactly the clobber I36 closes.
          if (c.status !== "active") {
            const { error: finalErr } = await svc.rpc("campaign_settings_merge", {
              p_campaign_id: c.id,
              p_patch: { analysis_final: true },
            });
            if (finalErr) console.error(`daily-sweep: analysis_final stamp failed for campaign ${c.id}:`, finalErr.message);
          }
        } catch (err) {
          console.error(`daily-sweep: campaign-insights invoke failed for campaign ${c.id} (continuing):`, (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error("daily-sweep: insights step failed:", (err as Error).message);
    report.errors.push("step 7 (AI insights): " + (err as Error).message);
  }

  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "status";

    const svcCaller = isServiceRole(auth);
    // Service-role callers (the daily-sweep cron) get full access, same as
    // an admin, without an extra RPC round trip — they never carry a user
    // JWT for callerIsAdmin to check against anyway.
    const adminCaller = svcCaller ? true : await callerIsAdmin(auth);

    // Rep-access foundation (Campaigns overhaul Phase 5) — see
    // 20260723040000_campaigns_rep_access_rls.sql's header comment for the
    // full picture. Today NOTHING in the product UI lets a non-admin reach
    // this function (AdminGate on /playbook + the admin check in
    // ContactsList.tsx are the only ways a browser gets here), so this
    // branch is backend-ready but practically unreachable by a real rep
    // until that UI flip happens. When it does, a non-admin authenticated
    // caller may reach the three bounded builder reads below plus launch and
    // own-campaign/enrollment controls — see the ownership checks inside
    // launch()/setCampaignStatus()/setEnrollmentStatus(). Every mutation or
    // operational action outside that allowlist (import/sync/daily-sweep,
    // delete, diagnostics, inbox settings, suggestions, etc.) stays admin or
    // service-role only.
    const REP_ELIGIBLE_ACTIONS = new Set([
      "status",
      "email-accounts",
      "inbox-health",
      "launch",
      "add-recipients",
      "set-campaign-status",
      "set-enrollment-status",
    ]);
    let repUserId: string | null = null;
    if (!svcCaller && !adminCaller) {
      if (!REP_ELIGIBLE_ACTIONS.has(action)) {
        return json({ error: "Admin only" }, 403);
      }
      repUserId = await callerUserId(auth);
      if (!repUserId) return json({ error: "Admin only" }, 403);
    }
    // Audit identity (docket I19): resolved only for the actions that write
    // audit rows, and only for human callers — the sweep's service-role
    // calls record changed_by = null. Kept separate from userId, which must
    // stay null for admins (a non-null userId flips on rep ownership checks).
    const AUDITED_ACTIONS = new Set(["launch", "add-recipients", "set-campaign-status", "delete-campaign", "optout-add"]);
    const auditUserId = !svcCaller && AUDITED_ACTIONS.has(action) ? await callerUserId(auth) : null;
    const callerCtx: CallerContext = { isAdmin: adminCaller, userId: repUserId, auditUserId };

    if (action === "status") return json({ configured: smartleadConfigured() });
    // optout-add lives ABOVE the Smartlead-configured gate below
    // (adversarial review): it is a pure Postgres write with zero
    // Smartlead involvement, and prod today has no SMARTLEAD_API_KEY —
    // parking it under that gate made the admin button a guaranteed 500
    // in exactly the environment that needs manual opt-outs most.
    if (action === "optout-add") {
      // Manual marketing opt-out (docket I33) — the marketing_optouts table
      // supported reason='manual' from day one but nothing could WRITE one;
      // admins could only revoke. Admin/service-role only (not in
      // REP_ELIGIBLE_ACTIONS, so the dispatch gate above already enforces
      // it). Normalizes server-side; the table's CHECK would reject a
      // non-normalized email anyway.
      const email = normalizeEmail(String(body.email ?? ""));
      if (!email || !email.includes("@")) throw new Error("A valid email address is required.");
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;
      // unique(email, reason): an active manual row means already opted out;
      // a revoked one is re-activated (the admin is deliberately re-opting
      // the address out after an earlier Re-allow).
      const { data: existing, error: exErr } = await svc
        .from("marketing_optouts")
        .select("id, revoked_at")
        .eq("email", email)
        .eq("reason", "manual")
        .maybeSingle();
      if (exErr) throw new Error("Couldn't check the opt-out list: " + exErr.message);
      let optoutId: string;
      let reactivated = false;
      if (existing && !existing.revoked_at) {
        return json({ success: true, already_opted_out: true });
      } else if (existing) {
        const { error: updErr } = await svc
          .from("marketing_optouts")
          .update({ revoked_at: null, note, source: "manual" })
          .eq("id", existing.id);
        if (updErr) throw new Error("Couldn't re-activate the opt-out: " + updErr.message);
        optoutId = existing.id as string;
        reactivated = true;
      } else {
        const { data: ins, error: insOptErr } = await svc
          .from("marketing_optouts")
          .insert({ email, reason: "manual", source: "manual", note })
          .select("id")
          .single();
        if (insOptErr) {
          // Two admins opting out the same address at once: the loser of the
          // unique(email, reason) race gets 23505 for an operation that in
          // fact succeeded — report it as the success it is (adversarial
          // review), not a raw Postgres string in a toast.
          if ((insOptErr as { code?: string }).code === "23505") {
            return json({ success: true, already_opted_out: true });
          }
          throw new Error("Couldn't record the opt-out: " + insOptErr.message);
        }
        if (!ins) throw new Error("Couldn't record the opt-out: no row returned");
        optoutId = ins.id as string;
      }
      await auditCampaignAction("marketing_optout_add", optoutId, callerCtx.auditUserId, {
        email,
        reason: "manual",
        reactivated,
        ...(note ? { note } : {}),
      }, "marketing_optouts");
      return json({ success: true, reactivated });
    }
    // The daily-sweep cron gets a graceful 200 no-op instead of the 500
    // below (docket I15): a scheduled caller can't act on the error, and a
    // daily 500 in net._http_response reads like an outage when the truth
    // is just "this environment hasn't activated Smartlead yet" (prod
    // today). Interactive actions keep the loud 500 — a human can fix it.
    if (action === "daily-sweep" && !smartleadConfigured()) {
      console.warn("daily-sweep: SMARTLEAD_API_KEY not configured — nothing to sweep (skipping quietly)");
      return json({ skipped: "SMARTLEAD_API_KEY not configured — nothing to sweep" });
    }
    if (!smartleadConfigured()) return json({ error: "SMARTLEAD_API_KEY not configured" }, 500);

    if (action === "email-accounts") {
      // Never forward Smartlead's raw email-account objects to the browser:
      // they can contain SMTP/IMAP credentials and unrelated configuration.
      // The builder needs identity only; capacity/signature/warmup live in
      // the separately projected inbox-health response.
      const accounts = extractEmailAccountRows(await fetchEmailAccounts()).map((account) => ({
        id: Number(account.id),
        from_email: typeof account.from_email === "string" ? account.from_email : null,
        from_name: typeof account.from_name === "string" ? account.from_name : null,
      })).filter((account) => Number.isInteger(account.id) && account.id > 0);
      return json({ accounts });
    }
    if (action === "import") return json(await importCampaigns());
    if (action === "sync") return json(await syncCampaigns(Date.now() + 35_000));
    if (action === "refresh") return json(await refreshSmartlead());
    if (action === "daily-sweep") return json(await runDailySweepWithLog());
    if (action === "inbox-health") return json(await inboxHealth());
    if (action === "update-email-account-signature") {
      return json(await updateEmailAccountSignature(body.email_account_id, body.signature));
    }
    if (action === "update-email-account-daily-limit") {
      return json(await updateEmailAccountDailyLimit(body.email_account_id, body.daily_limit));
    }
    if (action === "launch") return json(await launch(body as unknown as LaunchInput, callerCtx));
    if (action === "add-recipients") {
      return json(await addRecipientsToExistingCampaign(body as unknown as AddRecipientsInput, callerCtx));
    }
    if (action === "set-campaign-status") {
      // Reuse the uid already fetched for a rep caller above; an admin/
      // service-role caller still needs one resolved fresh (archivedBy is
      // "who took this action", independent of the rep-eligibility check).
      const archivedBy = repUserId ?? await callerUserId(auth);
      return json(
        await setCampaignStatus(
          { id: body.id as string, action: body.status_action as SetStatusInput["action"] },
          archivedBy,
          callerCtx,
        ),
      );
    }
    if (action === "set-enrollment-status") {
      const archivedBy = repUserId ?? await callerUserId(auth);
      return json(
        await setEnrollmentStatus(
          { enrollment_id: body.enrollment_id as string, action: body.status_action as SetEnrollmentStatusInput["action"] },
          archivedBy,
          callerCtx,
        ),
      );
    }
    if (action === "delete-campaign") {
      // Delete a campaign in Smartlead AND remove the Pulse row. Used to
      // discard a draft. Smartlead delete is best-effort (a campaign may
      // already be gone); the Pulse row is always removed.
      const pulseId = body.id as string;
      const slId = body.smartlead_campaign_id as number | undefined;
      // Draft-only precondition (docket I18): the tracker only offers Delete
      // on drafts, but this handler used to delete ANY status when called
      // directly — killing a live send and orphaning its spawned tasks (the
      // activities keep their rows via ON DELETE SET NULL, but nothing
      // cancels them). Mirror the UI's rule server-side, same pattern as
      // setCampaignStatus's state preconditions. A missing row is success
      // (idempotent retry), not an error.
      let deleteStatus: string | null = null;
      if (pulseId) {
        const { data: statusRow, error: statusErr } = await svc
          .from("campaigns")
          .select("id, status")
          .eq("id", pulseId)
          .maybeSingle();
        if (statusErr) throw new Error("Couldn't check the campaign before deleting: " + statusErr.message);
        if (!statusRow) return json({ success: true, already_gone: true });
        deleteStatus = statusRow.status as string;
        if (deleteStatus !== "draft") {
          // Status 200 with an {error} body, NOT a 409 — supabase-js
          // collapses any non-2xx into a generic FunctionsHttpError, so the
          // client would toast "non-2xx status code" instead of this message
          // (adversarial review; same convention as every other user-facing
          // error this dispatcher returns).
          return json({
            error: "Only a draft campaign can be deleted. Stop it first if you want to end it — stopped campaigns stay in the record.",
          });
        }
      }
      // Best-effort webhook deregistration (Phase 2, S5) — look up
      // smartlead_webhook_id before the row is gone. Never fails the
      // overall delete; a leftover webhook just posts to a URL that will
      // 401 forever (no campaigns row will ever match its secret again).
      if (slId && pulseId) {
        try {
          const { data: campRow } = await svc
            .from("campaigns")
            .select("smartlead_webhook_id")
            .eq("id", pulseId)
            .maybeSingle();
          if (campRow?.smartlead_webhook_id) {
            try {
              await smartleadFetch(`/campaigns/${slId}/webhooks/${campRow.smartlead_webhook_id}`, { method: "DELETE" });
            } catch { /* best-effort */ }
          }
        } catch { /* best-effort */ }
      }
      if (slId) { try { await smartleadFetch(`/campaigns/${slId}`, { method: "DELETE" }); } catch { /* best-effort */ } }
      if (pulseId) {
        await svc.from("campaigns").delete().eq("id", pulseId);
        await auditCampaignAction("campaign_delete", pulseId, callerCtx.auditUserId, {
          status_at_delete: deleteStatus,
          smartlead_campaign_id: slId ?? null,
        });
      }
      return json({ success: true });
    }
    if (action === "mark-reply-handled") {
      // Reply feed "Mark handled" (Campaigns overhaul Phase 3, S9). Stamps a
      // `handled` object onto the campaign_events row's payload jsonb (the
      // feed reads it to dim/group the row and show who handled it) AND the
      // real handled_at column (outside-review I35 — the "N replies waiting"
      // tally filters on the column, see 20260731100000) in one UPDATE so
      // the two can never disagree. campaign_events is
      // service-role-write-only (see 20260722180000_campaign_events_engine.sql's
      // RLS: admin can SELECT, nothing else for `authenticated`), so a
      // client-side "mark handled" has to go through this action rather than
      // a direct table update.
      const eventId = typeof body.event_id === "string" ? body.event_id : "";
      const handledBy = await callerUserId(auth);
      const enrollmentId = typeof body.enrollment_id === "string" ? body.enrollment_id : null;
      const handledStamp = { at: new Date().toISOString(), by: handledBy };

      async function stampEvent(id: string, payload: Record<string, unknown> | null) {
        const nextPayload = { ...(payload ?? {}), handled: handledStamp };
        const { error: updErr } = await svc
          .from("campaign_events")
          .update({ payload: nextPayload, handled_at: handledStamp.at })
          .eq("id", id);
        if (updErr) throw new Error("Couldn't mark this reply handled: " + updErr.message);
      }

      let targetEnrollmentId: string | null = enrollmentId;
      if (eventId) {
        const { data: row, error: findErr } = await svc
          .from("campaign_events")
          .select("id, payload, enrollment_id")
          .eq("id", eventId)
          .single();
        if (findErr || !row) throw new Error("Reply not found: " + (findErr?.message ?? eventId));
        await stampEvent(row.id, (row.payload as Record<string, unknown> | null) ?? null);
        targetEnrollmentId = (row.enrollment_id as string | null) ?? targetEnrollmentId;
      } else if (enrollmentId) {
        const { data: rows, error: listErr } = await svc
          .from("campaign_events")
          .select("id, payload")
          .eq("enrollment_id", enrollmentId)
          .in("event_type", ["EMAIL_REPLY", "EMAIL_REPLIED"])
          .is("handled_at", null)
          .limit(20);
        if (listErr) throw new Error("Couldn't load replies to mark handled: " + listErr.message);
        for (const row of rows ?? []) {
          await stampEvent(row.id, (row.payload as Record<string, unknown> | null) ?? null);
        }
      } else {
        throw new Error("event_id is required");
      }

      // Completing the follow-up task is the same action as marking the
      // feed row handled: one reply, one queue.
      if (targetEnrollmentId) {
        const { error: taskErr } = await svc
          .from("activities")
          .update({ completed_at: handledStamp.at })
          .eq("campaign_enrollment_id", targetEnrollmentId)
          .eq("activity_type", "task")
          .is("campaign_step_number", null)
          .is("completed_at", null)
          .is("archived_at", null);
        if (taskErr) console.error("mark-reply-handled: follow-up complete failed:", taskErr.message);
      }
      return json({ success: true });
    }
    if (action === "lead-statuses") {
      // Diagnostic (Phase 3 verification): given a Pulse campaign id, return
      // every lead Smartlead has for that campaign with its OWN status field
      // — so we can independently confirm a per-person Stop actually paused
      // ONLY that lead on Smartlead's side (not the whole campaign, not
      // ignored). Reads the same /campaigns/{id}/leads listing
      // resolveSmartleadLeadId walks; returns email + id + every plausible
      // status-ish field so we don't guess the field name wrong. Also folds
      // in each lead's Pulse enrollment status for a side-by-side.
      const pulseId = body.id as string;
      if (!pulseId) throw new Error("id is required");
      const { data: campRow, error: campErr } = await svc
        .from("campaigns")
        .select("smartlead_campaign_id")
        .eq("id", pulseId)
        .single();
      if (campErr || !campRow?.smartlead_campaign_id) {
        throw new Error("Campaign not found or not linked to Smartlead: " + (campErr?.message ?? pulseId));
      }
      const { data: enrollments } = await svc
        .from("campaign_enrollments")
        .select("email, status, smartlead_lead_id")
        .eq("campaign_id", pulseId);
      const pulseByEmail = new Map<string, { status: string; smartlead_lead_id: number | null }>();
      for (const e of (enrollments ?? []) as { email: string; status: string; smartlead_lead_id: number | null }[]) {
        pulseByEmail.set(normalizeEmail(e.email), { status: e.status, smartlead_lead_id: e.smartlead_lead_id });
      }
      const leads: Array<Record<string, unknown>> = [];
      const PAGE = 100;
      for (let page = 0; page < 10; page++) {
        const res = await smartleadFetch(`/campaigns/${campRow.smartlead_campaign_id}/leads?offset=${page * PAGE}&limit=${PAGE}`);
        const rows = extractLeadRows(res);
        for (const raw of rows) {
          const lead = (typeof raw.lead === "object" && raw.lead !== null) ? raw.lead as Record<string, unknown> : raw;
          const email = String(lead.email ?? lead.lead_email ?? "");
          leads.push({
            email,
            smartlead_lead_id: lead.id ?? raw.lead_id ?? raw.campaign_lead_map_id ?? raw.id ?? null,
            // Every status-ish field Smartlead might use — we don't yet know
            // the exact one, so surface them all for inspection.
            status: raw.status ?? lead.status ?? null,
            is_paused: raw.is_paused ?? lead.is_paused ?? null,
            lead_category: raw.lead_category ?? lead.lead_category ?? null,
            pulse_status: pulseByEmail.get(normalizeEmail(email))?.status ?? null,
          });
        }
        if (rows.length < PAGE) break;
      }
      return json({ smartlead_campaign_id: campRow.smartlead_campaign_id, leads });
    }
    if (action === "webhook-status") {
      // Diagnostic (Phase 2, S5): given a Pulse campaign id, list that
      // Smartlead campaign's registered webhooks (raw API response) — for
      // verifying webhook-tier availability against a real Smartlead
      // account after deploy. Not used by any UI in this slice.
      const pulseId = body.id as string;
      if (!pulseId) throw new Error("id is required");
      const { data: campRow, error: campErr } = await svc
        .from("campaigns")
        .select("smartlead_campaign_id, smartlead_webhook_id, webhook_secret")
        .eq("id", pulseId)
        .single();
      if (campErr || !campRow?.smartlead_campaign_id) {
        throw new Error("Campaign not found or not linked to Smartlead: " + (campErr?.message ?? pulseId));
      }
      const webhooks = await smartleadFetch(`/campaigns/${campRow.smartlead_campaign_id}/webhooks`);
      return json({
        smartlead_campaign_id: campRow.smartlead_campaign_id,
        registered_webhook_id: campRow.smartlead_webhook_id,
        has_secret: !!campRow.webhook_secret,
        webhooks,
      });
    }
    if (action === "webhook-register") {
      // Diagnostic + repair (Phase 2): attempt webhook registration for an
      // EXISTING campaign, trying several plausible payload shapes, and
      // return every attempt's raw outcome instead of console-swallowing —
      // built to pin down the real registration payload Smartlead accepts
      // (the launch-time attempt failed silently on the first live test).
      // On the first attempt that yields a usable id, persists
      // smartlead_webhook_id + webhook_secret on the campaigns row.
      const pulseId = body.id as string;
      if (!pulseId) throw new Error("id is required");
      const { data: campRow, error: campErr } = await svc
        .from("campaigns")
        .select("smartlead_campaign_id, webhook_secret")
        .eq("id", pulseId)
        .single();
      if (campErr || !campRow?.smartlead_campaign_id) {
        throw new Error("Campaign not found or not linked to Smartlead: " + (campErr?.message ?? pulseId));
      }
      const secret = (campRow.webhook_secret as string | null) ?? generateWebhookSecret();
      // Adopt-then-register through the same shared routine the launch and
      // the nightly heal use (adversarial review — three diverging copies
      // of the registration logic is how the weak single-variant one
      // lingered in two of them).
      const existing = await findExistingPulseWebhook(campRow.smartlead_campaign_id as number);
      if (existing) {
        await svc
          .from("campaigns")
          .update({
            smartlead_webhook_id: existing.id,
            ...(existing.token ? { webhook_secret: existing.token } : {}),
          })
          .eq("id", pulseId);
        return json({ success: true, webhook_id: existing.id, adopted: true, attempts: [] });
      }
      const { id: webhookId, attempts } = await registerCampaignWebhookVariants(campRow.smartlead_campaign_id as number, secret);
      if (webhookId != null) {
        await svc
          .from("campaigns")
          .update({ smartlead_webhook_id: webhookId, webhook_secret: secret })
          .eq("id", pulseId);
        return json({ success: true, webhook_id: webhookId, attempts });
      }
      return json({ success: false, attempts });
    }
    if (action === "decide-suggestion") {
      // Apply/Dismiss a campaign_suggestions row from the Insights panel
      // (Campaigns overhaul Phase 4). campaign_suggestions is admin-read-only
      // via RLS (see 20260723020000_campaign_suggestions.sql) — same "table
      // is read-only for the client, edge function does the write" shape as
      // mark-reply-handled above. On 'applied', the caller (InsightsPanel /
      // useDecideSuggestion) has already written the actual template edit
      // via useSaveTemplate (client-side, campaign_templates IS
      // admin-writable directly); this action's job is just to stamp the
      // suggestion decided and log a training note so the "what got
      // applied and why" trail lives in the same place as every other
      // auto-training note.
      const id = body.id as string;
      const decision = body.decision as "applied" | "dismissed";
      if (!id) throw new Error("id is required");
      if (decision !== "applied" && decision !== "dismissed") {
        throw new Error("decision must be 'applied' or 'dismissed'");
      }
      const decidedBy = await callerUserId(auth);

      const { data: row, error: findErr } = await svc
        .from("campaign_suggestions")
        .select("id, status, kind, rationale, template:campaign_templates(name)")
        .eq("id", id)
        .maybeSingle();
      if (findErr) throw new Error(findErr.message);
      if (!row) throw new Error("Suggestion not found: " + id);
      if (row.status !== "pending") {
        // Already decided (double-click / stale UI) — report the existing
        // state rather than erroring or double-logging a training note.
        return json({ success: true, already_decided: true, status: row.status });
      }

      const { error: updErr } = await svc
        .from("campaign_suggestions")
        .update({ status: decision, decided_at: new Date().toISOString(), decided_by: decidedBy })
        .eq("id", id);
      if (updErr) throw new Error(updErr.message);

      if (decision === "applied") {
        // Same to-one-embedded-as-object runtime shape as useCampaigns'
        // `template:campaign_templates(name)` embed on the client (see that
        // query's comment) — cast through unknown for the same reason.
        const templateName = (row.template as unknown as { name: string } | null)?.name ?? "the template";
        const note = `Applied to ${templateName}: ${row.kind} change — ${row.rationale}`;
        const { error: noteErr } = await svc
          .from("playbook_training")
          .insert({ note, source: "suggestion_applied" });
        if (noteErr) {
          console.error(`decide-suggestion: training note insert failed for suggestion ${id}:`, noteErr.message);
        }
      }

      return json({ success: true, status: decision });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
