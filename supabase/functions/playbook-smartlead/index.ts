// playbook-smartlead Edge Function — Smartlead read + write path (ported
// from Nexus server.js). Actions:
//   - status        : is Smartlead configured?
//   - email-accounts: list sending inboxes (for the campaign wizard)
//   - import        : pull all Smartlead campaigns -> campaigns
//                     (create new, refresh metrics/status on existing;
//                     preserves user-edited name/notes on update)
//   - sync          : refresh metrics + status on already-imported campaigns
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
    .select("id, first_name, last_name, company, first_send_at")
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
      first_name: (e.first_name as string) || "",
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
const ENROLLMENT_TERMINAL_STATUSES = ["completed", "stopped", "replied", "bounced"];

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
    if (action === "delete-campaign") {
      // Delete a campaign in Smartlead AND remove the Pulse row. Used to
      // discard a draft. Smartlead delete is best-effort (a campaign may
      // already be gone); the Pulse row is always removed.
      const pulseId = body.id as string;
      const slId = body.smartlead_campaign_id as number | undefined;
      if (slId) { try { await smartleadFetch(`/campaigns/${slId}`, { method: "DELETE" }); } catch { /* best-effort */ } }
      if (pulseId) await svc.from("campaigns").delete().eq("id", pulseId);
      return json({ success: true });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
