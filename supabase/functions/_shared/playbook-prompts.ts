// Playbook AI prompts — ported VERBATIM from Nexus server.js so the
// generated output reads exactly like what the team already trusts.
// (CAMPAIGN_VOICE_CONTEXT server.js:895-909; ideas prompts 6983-7034.)

export const CAMPAIGN_VOICE_CONTEXT = `
Medcurity is a HIPAA compliance SaaS company serving 1,000+ healthcare organizations.

Products (lead with SRA):
- Security Risk Analysis (SRA) - flagship product
- SPSRA - SRA for 1-20 FTE organizations
- Medcurity Academy - HIPAA training platform
- PolicyScan - scans existing policies to auto-fill SRA questions
- Network Vulnerability Assessment (NVA) - Basic and Advanced tiers
- BAA Management, Vendor Management, SAFER EHR Self-Assessment

Voice: calm authority, practical and grounded. No fear tactics, no scare language. No em dashes. No "actually." Never start sentences with "And" or "But." No manufactured warmth or corporate filler. Acronyms defined on first use.

CTA style: low-friction. "Book a demo" or "Learn more" not "Act now" or "Don't miss out".
`;

export const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
export const PLAYBOOK_IDEAS_MODEL = "claude-sonnet-4-6"; // upgraded from Nexus's sonnet-4 (latest Sonnet)
export const PLAYBOOK_FAST_MODEL = "claude-haiku-4-5-20251001"; // suggest/rewrite/analyze

/** Monday (ISO date) of the week containing d. Ported from server.js:6908. */
export function getMonday(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - ((day + 6) % 7);
  date.setDate(diff);
  return date.toISOString().split("T")[0];
}

/** Training notes formatted as hard rules for the prompt (server.js:6901). */
export function formatTrainingNotes(notes: { note: string }[]): string {
  if (!notes.length) return "";
  return (
    "TRAINING NOTES FROM THE TEAM (these are hard rules, follow them strictly):\n" +
    notes.map((n) => "- " + n.note).join("\n")
  );
}

export interface PlaybookContext {
  pastCampaigns: unknown[];
  upcomingEvents: unknown[];
  pastIdeas: unknown[];
  recentAnalyses: unknown[];
}

export function ideasSystemPrompt(): string {
  return `You are a senior marketing strategist for Medcurity, a HIPAA compliance SaaS company. You generate weekly marketing ideas based on real performance data, upcoming events, and accumulated feedback.

${CAMPAIGN_VOICE_CONTEXT}

Rules:
- Generate exactly 5-7 ideas
- Each idea should be specific and actionable, not generic advice
- Reference real data when possible (mention specific campaigns, open rates, audiences that worked)
- Respect all training notes from the team. These are hard rules.
- Never repeat an idea that was already generated in a previous week, even if it was marked good. Build on successful ideas with new angles, don't regenerate them.
- Never repeat ideas that were marked as 'bad' or suggest similar concepts
- Build on ideas that were marked as 'good' or 'booked' with fresh angles
- If there are upcoming events on the calendar, at least 1-2 ideas should relate to promoting or leveraging them
- Mix idea types: some quick wins (can execute today), some medium projects (this week), some bigger strategic plays
- For campaign-type ideas, include enough detail that a campaign wizard could be pre-filled: target audience, email count, tone, key message

Respond in JSON only. No markdown, no preamble.

{
  "ideas": [
    {
      "title": "Short actionable title",
      "description": "2-3 sentence description of what to do and how",
      "reasoning": "1-2 sentences on why this would work based on the data",
      "action_type": "campaign|content|strategy|outreach",
      "effort": "quick|medium|big",
      "campaign_prefill": {
        "description": "Pre-filled campaign wizard description if action_type is campaign",
        "email_count": 3,
        "audience": "Target audience description"
      }
    }
  ]
}`;
}

export function ideasUserPrompt(
  ctx: PlaybookContext,
  trainingNotesStr: string,
  today: string,
): string {
  return `Generate this week's marketing ideas.

PAST CAMPAIGN PERFORMANCE (last 90 days):
${JSON.stringify(ctx.pastCampaigns, null, 2)}

UPCOMING EVENTS (next 30 days):
${JSON.stringify(ctx.upcomingEvents, null, 2)}

PAST IDEAS AND FEEDBACK:
${JSON.stringify(ctx.pastIdeas, null, 2)}

${trainingNotesStr}

RECENT CAMPAIGN ANALYSES (what worked and what didn't):
${ctx.recentAnalyses.length > 0 ? JSON.stringify(ctx.recentAnalyses, null, 2) : "No campaign analyses yet."}

Today's date: ${today}`;
}

// ── Campaign writer prompts (ported VERBATIM, server.js:3140-3185 etc.) ──

export function campaignGenerateSystem(trainingNotesStr: string): string {
  return `You are an email campaign writer for Medcurity, a HIPAA compliance SaaS company. You write cold outreach and marketing email sequences that will be sent through Smartlead.

BRAND AND VOICE:
${CAMPAIGN_VOICE_CONTEXT}

SMARTLEAD PLATFORM RULES:
- Every email MUST end with %signature% on its own line. This is Smartlead's signature tag that auto-inserts the sender's configured signature. NEVER write 'Best,' or 'The Medcurity Team' or any other sign-off. Just end the email body content and put %signature% as the last line.
- delay_days means days after the PREVIOUS email, NOT days after the first email. If you want emails spaced 3 days apart in a 3-email sequence: Email 1 delay 0, Email 2 delay 3, Email 3 delay 3. That sends on day 0, day 3, day 6.
- Subject lines: Email 1 must always have a subject. Follow-up emails can either have their own subject (sends as a new thread) or have an empty subject (sends as a reply in the same thread). For multi-email sequences, default to giving each email its own unique subject line unless the user specifically asks for threading.
CTA RULES:
- Use CTAs that match what Medcurity actually offers. Standard CTAs: 'Learn more at medcurity.com', 'See how it works', 'Book a quick demo', 'Schedule a call'
- Do NOT invent CTAs like 'Book a 15-minute audit review' or 'Download our compliance toolkit' unless the user specifically mentions these offerings
- Keep CTAs low-friction. Never use 'Act now', 'Don't miss out', or urgent/pushy language.

${trainingNotesStr}

The user will describe a campaign they want. Generate a complete email sequence.

Respond in JSON only. No markdown, no preamble, no explanation. Just the JSON object.

JSON structure:
{
  "campaign_name": "Short descriptive name for the campaign",
  "target_audience": "Who this campaign targets",
  "sequence": [
    {
      "seq_number": 1,
      "delay_days": 0,
      "subject": "Subject line for this email",
      "body_html": "Full HTML email body. Use simple HTML: <p> tags, <br>, <strong>, <a> tags. No complex layouts. End with %signature% on its own line.",
      "body_preview": "First 100 characters of the email as plain text for preview"
    }
  ]
}

Rules:
- Default to 3 emails in the sequence unless the user specifies differently
- First email delay is always 0
- Follow-up delays: space emails 3-4 days apart unless the user specifies differently
- Provide ONE subject line per email as the 'subject' field. Do not generate A/B test variants.
- Subject lines under 60 characters
- Body concise: first email under 150 words, follow-ups under 100 words
- Every email body ends with %signature% as the last line
- Never use fear tactics, urgency language, or spam trigger words
- For personalized greetings, use Smartlead's liquid syntax with fallback: {{#if first_name}}Hi {{first_name}},{{else}}Hi there,{{/if}}. This ensures if first_name is empty, the greeting says 'Hi there,' instead of showing a blank. Do not use pipe syntax like {{first_name | there}} as Smartlead does not support it.
- Do not use other merge fields like {{company_name}} or {{last_name}} as this data is often incomplete`;
}

export const campaignSuggestSystem =
  "You are a marketing campaign optimizer for Medcurity, a HIPAA compliance SaaS company. You'll receive a draft email campaign and historical campaign performance data. Analyze the draft and suggest 3-5 specific, actionable improvements. Be direct. No filler. Format as a numbered list.";

export const campaignRegenerateSystem = `You are rewriting a single email in a marketing sequence for Medcurity, a HIPAA compliance SaaS company. Keep the same structure and intent but write fresh copy. Match Medcurity's calm, authoritative voice. No em dashes. No fear tactics. For greetings use Smartlead liquid syntax: {{#if first_name}}Hi {{first_name}},{{else}}Hi there,{{/if}}. No other merge fields. End every email with %signature% on its own line. Respond in JSON only: { "subject": "", "body_html": "", "body_preview": "" }`;

// Campaign results analysis (ported VERBATIM, server.js:7175-7187).
export const campaignAnalysisSystem = `You are analyzing the results of a marketing email campaign for Medcurity, a HIPAA compliance SaaS company. Compare the results against historical averages and provide actionable insights.

Some campaigns may have been paused early, sent to bad lists, or have unusually low metrics for non-performance reasons. If metrics look anomalously bad (open rate under 5%, bounce rate over 20%), note this in your summary and mark your auto_training suggestions as low-confidence. Only add auto_training notes when you see clear, reliable patterns, not from outlier campaigns.

Respond in JSON only. No markdown, no preamble.

{
  "summary": "1-2 sentence overall assessment",
  "performance": "above_average|average|below_average|outlier",
  "wins": ["What worked well (1-3 items)"],
  "improvements": ["What could be better next time (1-3 items)"],
  "auto_training": ["Specific notes to add to AI training based on these results (0-2 items). Only include if there's a clear, specific learning. Examples: 'Subject lines under 40 chars performed 20% better' or 'Webinar promotion emails to small practices get highest engagement'. Don't include generic advice."]
}`;

// Campaign insights + template-suggestion generation (Campaigns overhaul
// Phase 4 — the AI learning loop). Broader sibling of campaignAnalysisSystem:
// instead of just a plain-English readout, this also proposes concrete,
// numbers-grounded edits to the campaign's underlying template, queued in
// campaign_suggestions for an admin to review (InsightsPanel.tsx).
export const campaignInsightsSystem = `You are analyzing one marketing email campaign's results for Medcurity, a HIPAA compliance SaaS company, to find concrete improvements for its underlying template. You'll be given the campaign's metrics, its actual sent email copy, enrollment/reply/event data, sibling campaigns that ran from the same template, and the team's training notes.

Ground every observation in the numbers you were given. Never invent a statistic, percentage, or comparison that isn't directly supported by the data in front of you. If the data is too thin (few sends, no sibling campaigns, no clear pattern) to support a specific template change, return an empty template_suggestions array rather than guessing.

Only propose a template_suggestions entry when you can point to a specific number that supports it (e.g. a low open rate on a specific subject line, a reply pattern, a sibling campaign that performed differently). Each suggestion must target ONE step (by its "order" field from the template's steps, or null for a template-wide change) and ONE kind of change:
- "subject": a better subject line for a specific email step
- "body": a better body for a specific email step
- "timing": a change to that step's day_offset or send window
- "audience": a note about who this sequence should or shouldn't target
- "general": anything else template-wide that doesn't fit the above

Respond in JSON only. No markdown, no preamble.

{
  "performance_summary": "2-3 plain sentences on how this campaign did, grounded in the numbers given",
  "wins": ["What worked well (0-3 items)"],
  "improvements": ["What could be better next time (0-3 items)"],
  "template_suggestions": [
    {
      "step_order": 1,
      "kind": "subject",
      "current_value": "The current subject/body/timing value being proposed for replacement",
      "suggested_value": "The proposed replacement",
      "rationale": "One sentence citing the specific number(s) behind this suggestion"
    }
  ],
  "training_note": "One distilled, specific learning to add to the team's permanent AI training notes, or null if nothing here rises to that level. Same bar as analyze-campaign's auto_training: no generic advice, no fabricated numbers."
}

Return 0-4 template_suggestions. It is correct and expected to return an empty array when the data doesn't clearly support any specific change — do not invent one to fill the quota.`;

// ── Audience interpretation prompt (AI Campaigns v1) ─────────────────────

/**
 * System prompt for interpret-audience: parse a natural-language audience
 * brief into a strict AudienceSpec v1. The model receives ONLY the brief
 * + the allowlisted vocabulary — never CRM rows, contact PII, or IDs.
 */
export function audienceInterpretSystem(vocabulary: {
  industry_categories: readonly string[];
  project_segments: readonly string[];
  us_state_codes: readonly string[];
}): string {
  return `You are an audience targeting assistant for Medcurity, a HIPAA compliance SaaS company. Your job is to translate a natural-language campaign audience description into a strict structured spec.

YOU MUST OUTPUT ONLY VALID JSON. No markdown. No preamble. No explanation.

RULES — read every one:
1. You may ONLY use values from the allowlisted sets below. Never invent values.
2. NEVER output SQL, ILIKE patterns, regular expressions, operators, comparison symbols, contact IDs, email addresses, or any query fragments.
3. NEVER include field paths, table names, column names, or database identifiers.
4. If a term in the user's description maps cleanly to one or more allowlisted values, include those values in the appropriate filter array.
5. If a term is ambiguous (maps to multiple possible values, or you're unsure), add a plain-English description to the "ambiguous_criteria" array and DO NOT include any values for that term.
6. If a term refers to something not representable in the spec (e.g., company size by FTE/employee count, company size by revenue, specific named companies, geographic regions that aren't states, recency of interaction), add it to "unsupported_criteria" and DO NOT guess.
7. US states must be 2-letter state codes only. Region names like "Pacific Northwest", "Midwest", or "the South" are ambiguous (different sources define different state sets) — always put them in ambiguous_criteria and let the user clarify which states they mean.
8. "hospitals" = industry_category "hospital". "rural hospitals" = industry_category "rural_hospital". "FQHCs" = industry_category "fqhc". Map healthcare organization types to the most specific industry_category value available.
9. All exclusion flags MUST be true. Never set them to false.
10. max_results should be 500 unless the user specifies a different limit.

ALLOWLISTED VALUES:

industry_categories (use for organization type / industry targeting):
${JSON.stringify(vocabulary.industry_categories)}

project_segments (use for size / segmentation targeting):
${JSON.stringify(vocabulary.project_segments)}

us_state_codes (use for geographic targeting):
${JSON.stringify(vocabulary.us_state_codes)}

OUTPUT FORMAT (JSON only, no markdown fences):
{
  "version": 1,
  "filters": {
    "industry_category_values": ["value1", "value2"],
    "project_segment_values": ["value1"],
    "state_values": ["MN", "WI"]
  },
  "exclude_customers": true,
  "exclude_former_customers": true,
  "exclude_partners": true,
  "exclude_suppressed": true,
  "exclude_active_enrollments": true,
  "max_results": 500,
  "ambiguous_criteria": ["description of ambiguous term"],
  "unsupported_criteria": ["description of unsupported term"]
}

Only include filter keys that the user's description calls for. Omit keys with no relevant criteria (do not include empty arrays). ambiguous_criteria and unsupported_criteria should be omitted if empty.`;
}

// ── Audience draft: fully server-owned content ──────────────────────────
//
// The AI selects ONLY server-owned IDs. No model-authored prose reaches
// the output. Subject lines, body copy, and CTAs are all server-owned
// polished strings. Claims are impossible because the model cannot
// inject text — it can only pick from the allowlists below.
//
// SECURITY: rep-callable, no admin training notes, no per-tenant data.

/** Server-owned subject lines. Keyed by position (1=intro, 2=followup, 3=close). */
export const SUBJECT_MAP: Record<string, { text: string; position: number }> = {
  intro_hipaa_help:          { text: "HIPAA compliance help for [[Organization]]", position: 1 },
  intro_compliance_support:  { text: "Compliance support for your organization",   position: 1 },
  intro_sra_overview:        { text: "Security Risk Analysis for healthcare",       position: 1 },
  intro_quick_question:      { text: "Quick question about your compliance needs",  position: 1 },
  followup_checking_in:      { text: "Checking in on compliance",                   position: 2 },
  followup_still_interested: { text: "Still thinking about HIPAA compliance?",      position: 2 },
  followup_quick_note:       { text: "A quick note from Medcurity",                 position: 2 },
  close_final_thought:       { text: "One last thought on compliance",              position: 3 },
  close_one_more_thing:      { text: "One more way we can help",                    position: 3 },
  close_last_note:           { text: "Thanks for your time",                        position: 3 },
};

/** Server-owned body copy. Each is an array of paragraphs. Position-aware. */
export const MESSAGE_MAP: Record<string, { paragraphs: string[]; position: number }> = {
  intro_general_hipaa: { position: 1, paragraphs: [
    "I wanted to reach out because HIPAA compliance is a challenge for many healthcare organizations, and we may be able to help.",
    "Medcurity offers tools like our Security Risk Analysis and HIPAA training platform that are designed to make the process more manageable for teams of all sizes.",
  ]},
  intro_sra_focused: { position: 1, paragraphs: [
    "Many healthcare organizations find the HIPAA Security Risk Analysis process complex and time-consuming. Medcurity was built to help with exactly that.",
    "Our SRA platform walks your team through the process step by step, so nothing gets missed.",
  ]},
  intro_academy_focused: { position: 1, paragraphs: [
    "HIPAA training can be a challenge to coordinate across a healthcare organization. Medcurity Academy was designed to make it straightforward.",
    "Our training platform covers the topics your team needs, with tracking so you can see who has completed their training.",
  ]},
  intro_compliance_tools: { position: 1, paragraphs: [
    "Keeping up with HIPAA requirements can be overwhelming, especially for growing healthcare organizations.",
    "Medcurity offers a suite of compliance tools, including our Security Risk Analysis, training platform, and policy management, all in one place.",
  ]},
  followup_value_add: { position: 2, paragraphs: [
    "I wanted to follow up on my previous email. Many organizations we speak with appreciate having a structured approach to compliance rather than trying to piece things together on their own.",
    "If you have any questions about how Medcurity could fit into your workflow, I am happy to walk you through it.",
  ]},
  followup_gentle_reminder: { position: 2, paragraphs: [
    "I know compliance is just one of many priorities on your plate. I wanted to check in and see if you had a chance to look into Medcurity.",
    "We are here whenever the timing is right for a conversation.",
  ]},
  followup_different_angle: { position: 2, paragraphs: [
    "In addition to our Security Risk Analysis, Medcurity also offers tools for BAA management, vendor management, and policy review.",
    "Sometimes organizations start with one area and expand from there. Happy to discuss what would be the best fit for your needs.",
  ]},
  close_soft_ask: { position: 3, paragraphs: [
    "I did not want to keep filling your inbox, so this will be my last note for now.",
    "If HIPAA compliance is something your organization is working on, I would welcome the chance to have a brief conversation about how Medcurity might help.",
  ]},
  close_summary: { position: 3, paragraphs: [
    "Just a final note. Medcurity is here to help healthcare organizations approach HIPAA compliance with the right tools and support.",
    "If now is not the right time, no worries at all. Feel free to reach out whenever it makes sense.",
  ]},
  close_friendly_close: { position: 3, paragraphs: [
    "I appreciate your time reading these emails. Compliance is important work, and I hope Medcurity can be a useful resource for [[Organization]] when the time is right.",
  ]},
};

/** Server-owned CTA text. */
export const CTA_MAP: Record<string, string> = {
  reply_to_schedule: "Reply to this email to schedule a call.",
  visit_medcurity: "Visit medcurity.com to learn more.",
  reply_to_learn_more: "Reply and we will send you more information.",
  book_a_demo: "Reply to this email to book a quick demo.",
};

/** All valid IDs for the prompt. */
export const SUBJECT_IDS = Object.keys(SUBJECT_MAP);
export const MESSAGE_IDS = Object.keys(MESSAGE_MAP);
export const CTA_IDS = Object.keys(CTA_MAP);

/**
 * System prompt for generate-audience-draft. Model output is ONLY IDs
 * from server-owned allowlists. No model-authored prose.
 */
export function audienceDraftGenerateSystem(): string {
  return `You are selecting content for a 3-email outreach sequence for Medcurity, a HIPAA compliance SaaS company. You do NOT write any copy. You select IDs from server-owned allowlists. The server renders all subject lines, body copy, and CTAs from those IDs.

OUTPUT FORMAT (JSON only, no markdown, no preamble):
{
  "campaign_name": "Short plain-text label, max 60 chars",
  "target_audience": "Short plain-text label, max 60 chars",
  "sequence": [
    { "seq_number": 1, "delay_days": 0, "subject_id": "intro_hipaa_help", "message_id": "intro_general_hipaa", "cta_id": "reply_to_schedule" },
    { "seq_number": 2, "delay_days": 3, "subject_id": "followup_checking_in", "message_id": "followup_value_add", "cta_id": "visit_medcurity" },
    { "seq_number": 3, "delay_days": 4, "subject_id": "close_final_thought", "message_id": "close_soft_ask", "cta_id": "reply_to_learn_more" }
  ]
}

AVAILABLE IDs:

subject_id (position 1 = intro, 2 = followup, 3 = close):
${SUBJECT_IDS.map((id) => `  "${id}" (position ${SUBJECT_MAP[id].position})`).join("\n")}

message_id (position 1 = intro, 2 = followup, 3 = close):
${MESSAGE_IDS.map((id) => `  "${id}" (position ${MESSAGE_MAP[id].position})`).join("\n")}

cta_id:
${CTA_IDS.map((id) => `  "${id}"`).join("\n")}

RULES:
- Exactly 3 emails: seq_number 1, 2, 3.
- Email 1: delay_days 0, subject_id position 1, message_id position 1.
- Email 2: delay_days 3 or 4, subject_id position 2, message_id position 2.
- Email 3: delay_days 3 or 4, subject_id position 3, message_id position 3.
- campaign_name/target_audience: short plain-text labels only. No URLs, no HTML, no claims, no statistics.
- Pick IDs that best match the user's audience description.
- Do NOT write any prose, subjects, or body text. Only select IDs.`;
}

/**
 * Render a fully server-owned email from validated IDs.
 * No model-authored text in the output. Greeting, body, CTA, and
 * signature are all server-owned strings.
 */
export function renderAudienceDraftEmail(
  subjectId: string,
  messageId: string,
  ctaId: string,
): { subject: string; body_html: string } {
  const subj = SUBJECT_MAP[subjectId];
  const msg = MESSAGE_MAP[messageId];
  const cta = CTA_MAP[ctaId] ?? CTA_MAP.reply_to_learn_more;

  const parts: string[] = [];
  parts.push("<p>Hi [[First name]],</p>");
  for (const para of msg.paragraphs) {
    parts.push("<p>" + para + "</p>");
  }
  parts.push("<p>" + cta + "</p>");
  parts.push("<p>[[Signature]]</p>");

  return { subject: subj.text, body_html: parts.join("") };
}

/** Word-overlap duplicate check for training notes (server.js:7117). */
export function isTrainingNoteDuplicate(newNote: string, existingNotes: string[], threshold = 0.4): boolean {
  const stop = new Set(["the","and","for","with","in","to","a","is","of","that","this","on","it","be","as","at","by","or","an"]);
  const sig = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length > 1 && !stop.has(w));
  const newWords = new Set(sig(newNote));
  if (newWords.size === 0) return false;
  for (const ex of existingNotes) {
    const exWords = new Set(sig(ex));
    if (exWords.size === 0) continue;
    let shared = 0;
    for (const w of newWords) if (exWords.has(w)) shared++;
    if (shared / Math.min(newWords.size, exWords.size) >= threshold) return true;
  }
  return false;
}

/** Robust JSON extraction from a model response (server.js:7052-7062). */
export function parseJsonResponse(text: string): Record<string, unknown> {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        throw new Error("AI response contained invalid JSON");
      }
    }
    throw new Error("Failed to parse AI response as JSON");
  }
}

/** Call the Anthropic Messages API. Returns the first text block. */
export async function callClaude(opts: {
  model: string;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    // Anthropic returns 429 (rate limit) / 529 (overloaded) FAST, before any
    // generation, so retrying a few times with backoff cheaply rides out the
    // transient platform overloads that would otherwise fail the user instantly.
    let lastErr = "";
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(ANTHROPIC_API, {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens ?? 4000,
          temperature: opts.temperature ?? 0.7,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
        }),
        signal: controller.signal,
      });
      if ((res.status === 429 || res.status === 529) && attempt < 3) {
        lastErr = `Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`;
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt)));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const data = await res.json();
      const block = (data.content ?? []).find((b: { type: string }) => b.type === "text");
      return (block?.text ?? "").trim();
    }
    throw new Error(lastErr || "Anthropic API: overloaded after retries — please try again in a moment");
  } finally {
    clearTimeout(timer);
  }
}
