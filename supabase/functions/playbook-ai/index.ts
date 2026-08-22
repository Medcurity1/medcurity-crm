// playbook-ai Edge Function — the Playbook "brain" (ported from Nexus).
// Actions:
//   - generate-ideas  : weekly AI marketing ideas (server.js generatePlaybookIdeas)
//   - generate-campaign: AI writes a full email sequence from a description
//   - suggest-campaign : improvements to a draft, grounded in history
//   - regenerate-email : rewrite one email in a sequence
//   - analyze-campaign : analyze completed campaign vs historical averages
//   - campaign-insights: template suggestions + performance summary
//   - interpret-audience: AI translates plain-English brief -> strict AudienceSpec v1
//   - resolve-audience : deterministic CRM query from validated spec -> provenance
//
// Campaigns unification (2026-07-22): campaign context/analysis reads and
// writes `campaigns`, not the retired `playbook_campaigns` (now
// playbook_campaigns_archived_20260722 — see 20260722100000_campaigns_unify.sql).
//
// Auth: per-action allowlist (2026-08-22). REP_ELIGIBLE_AI_ACTIONS are open
// to all authenticated users (matching company-wide campaign launch intent).
// Ideas/Insights/Training remain admin-only. Service-role callers (cron)
// bypass all gates.
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
  campaignInsightsSystem,
  audienceInterpretSystem,
  isTrainingNoteDuplicate,
  formatTrainingNotes,
  parseJsonResponse,
  callClaude,
  getMonday,
  type PlaybookContext,
} from "../_shared/playbook-prompts.ts";
import {
  type AudienceSpecV1,
  INDUSTRY_CATEGORY_VALUES,
  PROJECT_SEGMENT_VALUES,
  US_STATE_CODES,
  MAX_RESULTS_HARD_CAP,
  MAX_RESULTS_DEFAULT,
  BRIEF_MAX_LENGTH,
  validateAudienceSpec,
  isUnfilteredSpec,
  isPlausibleEmail,
  specHash,
  normalizeEmail,
  detectPiiPatterns,
  piiRejectionMessage,
} from "../_shared/audience-spec.ts";

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

/** Extract the caller's user ID from their JWT. Null for service-role/no-JWT. */
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

/** Create a Supabase client scoped to the caller's JWT (for RLS-visible queries). */
function callerClient(authHeader: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
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
    .from("campaigns")
    .select("name, status, notes, metrics, created_at")
    .gte("created_at", ninetyAgo)
    .order("created_at", { ascending: false })
    .limit(50);
  const pastCampaigns = (campaigns ?? []).filter(
    (c) => c.metrics && (c.metrics.sent != null || c.metrics.openRate != null || c.metrics.clickRate != null),
  );

  // "Upcoming events" — draft campaigns not yet launched (Waypoint replacement).
  const { data: planned } = await svc
    .from("campaigns")
    .select("name, status, created_at")
    .eq("status", "draft")
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
    .from("campaigns")
    .select("name, analysis_json")
    .not("analysis_json", "is", null)
    .order("analyzed_at", { ascending: false })
    .limit(5);
  const recentAnalyses = (analyzed ?? []).map((e) => {
    const a = (e.analysis_json ?? {}) as Record<string, unknown>;
    return { campaign: e.name, summary: a.summary, performance: a.performance, wins: a.wins, improvements: a.improvements };
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
    .from("campaigns")
    .select("name, metrics")
    .not("metrics", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);
  const history = (past ?? [])
    .map((e) => ({ name: e.name, ...(e.metrics ?? {}) }))
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

/** Analyze a completed campaign vs historical averages; auto-add training.
 *  `force` (docket I12) re-runs the analysis even when one already exists —
 *  the one-shot analyzed_at gate meant a campaign analyzed at ~20 sends was
 *  never revisited after finishing with real results; the detail sheet's
 *  "Get fresh insights" button passes force to fix exactly that. */
async function analyzeCampaign(campaignId: string, force = false) {
  const { data: ev } = await svc.from("campaigns").select("*").eq("id", campaignId).single();
  if (!ev) throw new Error("Campaign not found");
  if (ev.analyzed_at && !force) return { already_analyzed: true, analysis: ev.analysis_json ?? {} };
  const metrics = (ev.metrics ?? {}) as Record<string, string>;
  if (!metrics.sent || parseInt(metrics.sent) === 0) throw new Error("No send data yet");

  const { data: linked } = await svc
    .from("playbook_ideas").select("title").eq("executed_campaign_id", campaignId).maybeSingle();

  const { data: others } = await svc
    .from("campaigns").select("metrics").eq("status", "completed").neq("id", campaignId);
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

  const user = `Campaign: ${ev.name}
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
  await svc.from("campaigns")
    .update({ analysis_json: analysis, analyzed_at: new Date().toISOString() })
    .eq("id", campaignId);
  return { success: true, analysis, training_added: trainingAdded };
}

/**
 * Campaign insights + template-suggestion generation (Campaigns overhaul
 * Phase 4 — the AI learning loop). Broader sibling of analyzeCampaign: also
 * proposes concrete, numbers-grounded template edits (subject/body/timing/
 * audience) queued in campaign_suggestions, and — same as analyzeCampaign —
 * distills at most one training note. Called both from the Insights panel's
 * (future) manual trigger and, primarily, from playbook-smartlead's daily
 * sweep once a campaign has enough data (see that function's doc comment).
 *
 * Unlike analyzeCampaign, this does NOT refuse to run on an already-analyzed
 * campaign — the caller (daily-sweep) already filters to `analyzed_at IS
 * NULL`, and after this runs once analyzed_at is set, so the sweep won't
 * re-select it. A direct re-invoke just extends analysis_json again and
 * skips any suggestion that duplicates an existing PENDING one for the same
 * template/step/kind (see the dedupe check below).
 */
async function campaignInsights(campaignId: string) {
  if (!campaignId) throw new Error("campaign_id is required");
  const { data: campaign, error: campErr } = await svc
    .from("campaigns")
    .select("id, name, status, metrics, steps, settings, template_id, analyzed_at, analysis_json")
    .eq("id", campaignId)
    .maybeSingle();
  if (campErr) throw new Error(campErr.message);
  if (!campaign) throw new Error("Campaign not found");

  const metrics = (campaign.metrics ?? {}) as Record<string, unknown>;

  // Enrollment aggregates: counts by status + reply_category.
  const { data: enrollRows } = await svc
    .from("campaign_enrollments")
    .select("status, reply_category")
    .eq("campaign_id", campaignId);
  const enrollmentsByStatus: Record<string, number> = {};
  const repliesByCategory: Record<string, number> = {};
  for (const r of (enrollRows ?? []) as { status: string; reply_category: string | null }[]) {
    const st = r.status || "unknown";
    enrollmentsByStatus[st] = (enrollmentsByStatus[st] ?? 0) + 1;
    if (r.reply_category) repliesByCategory[r.reply_category] = (repliesByCategory[r.reply_category] ?? 0) + 1;
  }

  // Event tallies (raw counts off our own webhook log — see
  // useCampaignEventStats' doc comment for why this isn't a per-step
  // breakdown).
  const { data: eventRows } = await svc
    .from("campaign_events")
    .select("event_type")
    .eq("campaign_id", campaignId);
  const eventCounts: Record<string, number> = {};
  for (const r of (eventRows ?? []) as { event_type: string }[]) {
    const t = r.event_type || "unknown";
    eventCounts[t] = (eventCounts[t] ?? 0) + 1;
  }

  // Template + sibling campaigns run from the same template (metrics only).
  let template: { id: string; name: string; steps: unknown } | null = null;
  let siblings: Array<{ name: string; metrics: unknown }> = [];
  if (campaign.template_id) {
    const { data: tmpl } = await svc
      .from("campaign_templates")
      .select("id, name, steps")
      .eq("id", campaign.template_id)
      .eq("publish_state", "published")
      .maybeSingle();
    template = tmpl ?? null;
    const { data: sibs } = await svc
      .from("campaigns")
      .select("name, metrics")
      .eq("template_id", campaign.template_id)
      .neq("id", campaignId)
      .order("created_at", { ascending: false })
      .limit(10);
    siblings = (sibs ?? []) as Array<{ name: string; metrics: unknown }>;
  }

  const notes = (await allTrainingNotes()).slice(0, 20);

  const user = `Campaign: ${campaign.name} (status: ${campaign.status})

METRICS:
${JSON.stringify(metrics, null, 2)}

STEPS SENT (actual copy):
${JSON.stringify(campaign.steps, null, 2)}

ENROLLMENT COUNTS BY STATUS:
${JSON.stringify(enrollmentsByStatus, null, 2)}

REPLIES BY CATEGORY:
${Object.keys(repliesByCategory).length ? JSON.stringify(repliesByCategory, null, 2) : "No categorized replies yet."}

EVENT TALLIES (raw counts from our event log):
${Object.keys(eventCounts).length ? JSON.stringify(eventCounts, null, 2) : "No events logged yet."}

TEMPLATE: ${template ? template.name : "None — this is a one-off campaign not built from a template. Do not propose template_suggestions."}
${template ? `Template steps:\n${JSON.stringify(template.steps, null, 2)}` : ""}

SIBLING CAMPAIGNS FROM THE SAME TEMPLATE (last 10, metrics only):
${siblings.length ? JSON.stringify(siblings, null, 2) : "None — this is the only campaign run from this template so far."}

${formatTrainingNotes(notes)}`;

  const text = await callClaude({
    model: PLAYBOOK_FAST_MODEL,
    system: campaignInsightsSystem,
    user,
    maxTokens: 2000,
    temperature: 0.7,
  });
  const parsed = parseJsonResponse(text);

  const performanceSummary = typeof parsed.performance_summary === "string" ? parsed.performance_summary : "";
  const wins = Array.isArray(parsed.wins) ? (parsed.wins as unknown[]).filter((w) => typeof w === "string") as string[] : [];
  const improvements = Array.isArray(parsed.improvements)
    ? (parsed.improvements as unknown[]).filter((w) => typeof w === "string") as string[]
    : [];
  const rawSuggestions = Array.isArray(parsed.template_suggestions)
    ? (parsed.template_suggestions as Array<Record<string, unknown>>)
    : [];
  const trainingNote = typeof parsed.training_note === "string" && parsed.training_note.trim()
    ? parsed.training_note.trim()
    : null;

  // Extend (not replace) analysis_json — keep analyze-campaign's keys
  // (summary/performance/wins/improvements) so CampaignCard.tsx and
  // gatherContext's recentAnalyses read (both key off `summary`/`performance`/
  // `wins`/`improvements`) keep working unchanged; add insights-only keys
  // alongside.
  const priorAnalysis = (campaign.analysis_json ?? {}) as Record<string, unknown>;
  const analysis: Record<string, unknown> = {
    ...priorAnalysis,
    summary: performanceSummary || priorAnalysis.summary,
    wins: wins.length ? wins : priorAnalysis.wins,
    improvements: improvements.length ? improvements : priorAnalysis.improvements,
    insights_generated_at: new Date().toISOString(),
    template_suggestions_count: rawSuggestions.length,
  };
  const { error: updErr } = await svc
    .from("campaigns")
    .update({ analysis_json: analysis, analyzed_at: campaign.analyzed_at ?? new Date().toISOString() })
    .eq("id", campaignId);
  if (updErr) throw new Error(updErr.message);

  // Template suggestions — only when the source campaign actually has a
  // template (see campaign_suggestions.template_id NOT NULL constraint).
  const ALLOWED_KIND = new Set(["subject", "body", "timing", "audience", "general"]);
  let suggestionsCreated = 0;
  if (campaign.template_id && rawSuggestions.length) {
    const { data: existingPending } = await svc
      .from("campaign_suggestions")
      .select("step_order, kind")
      .eq("template_id", campaign.template_id)
      .eq("status", "pending");
    const existingKeys = new Set(
      (existingPending ?? []).map((s) => `${s.step_order ?? "null"}:${s.kind}`),
    );
    for (const raw of rawSuggestions.slice(0, 4)) {
      const kind = ALLOWED_KIND.has(raw.kind as string) ? (raw.kind as string) : null;
      const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
      // rationale is NOT NULL on the table, and a suggestion with no
      // recognized kind or no stated reason isn't actionable — skip both
      // rather than inserting a row the UI can't render meaningfully.
      if (!kind || !rationale) continue;
      const stepOrder = typeof raw.step_order === "number" ? raw.step_order : null;
      const key = `${stepOrder ?? "null"}:${kind}`;
      if (existingKeys.has(key)) continue; // dedupe vs. an existing PENDING suggestion
      const { error: insErr } = await svc.from("campaign_suggestions").insert({
        campaign_id: campaignId,
        template_id: campaign.template_id,
        step_order: stepOrder,
        kind,
        current_value: typeof raw.current_value === "string" ? raw.current_value : null,
        suggested_value: typeof raw.suggested_value === "string" ? raw.suggested_value : null,
        rationale,
      });
      if (!insErr) {
        existingKeys.add(key);
        suggestionsCreated++;
      } else {
        console.error(`campaign-insights: suggestion insert failed for campaign ${campaignId}:`, insErr.message);
      }
    }
  }

  // Training note — same dedupe rule as analyzeCampaign, tagged so its
  // provenance is visible in the Training panel (source label added there).
  let trainingAdded = 0;
  if (trainingNote) {
    const { data: existing } = await svc.from("playbook_training").select("note");
    const existingNotes = (existing ?? []).map((r) => r.note as string);
    if (!isTrainingNoteDuplicate(trainingNote, existingNotes)) {
      const { error: noteErr } = await svc
        .from("playbook_training")
        .insert({ note: trainingNote, source: "auto-insights" });
      if (!noteErr) trainingAdded = 1;
    }
  }

  return { success: true, analysis, suggestions_created: suggestionsCreated, training_added: trainingAdded };
}

// ── AI Audience: interpret-audience ──────────────────────────────────────

/**
 * Translate a plain-English audience brief into a strict AudienceSpec v1.
 * The model receives ONLY the brief + allowlisted vocabulary — never CRM
 * rows, contact PII, or IDs.
 *
 * Blocker 2: stores a server-persisted interpretation record via RPC and
 * returns interpretation_id.  resolve-audience must bind this record for
 * AI provenance — the client cannot forge model/spec/hash.
 *
 * Blocker 3: rejects briefs containing obvious PII (emails, phone
 * numbers, SSNs) with plain guidance before sending to the model.
 */
async function interpretAudience(brief: string, userId: string): Promise<Record<string, unknown>> {
  if (!brief || typeof brief !== "string") {
    throw new Error("brief is required");
  }
  const trimmed = brief.trim();
  if (trimmed.length < 10) throw new Error("Brief must be at least 10 characters");
  if (trimmed.length > BRIEF_MAX_LENGTH) throw new Error(`Brief exceeds ${BRIEF_MAX_LENGTH} characters`);

  // Blocker 3: PII guard — reject before sending to AI or storing
  const piiFound = detectPiiPatterns(trimmed);
  if (piiFound.length > 0) {
    throw new Error(piiRejectionMessage(piiFound));
  }

  // Build the vocabulary context — the ONLY CRM data the model sees
  const vocabulary = {
    industry_categories: INDUSTRY_CATEGORY_VALUES,
    project_segments: PROJECT_SEGMENT_VALUES,
    us_state_codes: US_STATE_CODES,
  };

  const modelId = PLAYBOOK_IDEAS_MODEL;
  const text = await callClaude({
    model: modelId,
    system: audienceInterpretSystem(vocabulary),
    user: trimmed,
    maxTokens: 1500,
    temperature: 0.2,
  });

  const parsed = parseJsonResponse(text);

  // Deterministically set locked fields (invariants, not cleanup)
  parsed.version = 1;
  parsed.exclude_customers = true;
  parsed.exclude_former_customers = true;
  parsed.exclude_partners = true;
  parsed.exclude_suppressed = true;
  parsed.exclude_active_enrollments = true;
  if (typeof parsed.max_results !== "number" || parsed.max_results < 1) {
    parsed.max_results = MAX_RESULTS_DEFAULT;
  }
  if ((parsed.max_results as number) > MAX_RESULTS_HARD_CAP) {
    parsed.max_results = MAX_RESULTS_HARD_CAP;
  }
  if (!parsed.filters || typeof parsed.filters !== "object") {
    parsed.filters = {};
  }

  // Validate — reject on ANY invalid/injection-shaped output, never clean up
  const errors = validateAudienceSpec(parsed);
  if (errors.length > 0) {
    throw new Error(
      `Invalid model output: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
    );
  }

  const spec = parsed as unknown as AudienceSpecV1;
  const hash = await specHash(spec);

  // Blocker 2: persist interpretation server-side via RPC (service_role)
  const { data: interpId, error: interpErr } = await svc.rpc(
    "create_audience_interpretation",
    {
      p_user_id: userId,
      p_brief: trimmed,
      p_spec: spec,
      p_spec_hash: hash,
      p_model_id: modelId,
    },
  );
  if (interpErr) {
    throw new Error("Failed to persist interpretation: " + interpErr.message);
  }

  return {
    success: true,
    interpretation_id: interpId,
    spec,
    spec_hash: hash,
    model_id: modelId,
  };
}

// ── AI Audience: resolve-audience ───────────────────────────────────────

/** Scan hard cap — never process more contacts than this per run. */
const SCAN_HARD_CAP = 10000;

/**
 * Deterministic audience resolution from a validated AudienceSpec v1.
 *
 * Blocker 2: AI path requires interpretation_id (loaded + bound in SQL RPC).
 *   Manual path forces model_id='manual', raw_prompt=NULL.  Never accepts
 *   client model metadata or stores caller prompt on resolve.
 * Blocker 4: enrollment matching uses check_active_enrollments_normalized
 *   RPC (lower(trim()) + functional index), not case-sensitive .in().
 * Blocker 5: true keyset pagination via .gt("id", lastId) + .limit(),
 *   with a truthful truncation probe at SCAN_HARD_CAP (10,000).
 *
 * Never calls AI.  Never calls Smartlead.  Never launches/sends.
 */
async function resolveAudience(
  clientSpec: AudienceSpecV1 | null,
  userId: string,
  authHeader: string,
  confirmUnfiltered: boolean,
  interpretationId: string | null,
): Promise<Record<string, unknown>> {
  // ── Determine spec source: interpretation (AI) or client (manual) ──
  let spec: AudienceSpecV1;
  let hash: string;

  if (interpretationId) {
    // AI path: load interpretation from DB (read-only, for spec access).
    // The binding + consumption happens atomically in the SQL RPC below.
    const { data: interp, error: interpErr } = await svc
      .from("campaign_audience_interpretations")
      .select("user_id, spec, spec_hash, model_id, brief, expires_at, consumed_at")
      .eq("id", interpretationId)
      .single();
    if (interpErr || !interp) throw new Error("Interpretation not found");
    if (interp.user_id !== userId) throw new Error("Interpretation belongs to a different user");
    if (interp.consumed_at) throw new Error("Interpretation already consumed");
    if (new Date(interp.expires_at as string) < new Date()) throw new Error("Interpretation has expired");

    spec = interp.spec as AudienceSpecV1;
    hash = interp.spec_hash as string;
  } else {
    // Manual path: spec from client, model_id forced to 'manual'
    if (!clientSpec) throw new Error("spec is required for manual resolution");
    spec = clientSpec;
    hash = await specHash(spec);
  }

  // 1. Validate spec server-side
  const specErrors = validateAudienceSpec(spec);
  if (specErrors.length > 0) {
    throw new Error(`Invalid spec: ${specErrors.map((e) => e.message).join("; ")}`);
  }
  if (isUnfilteredSpec(spec) && !confirmUnfiltered) {
    throw new Error("Spec has no active filters and would match all contacts. Pass confirm_unfiltered: true to proceed.");
  }

  const userDb = callerClient(authHeader);
  const filters = spec.filters;

  // 2. Fetch partner account IDs via authoritative v_partner_accounts view
  const partnerAccountIds = new Set<string>();
  {
    let partnerLastId = "00000000-0000-0000-0000-000000000000";
    const PAGE = 1000;
    for (;;) {
      const { data, error } = await svc
        .from("v_partner_accounts")
        .select("id")
        .gt("id", partnerLastId)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (error) throw new Error("Partner account query failed: " + error.message);
      for (const row of (data ?? []) as { id: string }[]) {
        partnerAccountIds.add(row.id);
        partnerLastId = row.id;
      }
      if (!data || data.length < PAGE) break;
    }
  }

  // 3. Query contacts + accounts via caller-JWT (RLS-scoped).
  //    NO server-side .in() for targeting filters — NULLs must surface as
  //    ambiguous, not be silently excluded by PostgREST.
  //    Blocker 5: true keyset pagination via .gt("id", lastId) + .limit().
  const stateSet = filters.state_values && filters.state_values.length > 0
    ? new Set(filters.state_values.map((s) => s.toUpperCase()))
    : null;
  const icSet = filters.industry_category_values && filters.industry_category_values.length > 0
    ? new Set<string>(filters.industry_category_values)
    : null;
  const psSet = filters.project_segment_values && filters.project_segment_values.length > 0
    ? new Set<string>(filters.project_segment_values)
    : null;

  type RawContact = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    email2: string | null;
    email3: string | null;
    account_id: string;
    archived_at: string | null;
    do_not_contact: boolean | null;
    no_longer_employed: boolean | null;
    mailing_state: string | null;
    accounts: {
      id: string;
      name: string | null;
      industry_category: string | null;
      project_segment: string | null;
      industry: string | null;
      billing_state: string | null;
      shipping_state: string | null;
      account_type: string | null;
      customer_status: string | null;
      do_not_contact: boolean | null;
      archived_at: string | null;
    };
  };

  interface MemberRow {
    contact_id: string;
    account_id: string;
    email_normalized: string;
    disposition: string;
    reason_codes: string[];
    snapshot_industry_category: string | null;
    snapshot_project_segment: string | null;
    snapshot_state: string | null;
    snapshot_customer_status: string | null;
    snapshot_account_type: string | null;
    snapshot_account_name: string | null;
  }

  const members: MemberRow[] = [];
  const seenEmails = new Map<string, number>();
  let totalScanned = 0;
  let scanTruncated = false;
  let totalDuplicateContacts = 0;

  // Keyset pagination: track the last processed contact ID
  let lastContactId = "00000000-0000-0000-0000-000000000000";
  const CONTACT_PAGE = 1000;

  while (totalScanned < SCAN_HARD_CAP) {
    const query = userDb
      .from("contacts")
      .select(`
        id, first_name, last_name, email, email2, email3,
        account_id, archived_at, do_not_contact, no_longer_employed,
        mailing_state,
        accounts!inner (
          id, name, industry_category, project_segment, industry,
          billing_state, shipping_state, account_type, customer_status,
          do_not_contact, archived_at
        )
      `)
      .is("archived_at", null)
      .not("email", "is", null)
      .neq("email", "")
      .is("accounts.archived_at", null)
      .gt("id", lastContactId)
      .order("id", { ascending: true })
      .limit(CONTACT_PAGE);

    const { data: pageData, error: pageErr } = await query;
    if (pageErr) throw new Error(`Contact query failed: ${pageErr.message}`);
    const contacts = (pageData ?? []) as unknown as RawContact[];
    if (contacts.length === 0) break;

    for (const c of contacts) {
      totalScanned++;
      lastContactId = c.id;

      const a = c.accounts;
      const primaryEmail = normalizeEmail(c.email);
      if (!primaryEmail || !isPlausibleEmail(primaryEmail)) continue;

      // Client-side targeting filter: match / ambiguous / nonmatch
      let isNonmatch = false;

      if (icSet) {
        if (a.industry_category && !icSet.has(a.industry_category)) {
          isNonmatch = true;
        }
      }
      if (psSet && !isNonmatch) {
        if (a.project_segment && !psSet.has(a.project_segment)) {
          isNonmatch = true;
        }
      }
      if (stateSet && !isNonmatch) {
        const hasBilling = !!a.billing_state;
        const hasMailing = !!c.mailing_state;
        const billingMatch = hasBilling && stateSet.has(a.billing_state!.toUpperCase());
        const mailingMatch = hasMailing && stateSet.has(c.mailing_state!.toUpperCase());
        if ((hasBilling || hasMailing) && !billingMatch && !mailingMatch) {
          isNonmatch = true;
        }
      }

      if (isNonmatch) continue;

      const reasons: string[] = [];

      let isAmbiguous = false;
      if (icSet && !a.industry_category) {
        reasons.push("no_industry_category_set");
        isAmbiguous = true;
      }
      if (psSet && !a.project_segment) {
        reasons.push("no_project_segment_set");
        isAmbiguous = true;
      }
      if (stateSet && !a.billing_state && !c.mailing_state) {
        reasons.push("no_state_set");
        isAmbiguous = true;
      }

      if (a.customer_status === "client") reasons.push("customer_account");
      if (a.customer_status === "former_client") reasons.push("former_customer_account");
      if (partnerAccountIds.has(a.id)) reasons.push("partner_account");
      if (c.do_not_contact) reasons.push("contact_do_not_contact");
      if (a.do_not_contact) reasons.push("account_do_not_contact");
      if (c.no_longer_employed) reasons.push("contact_no_longer_employed");

      const existingIdx = seenEmails.get(primaryEmail);
      if (existingIdx !== undefined) {
        totalDuplicateContacts++;
        const canonical = members[existingIdx];
        canonical.reason_codes.push(`duplicate_contact:${c.id}:${a.id}`);
        continue;
      }

      const hasExclusions = reasons.some((r) =>
        r === "customer_account" || r === "former_customer_account" ||
        r === "partner_account" || r === "contact_do_not_contact" ||
        r === "account_do_not_contact" || r === "contact_no_longer_employed"
      );
      const disposition = isAmbiguous ? "ambiguous" : hasExclusions ? "excluded" : "eligible";

      seenEmails.set(primaryEmail, members.length);
      members.push({
        contact_id: c.id,
        account_id: a.id,
        email_normalized: primaryEmail,
        disposition,
        reason_codes: reasons,
        snapshot_industry_category: a.industry_category,
        snapshot_project_segment: a.project_segment,
        snapshot_state: a.billing_state ?? c.mailing_state,
        snapshot_customer_status: a.customer_status,
        snapshot_account_type: a.account_type,
        snapshot_account_name: a.name,
      });
    }

    if (contacts.length < CONTACT_PAGE) break;
    if (totalScanned >= SCAN_HARD_CAP) {
      // Truthful truncation probe: the cap-th contact was processed above;
      // now check whether more contacts exist beyond it.
      const { data: probe } = await userDb
        .from("contacts")
        .select("id")
        .gt("id", lastContactId)
        .is("archived_at", null)
        .not("email", "is", null)
        .neq("email", "")
        .limit(1);
      scanTruncated = (probe?.length ?? 0) > 0;
      break;
    }
  }

  // 4. Service-role checks: suppression + active enrollments
  const eligibleEmails = members
    .filter((m) => m.disposition === "eligible")
    .map((m) => m.email_normalized);

  // Suppression check (batched + paginated)
  const suppressionMap = new Map<string, string[]>();
  if (eligibleEmails.length > 0) {
    const BATCH = 500;
    const PAGE = 1000;
    for (let i = 0; i < eligibleEmails.length; i += BATCH) {
      const batch = eligibleEmails.slice(i, i + BATCH);
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await svc
          .from("v_marketing_suppression")
          .select("email, reason")
          .in("email", batch)
          .order("email", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw new Error("Suppression check failed: " + error.message);
        const rows = (data ?? []) as { email: string; reason: string }[];
        for (const row of rows) {
          const norm = normalizeEmail(row.email);
          const existing = suppressionMap.get(norm);
          if (existing) {
            if (!existing.includes(row.reason)) existing.push(row.reason);
          } else {
            suppressionMap.set(norm, [row.reason]);
          }
        }
        if (rows.length < PAGE) break;
      }
    }
  }

  // Blocker 4: case-insensitive enrollment matching via normalized RPC
  // (uses lower(trim()) + functional index, not raw .in())
  const activeEnrollmentEmails = new Set<string>();
  if (eligibleEmails.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < eligibleEmails.length; i += BATCH) {
      const batch = eligibleEmails.slice(i, i + BATCH);
      const { data, error } = await svc.rpc(
        "check_active_enrollments_normalized",
        { p_emails: batch },
      );
      if (error) throw new Error("Enrollment check failed: " + error.message);
      const matched = (data ?? []) as string[];
      for (const email of matched) {
        activeEnrollmentEmails.add(email);
      }
    }
  }

  // Apply suppression + enrollment to eligible members
  for (const m of members) {
    if (m.disposition !== "eligible") continue;
    const suppReasons = suppressionMap.get(m.email_normalized);
    if (suppReasons?.length) {
      m.disposition = "excluded";
      m.reason_codes.push(...suppReasons);
      continue;
    }
    if (activeEnrollmentEmails.has(m.email_normalized)) {
      m.disposition = "active_enrollment";
      m.reason_codes.push("active_enrollment_elsewhere");
    }
  }

  // 5. Apply max_results cap
  const eligible = members.filter((m) => m.disposition === "eligible");
  if (eligible.length > spec.max_results) {
    for (let i = spec.max_results; i < eligible.length; i++) {
      eligible[i].disposition = "excluded";
      eligible[i].reason_codes.push("over_max_results_cap");
    }
  }

  // 6. Summary counts
  const counts = {
    total_scanned: totalScanned,
    scan_truncated: scanTruncated,
    total_matched: members.length,
    total_eligible: members.filter((m) => m.disposition === "eligible").length,
    total_excluded: members.filter((m) => m.disposition === "excluded").length,
    total_ambiguous: members.filter((m) => m.disposition === "ambiguous").length,
    total_duplicate: totalDuplicateContacts,
    total_active_enrollment: members.filter((m) => m.disposition === "active_enrollment").length,
  };

  // 7. Persist provenance via transactional RPC.
  //    Blocker 2: interpretation_id binds server-owned spec/hash/model/prompt
  //    atomically.  Manual path: model_id='manual', raw_prompt=NULL (forced in SQL).
  const runPayload = {
    user_id: userId,
    spec: spec,
    spec_hash: hash,
    total_matched: counts.total_matched,
    total_eligible: counts.total_eligible,
    total_excluded: counts.total_excluded,
    total_ambiguous: counts.total_ambiguous,
    total_duplicate: counts.total_duplicate,
    total_active_enrollment: counts.total_active_enrollment,
  };
  const memberPayload = members.map((m) => ({
    contact_id: m.contact_id,
    account_id: m.account_id,
    email_normalized: m.email_normalized,
    disposition: m.disposition,
    reason_codes: m.reason_codes,
    snapshot_industry_category: m.snapshot_industry_category,
    snapshot_project_segment: m.snapshot_project_segment,
    snapshot_state: m.snapshot_state,
    snapshot_customer_status: m.snapshot_customer_status,
    snapshot_account_type: m.snapshot_account_type,
    snapshot_account_name: m.snapshot_account_name,
  }));
  const { data: runId, error: rpcErr } = await svc.rpc(
    "create_audience_run_with_members",
    {
      p_run: runPayload,
      p_members: memberPayload,
      p_interpretation_id: interpretationId,
    },
  );
  if (rpcErr) throw new Error("Failed to persist audience provenance: " + rpcErr.message);

  // 8. Response
  const preview = (m: MemberRow) => ({
    contact_id: m.contact_id,
    account_id: m.account_id,
    email: m.email_normalized,
    disposition: m.disposition,
    reason_codes: m.reason_codes,
    account_name: m.snapshot_account_name,
    industry_category: m.snapshot_industry_category,
    state: m.snapshot_state,
  });

  return {
    success: true,
    run_id: runId,
    interpretation_id: interpretationId,
    spec_hash: hash,
    counts,
    eligible: members.filter((m) => m.disposition === "eligible").slice(0, spec.max_results).map(preview),
    excluded: members.filter((m) => m.disposition === "excluded").map(preview),
    ambiguous: members.filter((m) => m.disposition === "ambiguous").map(preview),
    active_enrollments: members.filter((m) => m.disposition === "active_enrollment").map(preview),
  };
}

// ── HTTP handler ─────────────────────────────────────────────────────────

/** Actions open to all authenticated users for AI audience features only.
 *  All other actions (ideas/insights/training/analyze) stay admin-only. */
const REP_ELIGIBLE_AI_ACTIONS = new Set([
  "interpret-audience",
  "resolve-audience",
]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    const body = await req.json().catch(() => ({}));
    const action = body.action ?? "generate-ideas";
    const svcCaller = isServiceRole(auth);

    // Per-action auth: audience actions open to all authenticated,
    // everything else stays admin/service-role only.
    if (REP_ELIGIBLE_AI_ACTIONS.has(action)) {
      if (!svcCaller) {
        const uid = await callerUserId(auth);
        if (!uid) return json({ error: "Sign in required" }, 401);
      }
    } else {
      if (!svcCaller && !(await callerIsAdmin(auth))) {
        return json({ error: "Admin only" }, 403);
      }
    }

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
      return json(await analyzeCampaign(body.campaignId, body.force === true));
    }
    if (action === "campaign-insights") {
      return json(await campaignInsights(body.campaign_id));
    }

    // ── AI Audience actions ────────────────────────────────────────────
    if (action === "interpret-audience") {
      const uid = await callerUserId(auth);
      if (!uid) return json({ error: "Sign in required" }, 401);
      return json(await interpretAudience(body.brief ?? "", uid));
    }
    if (action === "resolve-audience") {
      const uid = await callerUserId(auth);
      if (!uid) return json({ error: "Sign in required" }, 401);
      if (!auth) return json({ error: "Sign in required" }, 401);
      const confirmUnfiltered = body.confirm_unfiltered === true;
      // Blocker 2: AI path provides interpretation_id (server-persisted);
      // manual path provides raw spec.  Never accept client model metadata
      // or store caller prompt on resolve.
      const interpId = typeof body.interpretation_id === "string" ? body.interpretation_id : null;
      const clientSpec = interpId ? null : (body.spec as AudienceSpecV1 | null);
      if (!interpId && !clientSpec) {
        return json({ error: "Either interpretation_id (AI path) or spec (manual path) is required" }, 400);
      }
      return json(await resolveAudience(
        clientSpec,
        uid,
        auth,
        confirmUnfiltered,
        interpId,
      ));
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
