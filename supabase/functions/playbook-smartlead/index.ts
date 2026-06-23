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
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
