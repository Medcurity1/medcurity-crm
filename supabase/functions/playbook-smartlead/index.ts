// playbook-smartlead Edge Function — Smartlead read path (ported from
// Nexus server.js). Actions:
//   - status        : is Smartlead configured?
//   - email-accounts: list sending inboxes (for the campaign wizard)
//   - import        : pull all Smartlead campaigns -> playbook_campaigns
//                     (create new, refresh metrics/status on existing;
//                     preserves user-edited title/notes on update)
//   - sync          : refresh metrics + status on already-imported campaigns
// The launch (write) path lands in the next phase.
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

async function importCampaigns() {
  const campaigns = await fetchCampaigns();
  if (!Array.isArray(campaigns)) throw new Error("Unexpected Smartlead response");
  let created = 0;
  let updated = 0;
  for (const camp of campaigns as Record<string, unknown>[]) {
    const campId = camp.id as number;
    const { data: existing } = await svc
      .from("playbook_campaigns")
      .select("id, metrics")
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
      const patch: Record<string, unknown> = { metrics: merged };
      if (status === "complete") patch.status = "complete";
      await svc.from("playbook_campaigns").update(patch).eq("id", existing.id);
      updated++;
    } else {
      await svc.from("playbook_campaigns").insert({
        title: (camp.name as string) || "Smartlead Campaign " + campId,
        platform: "smartlead",
        status,
        smartlead_campaign_id: campId,
        notes,
        metrics,
      });
      created++;
    }
  }
  return { created, updated, total: campaigns.length };
}

async function syncCampaigns() {
  const { data: existing } = await svc
    .from("playbook_campaigns")
    .select("id, smartlead_campaign_id, metrics")
    .not("smartlead_campaign_id", "is", null);
  let synced = 0;
  for (const c of existing ?? []) {
    try {
      const camp = (await fetchCampaignById(c.smartlead_campaign_id)) as Record<string, unknown>;
      const analytics = (await fetchCampaignAnalytics(c.smartlead_campaign_id)) as Record<string, unknown>;
      const metrics = buildSmartleadMetrics(analytics);
      const merged = { ...(c.metrics ?? {}), ...metrics };
      const patch: Record<string, unknown> = { metrics: merged };
      const status = mapSmartleadStatus(camp.status as string);
      if (status === "complete") patch.status = "complete";
      await svc.from("playbook_campaigns").update(patch).eq("id", c.id);
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
}

/**
 * Launch a campaign into Smartlead (ported from server.js:3294-3541):
 * create -> sequence (rollback/delete on failure) -> schedule -> attach
 * inbox -> add leads (400-batch) -> optionally START. autoStart defaults
 * to FALSE so the campaign lands as a Smartlead DRAFT (no emails sent)
 * until the user reviews + starts it. On success, records the campaign in
 * Pulse and logs an email_sent activity on each linked contact.
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

  // 2. Sequence — rollback (delete campaign) on failure.
  try {
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
  } catch (seqErr) {
    try { await smartleadFetch(`/campaigns/${campaignId}`, { method: "DELETE" }); } catch { /* ignore */ }
    throw new Error("Failed to save email sequence: " + (seqErr as Error).message);
  }

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

  // 5. Add leads in batches of 400.
  let leadsAdded = 0;
  let leadsFailed = 0;
  const batchSize = 400;
  const totalBatches = Math.ceil(p.recipients.length / batchSize);
  for (let i = 0; i < totalBatches; i++) {
    const batch = p.recipients.slice(i * batchSize, (i + 1) * batchSize);
    const leadList = batch.map((r) => ({
      email: r.email,
      first_name: r.first_name ?? "",
      last_name: r.last_name ?? "",
      company_name: r.company_name ?? "",
    }));
    try {
      await smartleadFetch(`/campaigns/${campaignId}/leads`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ lead_list: leadList }),
      });
      leadsAdded += batch.length;
    } catch {
      leadsFailed += batch.length;
    }
    if (i < totalBatches - 1) await delay();
  }
  if (leadsAdded === 0 && leadsFailed > 0) {
    throw new Error("All lead batches failed; campaign created but has no leads.");
  }

  // 6. Optionally START (default OFF — leave as a Smartlead draft).
  let autoStarted = false;
  if (p.autoStart === true) {
    try {
      await smartleadFetch(`/campaigns/${campaignId}/status`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ status: "START" }),
      });
      autoStarted = true;
    } catch { /* leave as draft */ }
  }

  // 7. Record in Pulse.
  const { data: inserted } = await svc
    .from("playbook_campaigns")
    .insert({
      title: p.campaign_name,
      platform: "smartlead",
      status: autoStarted ? "in_progress" : "planned",
      smartlead_campaign_id: campaignId,
      notes: p.sequence
        .map((s, i) => `Step ${s.seq_number ?? i + 1}: ${s.subject ?? ""}`)
        .join("\n"),
      adaptive_enabled: !!p.adaptiveEnabled,
      owner_id: p.owner_id ?? null,
    })
    .select("id")
    .single();
  const pulseCampaignId = inserted?.id ?? null;

  // 8. Mark the source idea executed.
  if (p.source_idea_id && pulseCampaignId) {
    await svc
      .from("playbook_ideas")
      .update({ status: "executed", executed_campaign_id: pulseCampaignId })
      .eq("id", p.source_idea_id);
  }

  // 9. Log an email_sent activity on each linked contact (timeline visibility).
  const subject = String(p.sequence[0]?.subject ?? p.campaign_name);
  const acts = p.recipients
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
    await svc.from("activities").insert(acts);
  }

  return {
    success: true,
    smartlead_campaign_id: campaignId,
    pulse_campaign_id: pulseCampaignId,
    leads_added: leadsAdded,
    leads_failed: leadsFailed,
    auto_started: autoStarted,
    smartlead_url: `https://app.smartlead.ai/app/email-campaign/${campaignId}/analytics`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await callerIsAdmin(req.headers.get("Authorization")))) {
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
      if (pulseId) await svc.from("playbook_campaigns").delete().eq("id", pulseId);
      return json({ success: true });
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
