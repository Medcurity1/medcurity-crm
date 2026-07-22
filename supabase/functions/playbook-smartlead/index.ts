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
  buildSmartleadMetrics,
  mapSmartleadStatus,
} from "../_shared/smartlead.ts";
import {
  computeFirstSendDates,
  relativeStepOffsets,
  emailStepsToSmartleadSequence,
  taskDueAt,
} from "../_shared/campaign-scheduling.ts";
import { daysBetweenDateOnly, shiftEnrollmentTasks } from "../_shared/campaign-task-shift.ts";
import {
  ENROLLMENT_TERMINAL_STATUSES,
  archivePendingTasksForEnrollment,
  stopEnrollmentForBounce,
  stopEnrollmentForReply,
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
function partitionSuppressedEmails(
  emails: string[],
  suppression: { email: string; reason: string }[],
  overrides: string[],
): { eligible: Set<string>; dropped: string[]; overriddenCount: number } {
  const suppressedSet = new Set(suppression.map((r) => normalizeEmail(r.email)));
  const overrideSet = new Set(overrides.map(normalizeEmail));
  const eligible = new Set<string>();
  const dropped: string[] = [];
  let overriddenCount = 0;
  for (const raw of emails) {
    const key = normalizeEmail(raw);
    if (!key || !suppressedSet.has(key)) { eligible.add(key); continue; }
    if (overrideSet.has(key)) { eligible.add(key); overriddenCount++; }
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
  const out: { email: string; reason: string }[] = [];
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    const { data, error } = await svc
      .from("v_marketing_suppression")
      .select("email, reason")
      .in("email", batch);
    if (error) throw new Error("Suppression check failed: " + error.message);
    for (const row of (data ?? []) as { email: string; reason: string }[]) {
      out.push({ email: row.email, reason: row.reason });
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
  const out = new Set<string>();
  for (let i = 0; i < normalized.length; i += BATCH) {
    const batch = normalized.slice(i, i + BATCH);
    const { data, error } = await svc
      .from("campaign_enrollments")
      .select("email")
      .eq("status", "active")
      .in("email", batch);
    if (error) throw new Error("Enrollment check failed: " + error.message);
    for (const row of (data ?? []) as { email: string | null }[]) {
      if (row.email) out.add(normalizeEmail(row.email));
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
function mergeTemplate(tpl: string, vars: { first_name: string; last_name: string; company: string }): string {
  return tpl
    .replace(/\{\{\s*first_name\s*\}\}/gi, vars.first_name)
    .replace(/\{\{\s*last_name\s*\}\}/gi, vars.last_name)
    .replace(/\{\{\s*company\s*\}\}/gi, vars.company);
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

async function registerCampaignWebhook(smartleadCampaignId: number, secret: string): Promise<number | null> {
  try {
    const webhookUrl = `${SUPABASE_URL}/functions/v1/campaign-webhooks?token=${secret}`;
    const res = (await smartleadFetch(`/campaigns/${smartleadCampaignId}/webhooks`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        id: null,
        name: "Pulse campaign events",
        webhook_url: webhookUrl,
        event_types: SMARTLEAD_WEBHOOK_EVENT_TYPES,
      }),
    })) as Record<string, unknown>;
    const rawId = res?.id ?? res?.webhook_id
      ?? (res?.data as Record<string, unknown> | undefined)?.id;
    if (typeof rawId === "number") return rawId;
    if (typeof rawId === "string" && /^\d+$/.test(rawId)) return Number(rawId);
    console.warn("playbook launch: webhook registration returned no usable id; continuing webhook-less");
    return null;
  } catch (err) {
    console.warn("playbook launch: webhook registration failed (continuing webhook-less):", (err as Error).message);
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

async function importCampaigns() {
  const campaigns = await fetchCampaigns();
  if (!Array.isArray(campaigns)) throw new Error("Unexpected Smartlead response");
  let created = 0;
  let updated = 0;
  for (const camp of campaigns as Record<string, unknown>[]) {
    const campId = camp.id as number;
    const { data: existing } = await svc
      .from("campaigns")
      .select("id, status, metrics")
      .eq("smartlead_campaign_id", campId)
      .maybeSingle();

    let analytics: Record<string, unknown> = {};
    let sequences: unknown = [];
    try { analytics = (await fetchCampaignAnalytics(campId)) as Record<string, unknown>; } catch { /* ignore */ }
    try { sequences = await fetchCampaignSequences(campId); } catch { /* ignore */ }

    const metrics = buildSmartleadMetrics(analytics);
    const notes = notesFromSequences(sequences);
    const status = mapSmartleadStatus(camp.status as string);

    if (existing) {
      const merged = { ...(existing.metrics ?? {}), ...metrics };
      // Mirror Smartlead's status directly (bidirectional — Smartlead is
      // the source of truth for a linked campaign's send state, including
      // pause/resume, not just forward lifecycle progress).
      await svc.from("campaigns").update({ metrics: merged, status }).eq("id", existing.id);
      updated++;
    } else {
      await svc.from("campaigns").insert({
        name: (camp.name as string) || "Smartlead Campaign " + campId,
        origin: "smartlead_import",
        status,
        smartlead_campaign_id: campId,
        notes,
        metrics,
        steps: [],
      });
      created++;
    }
  }
  return { created, updated, total: campaigns.length };
}

async function syncCampaigns() {
  const { data: existing } = await svc
    .from("campaigns")
    .select("id, smartlead_campaign_id, status, metrics")
    .not("smartlead_campaign_id", "is", null);
  let synced = 0;
  for (const c of existing ?? []) {
    try {
      const camp = (await fetchCampaignById(c.smartlead_campaign_id)) as Record<string, unknown>;
      const analytics = (await fetchCampaignAnalytics(c.smartlead_campaign_id)) as Record<string, unknown>;
      const metrics = buildSmartleadMetrics(analytics);
      const merged = { ...(c.metrics ?? {}), ...metrics };
      const status = mapSmartleadStatus(camp.status as string);
      await svc.from("campaigns").update({ metrics: merged, status }).eq("id", c.id);
      synced++;
    } catch { /* skip this one */ }
  }
  return { synced };
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
    .select("id, first_name, last_name, company, email, first_send_at")
    .eq("campaign_id", campaignId)
    .eq("status", "active")
    .is("tasks_spawned_at", null)
    .not("first_send_at", "is", null);
  if (enrErr) {
    console.error("spawnCampaignTasks: couldn't load enrollments:", enrErr.message);
    return { tasksCreated: 0 };
  }
  if (!enrollments?.length) return { tasksCreated: 0 };

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
    const vars = {
      // A blank first name reads as "Call " (trailing space, no name at
      // all) in a spawned task title — fall back to the email address so
      // the task is always identifiable ("Call jane@clinic.org").
      first_name: (e.first_name as string) || (e.email as string) || "",
      last_name: (e.last_name as string) || "",
      company: (e.company as string) || "",
    };
    const rows: Record<string, unknown>[] = [];
    for (const step of nonEmailSteps) {
      if (existingPairs.has(`${e.id}:${step.order}`)) continue;
      const relOffset = offsets.get(step.order) ?? 0;
      const dueAt = taskDueAt(e.first_send_at as string, relOffset, step.send_window_start);
      const note = mergeTemplate(step.task_note_template || "", vars);
      rows.push({
        activity_type: "task",
        owner_user_id: campaign.owner_user_id,
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
): Promise<{ tasksCancelled: number }> {
  const { data: enrollments, error: enrErr } = await svc
    .from("campaign_enrollments")
    .select("id")
    .eq("campaign_id", campaignId);
  if (enrErr) {
    console.error("cancelPendingCampaignTasks: couldn't load enrollments:", enrErr.message);
    return { tasksCancelled: 0 };
  }
  const enrollmentIds = (enrollments ?? []).map((e) => e.id as string);
  if (!enrollmentIds.length) return { tasksCancelled: 0 };

  let cancelled = 0;
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
      continue;
    }
    cancelled += taskIds.length;
  }
  return { tasksCancelled: cancelled };
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
async function setCampaignStatus(p: SetStatusInput, archivedBy: string | null) {
  if (!p.id || !p.action || !(p.action in SMARTLEAD_STATUS_FOR_ACTION)) {
    throw new Error("id and a valid action (start|pause|resume|stop) are required");
  }
  const { data: campaign, error: campErr } = await svc
    .from("campaigns")
    .select("id, status, smartlead_campaign_id, leads_per_day, settings, anchor_date")
    .eq("id", p.id)
    .single();
  if (campErr || !campaign) throw new Error("Campaign not found: " + (campErr?.message ?? p.id));

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
  let warning: string | undefined;

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

    await svc
      .from("campaigns")
      .update(isDraft ? { anchor_date: anchorDate, status: newStatus } : { status: newStatus })
      .eq("id", p.id);

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
      warning =
        "The campaign started, but scheduling its call/LinkedIn tasks hit a snag — pause and resume it to finish scheduling.";
    }
  } else if (p.action === "stop") {
    await svc.from("campaigns").update({ status: newStatus }).eq("id", p.id);
    await svc
      .from("campaign_enrollments")
      .update({ status: "stopped" })
      .eq("campaign_id", p.id)
      .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`);
    const result = await cancelPendingCampaignTasks(p.id, archivedBy);
    tasksCancelled = result.tasksCancelled;
  } else {
    // pause, resume, or start-on-a-non-draft (defensive no-op path above).
    await svc.from("campaigns").update({ status: newStatus }).eq("id", p.id);
  }

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
 * Best-effort pause/resume of ONE lead within a Smartlead campaign — the
 * per-person analog of setCampaignStatus's campaign-wide POST
 * /campaigns/{id}/status. Endpoint shape unverified beyond "matches the
 * /campaigns/{id}/leads/{lead_id}/<verb> pattern Smartlead's own docs
 * describe for pause/resume-by-lead" — same unverified-but-best-guess
 * posture as registerCampaignWebhook. Throws on failure (raw Smartlead error
 * message) so the caller can fold it into a plain-English `warning` — this
 * must NEVER be swallowed silently on the stop path per the spec.
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
async function setEnrollmentStatus(p: SetEnrollmentStatusInput, archivedBy: string | null) {
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
    .select("id, name, smartlead_campaign_id")
    .eq("id", enrollment.campaign_id)
    .single();
  if (cErr || !campaign) throw new Error("Campaign not found: " + (cErr?.message ?? enrollment.campaign_id));

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
    const { error } = await svc
      .from("campaign_enrollments")
      .update({ status: "active", paused_reason: null })
      .eq("id", enrollment.id);
    if (error) throw new Error("Couldn't resume this person: " + error.message);
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
async function launch(p: LaunchInput) {
  const usingSteps = Array.isArray(p.steps) && p.steps.length > 0;
  if (!p.campaign_name || !p.recipients?.length || (!usingSteps && !p.sequence?.length)) {
    throw new Error("campaign_name, a sequence (or steps), and recipients are required");
  }
  const delay = () => new Promise((r) => setTimeout(r, 300));

  // Mixed-channel launch (template gallery / SequenceEditor "Launch this
  // sequence"): p.steps is the frozen source of truth — subject/body edits
  // made in the wizard are already folded into it client-side. Derive
  // Smartlead's flat email sequence FROM it and ignore p.sequence entirely.
  // AI-wizard launch (no p.steps): p.sequence drives Smartlead directly and
  // sequenceToSteps() backfills campaigns.steps for the tracker.
  const steps: CampaignStep[] = usingSteps
    ? p.steps!
    : (sequenceToSteps(p.sequence!) as unknown as CampaignStep[]);
  const emailSequence: Array<Record<string, unknown>> = usingSteps
    ? (emailStepsToSmartleadSequence(steps) as unknown as Array<Record<string, unknown>>)
    : p.sequence!;

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
  let tasksCreated = 0;
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
    const maxNewLeadsPerDay = Number(p.schedule?.max_new_leads_per_day) || 25;
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

    // 5.5. No-double-enroll rail (S3): is this email ALREADY actively
    // enrolled in ANY campaign (not just this one)? Mirrors the suppression
    // rail immediately above — same batch/override/all-dropped pattern,
    // different source table. Someone already receiving one cadence
    // shouldn't silently be dropped into a second at the same time unless a
    // human deliberately says so (enrollment_overrides).
    const enrollmentChecked = recipients.length;
    const activeEnrollmentEmails = await fetchActiveEnrollmentEmails(recipients.map((r) => r.email));
    const enrollmentOverrideSet = new Set(
      (Array.isArray(p.enrollment_overrides) ? p.enrollment_overrides : []).map(normalizeEmail),
    );
    let alreadyActiveOverridden = 0;
    const enrollableRecipients = recipients.filter((r) => {
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
    const batchSize = 400;
    const totalBatches = Math.ceil(enrollableRecipients.length / batchSize);
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
      if (ok) leadsAdded += batch.length;
      else leadsFailed += batch.length;
      if (i < totalBatches - 1) await delay();
    }
    if (leadsAdded === 0 && leadsFailed > 0) {
      throw new Error("All lead batches failed; campaign created but has no leads.");
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
        },
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw new Error("Smartlead campaign created but the Pulse record failed: " + (insErr?.message ?? "unknown"));
    }
    pulseCampaignId = inserted.id;

    // 7.5. Enrollments (S3) — one row per person actually added to Smartlead
    // above, in upload order (enroll_position drives the throttle math).
    // Always inserted with first_send_at = NULL; it's only computed once we
    // know sending has actually started (step 10 below) — a draft
    // campaign's enrollments stay NULL until a later "Start" action
    // computes it fresh (S4, not built in this slice).
    //
    // Failure here is FATAL: the catch below deletes the just-created
    // campaigns row too (not just the Smartlead campaign), which cascades
    // to any enrollments already inserted (campaign_enrollments.campaign_id
    // is ON DELETE CASCADE, 20260625000001).
    const enrollmentRows = enrollableRecipients.map((r, i) => ({
      campaign_id: pulseCampaignId,
      contact_id: r.contact_id ?? null,
      account_id: r.account_id ?? null, // tag-source recipients carry it; CSV/paste don't (no lookup in v1)
      owner_user_id: p.owner_id ?? null,
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
    // Non-fatal: a bad FK in one row shouldn't fail the whole launch.
    const subject = String(emailSequence[0]?.subject ?? p.campaign_name);
    const acts = enrollableRecipients
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
        await svc.from("campaigns").update({ status: "active" }).eq("id", pulseCampaignId);
        try {
          await backfillFirstSendDates(insertedEnrollments, anchorDate, maxNewLeadsPerDay, sendDays);
          const spawned = await spawnCampaignTasks(pulseCampaignId);
          tasksCreated = spawned.tasksCreated;
        } catch (postErr) {
          console.error(
            "playbook launch: post-start task spawn failed (campaign is live; not rolling back):",
            (postErr as Error).message,
          );
        }
      } catch { /* leave as draft */ }
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
    throw err;
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
  };
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
}

const SWEEP_BUDGET_MS = 100_000; // stop starting new campaign work after ~100s (150s edge limit)
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

  const categoryRaw = raw.category ?? raw.lead_category ?? raw.category_name ?? raw.reply_category;
  const category = typeof categoryRaw === "string" && categoryRaw.trim() ? categoryRaw.trim() : null;

  return { email: email || null, sentAt, repliedAt, bouncedAt, category };
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
 * Bounce is checked before reply (mutually exclusive in practice; bounce is
 * the more terminal signal if a payload somehow carried both).
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

  const { data: enrollments, error } = await svc
    .from("campaign_enrollments")
    .select("id, contact_id, account_id, first_name, last_name, email, status, first_send_at, reply_category")
    .eq("campaign_id", campaign.id)
    .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`);
  if (error) throw new Error("Enrollment lookup for reconcile failed: " + error.message);
  if (!enrollments?.length) return { enrollmentsUpdated: 0, repliesDetected: 0, tasksCancelled: 0 };

  const campaignForActions = { id: campaign.id, name: campaign.name, owner_user_id: campaign.owner_user_id };

  let enrollmentsUpdated = 0;
  let repliesDetected = 0;
  let tasksCancelled = 0;

  for (const e of enrollments as {
    id: string; contact_id: string | null; account_id: string | null;
    first_name: string | null; last_name: string | null; email: string | null;
    status: string; first_send_at: string | null; reply_category: string | null;
  }[]) {
    const key = e.email ? normalizeEmail(e.email) : "";
    const row = key ? byEmail.get(key) : undefined;
    if (!row) continue;

    // Category (S9) — independent of the reply/bounce/sent branches below;
    // a category can arrive on the same statistics row as a reply, or on its
    // own before/after one.
    if (row.category && row.category !== e.reply_category) {
      const { error: catErr } = await svc
        .from("campaign_enrollments")
        .update({ reply_category: row.category })
        .eq("id", e.id);
      if (catErr) console.error(`daily-sweep: reply_category update failed for enrollment ${e.id}:`, catErr.message);
    }

    // (c) bounce — checked first; a bounced lead never sends a real reply.
    if (row.bouncedAt) {
      const result = await stopEnrollmentForBounce(svc, e, campaign.id, { occurredAt: row.bouncedAt, source: "daily-sweep" });
      if (result.updated) {
        enrollmentsUpdated++;
        tasksCancelled += result.tasksCancelled;
      }
      continue;
    }

    // (b) reply
    if (row.repliedAt) {
      const result = await stopEnrollmentForReply(svc, e, campaignForActions, null, e.email, { occurredAt: row.repliedAt, source: "daily-sweep" });
      if (result.updated) {
        enrollmentsUpdated++;
        repliesDetected++;
        tasksCancelled += result.tasksCancelled;
      }
      continue;
    }

    // (a) first-send date reconcile
    if (row.sentAt) {
      const sentDate = row.sentAt.slice(0, 10);
      const mismatched = !e.first_send_at || e.first_send_at.slice(0, 10) !== sentDate;
      if (mismatched) {
        const delta = e.first_send_at ? daysBetweenDateOnly(e.first_send_at, row.sentAt) : 0;
        const { error: updErr } = await svc
          .from("campaign_enrollments")
          .update({ first_send_at: sentDate })
          .eq("id", e.id);
        if (updErr) {
          console.error(`daily-sweep: first_send_at correction failed for enrollment ${e.id}:`, updErr.message);
          continue;
        }
        if (delta !== 0) await shiftEnrollmentTasks(svc, e.id, delta);
        enrollmentsUpdated++;
      }
    }
  }

  return { enrollmentsUpdated, repliesDetected, tasksCancelled };
}

/** Extract a plausible array of webhook objects from Smartlead's
 *  GET /campaigns/{id}/webhooks response (same "check data/webhooks/rows,
 *  fall back to top-level array" defensiveness as extractStatRows /
 *  webhook-status's raw passthrough). */
function extractWebhookRows(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  if (typeof res !== "object" || res === null) return [];
  const obj = res as Record<string, unknown>;
  for (const key of ["data", "webhooks", "rows"]) {
    if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
  }
  return [];
}

/** Is our webhook still registered AND not explicitly disabled on this
 *  Smartlead campaign? On an uncertain check (fetch failure, unrecognized
 *  response shape) this returns true — a false negative here would attempt
 *  to register a SECOND webhook alongside a perfectly healthy first one,
 *  which is worse than skipping a heal for one day. */
async function isWebhookHealthy(smartleadCampaignId: number, webhookId: number): Promise<boolean> {
  try {
    const res = await smartleadFetch(`/campaigns/${smartleadCampaignId}/webhooks`);
    const rows = extractWebhookRows(res);
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
  };

  // ---- 1. Metrics + status refresh ---------------------------------
  try {
    const { synced } = await syncCampaigns();
    report.campaigns_synced = synced;
  } catch (err) {
    console.error("daily-sweep: metrics/status sync failed:", (err as Error).message);
  }

  // ---- 2. Per-lead reconcile (cap 25/run, oldest-swept-first) ------
  try {
    const { data: activeCampaigns, error: activeErr } = await svc
      .from("campaigns")
      .select("id, name, owner_user_id, smartlead_campaign_id, settings")
      .eq("status", "active")
      .not("smartlead_campaign_id", "is", null);
    if (activeErr) throw new Error(activeErr.message);

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
      }
      reconciledThisRun++;

      const nextSettings = { ...(camp.settings ?? {}), last_sweep_at: new Date().toISOString() };
      const { error: settingsErr } = await svc.from("campaigns").update({ settings: nextSettings }).eq("id", camp.id);
      if (settingsErr) console.error(`daily-sweep: last_sweep_at update failed for campaign ${camp.id}:`, settingsErr.message);
    }
  } catch (err) {
    console.error("daily-sweep: per-lead reconcile step failed:", (err as Error).message);
  }

  // ---- 3. Meeting-booked pause --------------------------------------
  try {
    const { data: candidates, error: candErr } = await svc
      .from("campaign_enrollments")
      .select("id, campaign_id, contact_id, account_id, first_name, last_name, email, status, paused_reason, enrolled_at")
      .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`)
      .or("contact_id.not.is.null,account_id.not.is.null");
    if (candErr) throw new Error(candErr.message);

    const eligible = (candidates ?? []).filter(
      (e) => !(e.status === "paused" && e.paused_reason === "meeting_booked"),
    ) as {
      id: string; campaign_id: string; contact_id: string | null; account_id: string | null;
      first_name: string | null; last_name: string | null; email: string | null;
      status: string; paused_reason: string | null; enrolled_at: string;
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
      const campaignInfo = new Map<string, { owner_user_id: string | null; name: string }>();
      for (let i = 0; i < campaignIds.length; i += LOOKUP_BATCH) {
        const batch = campaignIds.slice(i, i + LOOKUP_BATCH);
        const { data: campRows, error: campErr } = await svc.from("campaigns").select("id, owner_user_id, name").in("id", batch);
        if (campErr) { console.error("daily-sweep: campaign lookup for meeting-pause failed:", campErr.message); continue; }
        for (const c of (campRows ?? []) as { id: string; owner_user_id: string | null; name: string }[]) {
          campaignInfo.set(c.id, { owner_user_id: c.owner_user_id, name: c.name });
        }
      }

      for (let i = 0; i < eligible.length; i++) {
        if (!hasBudget()) { report.skipped_for_budget += eligible.length - i; break; }
        const e = eligible[i];
        const accId = enrollmentAccountId.get(e.id);
        if (!accId) continue;
        const opps = oppsByAccount.get(accId) ?? [];
        const hasQualifyingOpp = opps.some((o) => new Date(o.created_at) > new Date(e.enrolled_at));
        if (!hasQualifyingOpp) continue;

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

        const info = campaignInfo.get(e.campaign_id);
        if (info?.owner_user_id) {
          const who = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim() || e.email || "A contact";
          const { error: notifErr } = await svc.from("notifications").insert({
            user_id: info.owner_user_id,
            type: "engagement",
            title: "Opportunity opened — sequence paused",
            message: `${who} has a new opportunity — paused their ${info.name} sequence`,
            link: `/playbook?campaign=${e.campaign_id}`,
          });
          if (notifErr) console.error("daily-sweep: meeting-pause notification insert failed:", notifErr.message);
        }
      }
    }
  } catch (err) {
    console.error("daily-sweep: meeting-booked pause step failed:", (err as Error).message);
  }

  // ---- 4. Task spawn catch-up ----------------------------------------
  try {
    const { data: active, error: activeErr } = await svc.from("campaigns").select("id").eq("status", "active");
    if (activeErr) throw new Error(activeErr.message);
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
  }

  // ---- 5. Webhook health ----------------------------------------------
  try {
    const { data: withWebhook, error: whErr } = await svc
      .from("campaigns")
      .select("id, smartlead_campaign_id, smartlead_webhook_id, webhook_secret")
      .eq("status", "active")
      .not("smartlead_campaign_id", "is", null)
      .not("smartlead_webhook_id", "is", null);
    if (whErr) throw new Error(whErr.message);
    for (let i = 0; i < (withWebhook?.length ?? 0); i++) {
      if (!hasBudget()) { report.skipped_for_budget += (withWebhook!.length - i); break; }
      const c = withWebhook![i] as { id: string; smartlead_campaign_id: number; smartlead_webhook_id: number; webhook_secret: string | null };
      try {
        const healthy = await isWebhookHealthy(c.smartlead_campaign_id, c.smartlead_webhook_id);
        if (healthy) continue;
        const secret = c.webhook_secret ?? generateWebhookSecret();
        const newId = await registerCampaignWebhook(c.smartlead_campaign_id, secret);
        if (newId != null) {
          await svc.from("campaigns").update({ smartlead_webhook_id: newId, webhook_secret: secret }).eq("id", c.id);
          report.webhooks_healed++;
        }
      } catch (err) {
        console.warn(`daily-sweep: webhook heal failed for campaign ${c.id} (best-effort, continuing):`, (err as Error).message);
      }
    }
  } catch (err) {
    console.error("daily-sweep: webhook health step failed:", (err as Error).message);
  }

  // ---- 6. Auto-complete straggler enrollments -------------------------
  try {
    const { data: doneCampaigns, error: doneErr } = await svc
      .from("campaigns")
      .select("id")
      .in("status", ["completed", "stopped"]);
    if (doneErr) throw new Error(doneErr.message);
    for (const c of doneCampaigns ?? []) {
      if (!hasBudget()) { report.skipped_for_budget++; break; }
      const { data: stragglers, error: findErr } = await svc
        .from("campaign_enrollments")
        .select("id")
        .eq("campaign_id", c.id)
        .eq("status", "active");
      if (findErr) {
        console.error(`daily-sweep: auto-complete straggler lookup failed for campaign ${c.id}:`, findErr.message);
        continue;
      }
      const ids = (stragglers ?? []).map((e) => e.id as string);
      if (!ids.length) continue;
      const { error: updErr } = await svc.from("campaign_enrollments").update({ status: "completed" }).in("id", ids);
      if (updErr) {
        console.error(`daily-sweep: auto-complete update failed for campaign ${c.id}:`, updErr.message);
        continue;
      }
      report.enrollments_updated += ids.length;
      for (const id of ids) {
        report.tasks_cancelled += await archivePendingTasksForEnrollment(svc, id, "Campaign completed");
      }
    }
  } catch (err) {
    console.error("daily-sweep: auto-complete step failed:", (err as Error).message);
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
      const { data: candidates, error: candErr } = await svc
        .from("campaigns")
        .select("id, status, metrics")
        .is("analyzed_at", null)
        .in("status", ["completed", "stopped", "active"]);
      if (candErr) throw new Error(candErr.message);

      const eligible = ((candidates ?? []) as { id: string; status: string; metrics: Record<string, unknown> | null }[])
        .filter((c) => {
          if (c.status === "completed" || c.status === "stopped") return true;
          if (c.status === "active") {
            const sent = parseInt(String(c.metrics?.sent ?? ""), 10);
            return !isNaN(sent) && sent >= 20;
          }
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
        } catch (err) {
          console.error(`daily-sweep: campaign-insights invoke failed for campaign ${c.id} (continuing):`, (err as Error).message);
        }
      }
    }
  } catch (err) {
    console.error("daily-sweep: insights step failed:", (err as Error).message);
  }

  return report;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!isServiceRole(auth) && !(await callerIsAdmin(auth))) {
      return json({ error: "Admin only" }, 403);
    }
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "status";

    if (action === "status") return json({ configured: smartleadConfigured() });
    if (!smartleadConfigured()) return json({ error: "SMARTLEAD_API_KEY not configured" }, 500);

    if (action === "email-accounts") {
      const accounts = await fetchEmailAccounts();
      return json({ accounts: accounts as unknown[] });
    }
    if (action === "import") return json(await importCampaigns());
    if (action === "sync") return json(await syncCampaigns());
    if (action === "daily-sweep") return json(await dailySweep());
    if (action === "launch") return json(await launch(body as unknown as LaunchInput));
    if (action === "set-campaign-status") {
      const archivedBy = await callerUserId(auth);
      return json(
        await setCampaignStatus(
          { id: body.id as string, action: body.status_action as SetStatusInput["action"] },
          archivedBy,
        ),
      );
    }
    if (action === "set-enrollment-status") {
      const archivedBy = await callerUserId(auth);
      return json(
        await setEnrollmentStatus(
          { enrollment_id: body.enrollment_id as string, action: body.status_action as SetEnrollmentStatusInput["action"] },
          archivedBy,
        ),
      );
    }
    if (action === "delete-campaign") {
      // Delete a campaign in Smartlead AND remove the Pulse row. Used to
      // discard a draft. Smartlead delete is best-effort (a campaign may
      // already be gone); the Pulse row is always removed.
      const pulseId = body.id as string;
      const slId = body.smartlead_campaign_id as number | undefined;
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
      if (pulseId) await svc.from("campaigns").delete().eq("id", pulseId);
      return json({ success: true });
    }
    if (action === "mark-reply-handled") {
      // Reply feed "Mark handled" (Campaigns overhaul Phase 3, S9). Rather
      // than a new column/table, this stamps a `handled` object onto the
      // campaign_events row's own payload jsonb — campaign_events is
      // service-role-write-only (see 20260722180000_campaign_events_engine.sql's
      // RLS: admin can SELECT, nothing else for `authenticated`), so a
      // client-side "mark handled" has to go through this action rather than
      // a direct table update. The Replies feed (useCampaignReplies) reads
      // `payload.handled` to dim/group the row.
      const eventId = body.event_id as string;
      if (!eventId) throw new Error("event_id is required");
      const handledBy = await callerUserId(auth);
      const { data: row, error: findErr } = await svc
        .from("campaign_events")
        .select("id, payload")
        .eq("id", eventId)
        .single();
      if (findErr || !row) throw new Error("Reply not found: " + (findErr?.message ?? eventId));
      const nextPayload = {
        ...((row.payload as Record<string, unknown> | null) ?? {}),
        handled: { at: new Date().toISOString(), by: handledBy },
      };
      const { error: updErr } = await svc.from("campaign_events").update({ payload: nextPayload }).eq("id", eventId);
      if (updErr) throw new Error("Couldn't mark this reply handled: " + updErr.message);
      return json({ success: true });
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
          const res = (await smartleadFetch(`/campaigns/${campRow.smartlead_campaign_id}/webhooks`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify(payload),
          })) as Record<string, unknown>;
          attempts.push({ payload_keys: Object.keys(payload), ok: true, response: res });
          const rawId = res?.id ?? res?.webhook_id ?? (res?.data as Record<string, unknown> | undefined)?.id;
          const webhookId = typeof rawId === "number"
            ? rawId
            : (typeof rawId === "string" && /^\d+$/.test(rawId) ? Number(rawId) : null);
          if (webhookId != null) {
            await svc
              .from("campaigns")
              .update({ smartlead_webhook_id: webhookId, webhook_secret: secret })
              .eq("id", pulseId);
            return json({ success: true, webhook_id: webhookId, attempts });
          }
        } catch (err) {
          attempts.push({ payload_keys: Object.keys(payload), ok: false, error: (err as Error).message });
        }
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
