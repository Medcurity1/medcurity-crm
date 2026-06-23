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
  ideasSystemPrompt,
  ideasUserPrompt,
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
  }

  const rows = ideas.map((idea) => ({
    week_date: monday,
    title: (idea.title as string) || "Untitled idea",
    description: (idea.description as string) || "",
    reasoning: (idea.reasoning as string) || "",
    action_type: (idea.action_type as string) || "strategy",
    effort: (idea.effort as string) || "medium",
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (!(await callerIsAdmin(req.headers.get("Authorization")))) {
      return json({ error: "Admin only" }, 403);
    }
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "generate-ideas";

    if (action === "generate-ideas") {
      const result = await generateIdeas(!!body.force);
      return json(result as unknown as Record<string, unknown>);
    }
    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
