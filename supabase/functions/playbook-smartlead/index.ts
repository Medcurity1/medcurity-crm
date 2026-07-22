// playbook-smartlead Edge Function — Smartlead read + write path (ported
// from Nexus server.js). Actions:
//   - status        : is Smartlead configured?
//   - email-accounts: list sending inboxes (for the campaign wizard)
//   - import        : pull all Smartlead campaigns -> campaigns
//                     (create new, refresh metrics/status on existing;
//                     preserves user-edited name/notes on update)
//   - sync          : refresh metrics + status on already-imported campaigns
//   - launch        : create + start a campaign in Smartlead, record it
//   - delete-campaign: delete in Smartlead + remove the Pulse row
//
// Campaigns unification (2026-07-22): reads/writes `campaigns`, not the
// retired `playbook_campaigns` (now playbook_campaigns_archived_20260722 —
// see 20260722100000_campaigns_unify.sql).
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
 *  cumulative). Every launch gets real step data instead of an empty array. */
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
  sequence: Array<Record<string, unknown>>;
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
}

/**
 * Launch a campaign into Smartlead (ported from server.js:3294-3541):
 * create -> sequence (rollback/delete on failure) -> schedule -> attach
 * inbox -> suppression re-check -> add leads (400-batch) -> optionally
 * START. autoStart defaults to FALSE so the campaign lands as a Smartlead
 * DRAFT (no emails sent) until the user reviews + starts it. On success,
 * records the campaign in Pulse and logs an email_sent activity on each
 * linked contact (suppressed/dropped recipients excluded from both).
 */
async function launch(p: LaunchInput) {
  if (!p.campaign_name || !p.sequence?.length || !p.recipients?.length) {
    throw new Error("campaign_name, sequence, and recipients are required");
  }
  const delay = () => new Promise((r) => setTimeout(r, 300));

  // 1. Create
  const createRes = (await smartleadFetch("/campaigns/create", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: p.campaign_name }),
  })) as { id: number };
  const campaignId = createRes.id;
  await delay();

  // Everything after the create is wrapped: any failure best-effort DELETES
  // the just-created Smartlead campaign, so we never leave an orphaned
  // campaign behind and a retry starts clean.
  let leadsAdded = 0;
  let leadsFailed = 0;
  let autoStarted = false;
  let pulseCampaignId: string | null = null;
  // Declared outside the try so the final return (after the try/catch) can
  // report it even though it's only computed inside — see step 5 below.
  let suppressionDropped = 0;
  try {
    // 2. Sequence.
    await smartleadFetch(`/campaigns/${campaignId}/sequences`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        sequences: p.sequence.map((s, i) => ({
          seq_number: Number(s.seq_number) || i + 1,
          seq_delay_details: { delay_in_days: Number(s.delay_days) || 0 },
          subject: String(s.subject ?? ""),
          email_body: String(s.body_html ?? ""),
        })),
      }),
    });
    await delay();

    // 3. Schedule (required for sending; warn-continue on failure).
    try {
      await smartleadFetch(`/campaigns/${campaignId}/schedule`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          timezone: p.schedule?.timezone ?? "America/Los_Angeles",
          days_of_the_week: p.schedule?.days_of_week ?? [1, 2, 3, 4, 5],
          start_hour: p.schedule?.start_hour ?? "09:00",
          end_hour: p.schedule?.end_hour ?? "17:00",
          min_time_btw_emails: p.schedule?.min_time_btw_emails ?? 15,
          max_new_leads_per_day: p.schedule?.max_new_leads_per_day ?? 25,
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

    // 6. Add leads in batches of 400, retrying a failed batch once before
    // counting it failed (a single transient blip shouldn't drop ~400 leads).
    const batchSize = 400;
    const totalBatches = Math.ceil(recipients.length / batchSize);
    for (let i = 0; i < totalBatches; i++) {
      const batch = recipients.slice(i * batchSize, (i + 1) * batchSize);
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
        smartlead_campaign_id: campaignId,
        owner_user_id: p.owner_id ?? null,
        sending_email_account_id: p.email_account_id != null ? String(p.email_account_id) : null,
        leads_per_day: Number(p.schedule?.max_new_leads_per_day) || 20,
        steps: sequenceToSteps(p.sequence),
        notes: p.sequence
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
        },
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw new Error("Smartlead campaign created but the Pulse record failed: " + (insErr?.message ?? "unknown"));
    }
    pulseCampaignId = inserted.id;

    // 8. Mark the source idea executed.
    if (p.source_idea_id && pulseCampaignId) {
      await svc
        .from("playbook_ideas")
        .update({ status: "executed", executed_campaign_id: pulseCampaignId })
        .eq("id", p.source_idea_id);
    }

    // 9. Log an email activity on each linked contact (timeline visibility).
    // Non-fatal: a bad FK in one row shouldn't fail the whole launch.
    const subject = String(p.sequence[0]?.subject ?? p.campaign_name);
    const acts = recipients
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
    // active.
    if (p.autoStart === true) {
      try {
        await smartleadFetch(`/campaigns/${campaignId}/status`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ status: "START" }),
        });
        autoStarted = true;
        await svc.from("campaigns").update({ status: "active" }).eq("id", pulseCampaignId);
      } catch { /* leave as draft */ }
    }
  } catch (err) {
    try { await smartleadFetch(`/campaigns/${campaignId}`, { method: "DELETE" }); } catch { /* best-effort */ }
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
