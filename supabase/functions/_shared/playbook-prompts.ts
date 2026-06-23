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
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
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
    if (!res.ok) {
      throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = await res.json();
    const block = (data.content ?? []).find((b: { type: string }) => b.type === "text");
    return (block?.text ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}
