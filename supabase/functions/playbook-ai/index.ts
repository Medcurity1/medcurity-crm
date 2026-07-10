// playbook-ai Edge Function — the Playbook "brain" (ported from Nexus).
// Actions:
//   - generate-ideas  : weekly AI marketing ideas (server.js generatePlaybookIdeas)
// Campaign-writer + analysis + adaptation actions land in later phases.
//
// Auth: admin/super_admin only (verified from the caller's JWT). Writes
// run via the service client (tables are admin-only RLS).
//
// Deploy: supabase functions deploy playbook-ai

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  PLAYBOOK_IDEAS_MODEL,
  PLAYBOOK_FAST_MODEL,
  ideasSystemPrompt,
  ideasUserPrompt,
  campaignGenerateSystem,
  campaignSuggestSystem,
  campaignRegenerateSystem,
  campaignAnalysisSystem,
  isTrainingNoteDuplicate,
  formatTrainingNotes,
  parseJsonResponse,
  callClaude,
  getMonday,
  type PlaybookContext,
} from "../_shared/playbook-prompts.ts";

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

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Verify the caller is an admin via their JWT. Returns true/false. */
async function callerIsAdmin(authHeader: string | null): Promise<boolean> {
  if (!authHeader) return false;
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await asUser.rpc("is_admin");
  if (error) return false;
  return data === true;
}

/**
 * Scheduled invocations (GitHub Actions cron) call this function with the
 * service-role key as the bearer — there's no user JWT, so callerIsAdmin
 * would reject them.
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

async function gatherContext(): Promise<{ ctx: PlaybookContext; trainingNotes: { note: string }[] }> {
  const ninetyAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const sixtyAgo = new Date(Date.now() - 60 * 86400000).toISOString();

  // Past campaign performance (campaigns with metrics, last 90 days).
  const { data: campaigns } = await svc
    .from("playbook_campaigns")
    .select("title, status, notes, metrics, created_at")
    .gte("created_at", ninetyAgo)
    .order("created_at", { ascending: false })
    .limit(50);
  const pastCampaigns = (campaigns ?? []).filter(
    (c) => c.metrics && (c.metrics.sent != null || c.metrics.openRate != null || c.metrics.clickRate != null),
  );

  // "Upcoming events" — planned campaigns not yet launched (Waypoint replacement).
  const { data: planned } = await svc
    .from("playbook_campaigns")
    .select("title, status, created_at")
    .eq("status", "planned")
    .order("created_at", { ascending: false })
    .limit(20);

  // Past ideas + feedback (last 60 days).
  const { data: pastIdeas } = await svc
    .from("playbook_ideas")
    .select("title, status, feedback_note, action_type, effort")
    .gte("created_at", sixtyAgo)
    .order("created_at", { ascending: false });

  // Recent campaign analyses (last 5).
  const { data: analyzed } = await svc
    .from("playbook_campaigns")
    .select("title, analysis_json")
    .not("analysis_json", "is", null)
    .order("analyzed_at", { ascending: false })
    .limit(5);
  const recentAnalyses = (analyzed ?? []).map((e) => {
    const a = (e.analysis_json ?? {}) as Record<string, unknown>;
    return { campaign: e.title, summary: a.summary, performance: a.performance, wins: a.wins, improvements: a.improvements };
  });

  // Training notes.
  const { data: training } = await svc
    .from("playbook_training")
    .select("note")
    .order("created_at", { ascending: false });

  return {
    ctx: {
      pastCampaigns,
      upcomingEvents: planned ?? [],
      pastIdeas: pastIdeas ?? [],
      recentAnalyses,
    },
    trainingNotes: (training ?? []) as { note: string }[],
  };
}

async function generateIdeas(force: boolean) {
  const monday = getMonday(new Date());

  if (!force) {
    const { data: existing } = await svc
      .from("playbook_ideas")
      .select("*")
      .eq("week_date", monday);
    if (existing && existing.length > 0) {
      return { success: true, ideas: existing, week_date: monday, cached: true };
    }
  }

  const { ctx, trainingNotes } = await gatherContext();
  const today = new Date().toISOString().split("T")[0];

  const text = await callClaude({
    model: PLAYBOOK_IDEAS_MODEL,
    system: ideasSystemPrompt(),
    user: ideasUserPrompt(ctx, formatTrainingNotes(trainingNotes), today),
    maxTokens: 4000,
    temperature: 0.7,
  });

  const parsed = parseJsonResponse(text);
  const ideas = parsed.ideas as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(ideas) || ideas.length === 0) {
    throw new Error("AI returned no ideas");
  }

  if (force) {
    await svc.from("playbook_ideas").delete().eq("week_date", monday);
  } else {
    // Re-check right before insert: the Claude call above is multi-second,
    // so a concurrent run (cron + manual click) could have populated this
    // week in the meantime. This narrows the duplicate-insert race window
    // from seconds to milliseconds.
    const { data: raced } = await svc
      .from("playbook_ideas")
      .select("*")
      .eq("week_date", monday)
      .order("created_at", { ascending: true });
    if (raced && raced.length) {
      return { success: true, ideas: raced, week_date: monday, cached: true };
    }
  }

  // Clamp the AI's enum fields so one off-template value (the columns are
  // CHECK-constrained) can't make the whole weekly batch insert fail.
  const ALLOWED_ACTION = new Set(["campaign", "content", "strategy", "outreach"]);
  const ALLOWED_EFFORT = new Set(["quick", "medium", "big"]);
  const rows = ideas.map((idea) => ({
    week_date: monday,
    title: (idea.title as string) || "Untitled idea",
    description: (idea.description as string) || "",
    reasoning: (idea.reasoning as string) || "",
    action_type: ALLOWED_ACTION.has(idea.action_type as string) ? (idea.action_type as string) : "strategy",
    effort: ALLOWED_EFFORT.has(idea.effort as string) ? (idea.effort as string) : "medium",
    campaign_prefill: idea.campaign_prefill ?? null,
  }));
  const { data: saved, error: insErr } = await svc
    .from("playbook_ideas")
    .insert(rows)
    .select();
  if (insErr) throw insErr;

  // Idempotent weekly report snapshot.
  await svc
    .from("playbook_reports")
    .upsert({ week_date: monday, ideas_json: parsed, context_json: ctx }, { onConflict: "week_date" });

  return { success: true, ideas: saved, week_date: monday };
}

async function allTrainingNotes(): Promise<{ note: string }[]> {
  const { data } = await svc
    .from("playbook_training")
    .select("note")
    .order("created_at", { ascending: false });
  return (data ?? []) as { note: string }[];
}

/** AI-write a full campaign sequence from a plain-English description. */
async function generateCampaign(description: string) {
  if (!description || description.trim().length < 20) {
    throw new Error("Description must be at least 20 characters");
  }
  const notes = await allTrainingNotes();
  const text = await callClaude({
    model: PLAYBOOK_IDEAS_MODEL,
    system: campaignGenerateSystem(formatTrainingNotes(notes)),
    user: description.trim(),
    maxTokens: 4000,
    temperature: 0.7,
  });
  const parsed = parseJsonResponse(text);
  if (!Array.isArray(parsed.sequence)) throw new Error("AI returned invalid campaign structure");
  return { success: true, campaign: parsed };
}

/** Suggest improvements to a draft campaign, grounded in past performance. */
async function suggestCampaign(campaign: unknown) {
  const { data: past } = await svc
    .from("playbook_campaigns")
    .select("title, metrics")
    .not("metrics", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);
  const history = (past ?? [])
    .map((e) => ({ title: e.title, ...(e.metrics ?? {}) }))
    .filter((e) => (e as Record<string, unknown>).sent || (e as Record<string, unknown>).openRate);
  try {
    const text = await callClaude({
      model: PLAYBOOK_FAST_MODEL,
      system: campaignSuggestSystem,
      user: `Draft campaign:\n${JSON.stringify(campaign)}\n\nHistorical performance (last 20 campaigns):\n${JSON.stringify(history)}\n\nSuggest improvements to increase open and click rates.`,
      maxTokens: 500,
      temperature: 0.7,
    });
    return { success: true, suggestions: text };
  } catch {
    return { success: true, suggestions: "Unable to generate suggestions right now. Try editing manually." };
  }
}

/** Rewrite a single email in a sequence. */
async function regenerateEmail(p: {
  description?: string;
  campaign: { campaign_name?: string; sequence?: Array<Record<string, unknown>> };
  seq_number: number;
  feedback?: string;
}) {
  const email = p.campaign.sequence?.find((e) => e.seq_number === p.seq_number);
  if (!email) throw new Error("Email not found in sequence");
  const seqSummary = (p.campaign.sequence ?? [])
    .map((e) => `Email ${e.seq_number}: "${(e.subject as string) || ""}"`)
    .join("\n");
  let user = `Campaign context: ${p.description || p.campaign.campaign_name}\nFull sequence for context:\n${seqSummary}\n\nRewrite email #${p.seq_number}. Current version:\nSubject: ${(email.subject as string) || ""}\nBody: ${email.body_html}`;
  if (p.feedback) user += `\n\nAdditional direction: ${p.feedback}`;
  const text = await callClaude({
    model: PLAYBOOK_FAST_MODEL,
    system: campaignRegenerateSystem,
    user,
    maxTokens: 1000,
    temperature: 0.7,
  });
  return { success: true, email: parseJsonResponse(text) };
}

/** Analyze a completed campaign vs historical averages; auto-add training. */
async function analyzeCampaign(campaignId: string) {
  const { data: ev } = await svc.from("playbook_campaigns").select("*").eq("id", campaignId).single();
  if (!ev) throw new Error("Campaign not found");
  if (ev.analyzed_at) return { already_analyzed: true, analysis: ev.analysis_json ?? {} };
  const metrics = (ev.metrics ?? {}) as Record<string, string>;
  if (!metrics.sent || parseInt(metrics.sent) === 0) throw new Error("No send data yet");

  const { data: linked } = await svc
    .from("playbook_ideas").select("title").eq("executed_campaign_id", campaignId).maybeSingle();

  const { data: others } = await svc
    .from("playbook_campaigns").select("metrics").eq("status", "complete").neq("id", campaignId);
  let to = 0, on = 0, tc = 0, cn = 0, tb = 0, bn = 0;
  for (const c of others ?? []) {
    const m = (c.metrics ?? {}) as Record<string, string>;
    const or = parseFloat(m.openRate), cr = parseFloat(m.clickRate);
    if (!isNaN(or)) { to += or; on++; }
    if (!isNaN(cr)) { tc += cr; cn++; }
    const b = parseInt(m.bounces), s = parseInt(m.sent);
    if (!isNaN(b) && !isNaN(s) && s > 0) { tb += (b / s) * 100; bn++; }
  }
  const avgOpen = on ? (to / on).toFixed(1) + "%" : "N/A";
  const avgClick = cn ? (tc / cn).toFixed(1) + "%" : "N/A";
  const avgBounce = bn ? (tb / bn).toFixed(1) + "%" : "N/A";

  const user = `Campaign: ${ev.title}
Sent: ${metrics.sent || "unknown"}
Open Rate: ${metrics.openRate || "unknown"}
Click Rate: ${metrics.clickRate || "unknown"}
Replies: ${metrics.replies || "0"}
Bounces: ${metrics.bounces || "0"}

Email content from notes:
${(ev.notes || "").substring(0, 1000)}

Historical averages across all campaigns:
Avg Open Rate: ${avgOpen}
Avg Click Rate: ${avgClick}
Avg Bounce Rate: ${avgBounce}

Was this from a Playbook idea? ${linked ? "Yes: " + linked.title : "No"}`;

  const text = await callClaude({
    model: PLAYBOOK_FAST_MODEL, system: campaignAnalysisSystem, user, maxTokens: 1000, temperature: 0.7,
  });
  const analysis = parseJsonResponse(text);

  let trainingAdded = 0;
  const proposed = analysis.performance !== "outlier" && Array.isArray(analysis.auto_training)
    ? (analysis.auto_training as string[]).filter((n) => typeof n === "string" && n.trim()).map((n) => n.trim())
    : [];
  if (proposed.length) {
    const { data: existing } = await svc.from("playbook_training").select("note");
    const existingNotes = (existing ?? []).map((r) => r.note as string);
    for (const note of proposed) {
      if (!isTrainingNoteDuplicate(note, existingNotes)) {
        await svc.from("playbook_training").insert({ note, source: "campaign_result" });
        existingNotes.push(note);
        trainingAdded++;
      }
    }
  }
  await svc.from("playbook_campaigns")
    .update({ analysis_json: analysis, analyzed_at: new Date().toISOString() })
    .eq("id", campaignId);
  return { success: true, analysis, training_added: trainingAdded };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!isServiceRole(auth) && !(await callerIsAdmin(auth))) {
      return json({ error: "Admin only" }, 403);
    }
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "generate-ideas";

    if (action === "generate-ideas") {
      const result = await generateIdeas(!!body.force);
      return json(result as unknown as Record<string, unknown>);
    }
    if (action === "generate-campaign") {
      return json(await generateCampaign(body.description ?? ""));
    }
    if (action === "suggest-campaign") {
      return json(await suggestCampaign(body.campaign));
    }
    if (action === "regenerate-email") {
      return json(await regenerateEmail(body));
    }
    if (action === "analyze-campaign") {
      return json(await analyzeCampaign(body.campaignId));
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
