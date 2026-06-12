// Meddy shared core — constants, helpers, and side-effect plumbing.
//
// Everything marked VERBATIM is copied from OG Nexus (server.js /
// meddy-widget.js) per the port rule: copy the brains, don't rebuild.
// Research citations live in PULSE-GAME-PLAN/meddy-port/.

// ── VERBATIM keyword/phrase lists (server.js:769, 1172) ─────────────
export const BUYING_KEYWORDS = [
  "pricing", "price", "cost", "quote", "demo", "purchase", "buy",
  "get started", "sign up", "subscribe", "how much", "proposal", "trial",
  "implementation", "interested", "ready to", "want to start", "per year",
  "contract", "budget",
];

export const HUMAN_REQUEST_PHRASES = [
  "talk to someone", "talk to a person", "talk to a human",
  "speak to someone", "speak to a person", "speak to a human",
  "speak with someone", "speak with a person", "real person",
  "human agent", "connect me with", "need help from a person",
  "need help from your team", "talk to a real", "want to talk to",
  "can i talk to", "can i speak", "let me talk", "transfer me",
  "get me a human", "agent please", "representative",
];

// VERBATIM pricing-followup lists (server.js:1555-1577)
export const PRICING_AFFIRMATIVES = [
  "yes", "sure", "yeah", "please", "okay", "ok", "yep", "absolutely",
  "definitely", "sounds good",
];
export const PRICING_TRIGGER_WORDS = [
  "$", "per year", "pricing", "demo", "schedule", "starts at", "cost",
];

// ── VERBATIM user-facing strings ─────────────────────────────────────
export const FALLBACK_GREETING =
  "Hi there! I'm Meddy, Medcurity's HIPAA compliance assistant. How can I help you today?";
export const LIMIT_REPLY =
  "Thanks for chatting with us! You've been really thorough. For further assistance, please reach out to our team directly at medcurity.com/contact or call (509) 867-3645. We'd love to help!";
export const NO_KEY_REPLY =
  "I'm currently unable to respond. Please contact our team at medcurity.com/contact or (509) 867-3645.";
export const TIMEOUT_REPLY =
  "I'm having trouble connecting right now. Please try again in a moment, or reach us at medcurity.com/contact or (509) 867-3645.";
export const ERROR_REPLY = "Sorry, something went wrong. Please try again.";
export const TAKEOVER_SYSTEM_MESSAGE =
  "You're now connected with a Medcurity team member.";
export const LEAD_FORM_REPLY =
  "Great! Just share your name and email and someone from our team will follow up with details.";
export const HUMAN_REQUEST_REPLY_OPEN =
  "I've let our team know. Someone will be with you shortly!";
export const HUMAN_REQUEST_REPLY_CLOSED =
  "Our team is available Mon-Fri, 8AM-5PM Pacific. Leave your info below and we'll reach out.";
export const HUMAN_REQUEST_ALERT = "⚠ Human requested by visitor";
export const VISITOR_ENDED_MESSAGE = "Visitor ended the conversation.";
export const FORM_ALREADY_CAPTURED =
  "Contact info already captured for this conversation";
export const FORM_SENT_MESSAGE = "Contact form sent to visitor";

export const MEDDY_MODEL = "claude-haiku-4-5-20251001";

// ── Business hours: Mon-Fri 8AM-5PM Pacific (server.js:762-766) ──────
export function isBusinessHours(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour12: false,
    weekday: "short",
    hour: "numeric",
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  return isWeekday && hour >= 8 && hour < 17;
}

// ── VERBATIM AI post-processing (meddy-widget.js:48-73 / server.js) ──
export function removeTrailingFollowUp(text: string): string {
  if (!text) return text;
  text = text.trim();
  const qIdx = text.lastIndexOf("?");
  if (qIdx === -1 || qIdx < text.length * 0.5) return text;
  let sentStart = 0;
  for (let i = qIdx - 1; i >= 0; i--) {
    if (
      (text[i] === "." || text[i] === "!" || text[i] === "?") &&
      i + 1 < text.length &&
      text[i + 1] === " "
    ) {
      sentStart = i + 2;
      break;
    }
  }
  const lastSentence = text.substring(sentStart, qIdx + 1).trim().toLowerCase();
  const followUpPhrases = [
    "would you like", "want to know", "can i help", "any questions",
    "anything else", "interested in", "want me to", "like to know",
    "shall i", "do you want", "need any", "like more", "help with anything",
    "want to learn", "know more about", "have any questions", "like me to",
    "need more details", "want additional", "like to learn",
  ];
  if (followUpPhrases.some((p) => lastSentence.indexOf(p) !== -1)) {
    const cleaned = text.substring(0, sentStart).trim();
    return cleaned || text;
  }
  return text;
}

/** Em-dash strip + trailing-follow-up removal (server.js:1205-1208). */
export function postProcessAiResponse(text: string): string {
  return removeTrailingFollowUp((text ?? "").replace(/—/g, " - "));
}

// ── Anthropic (non-streaming) helper ─────────────────────────────────
export async function aiComplete(opts: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  cacheSystem?: boolean;
}): Promise<string | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ac.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MEDDY_MODEL,
        max_tokens: opts.maxTokens,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        system: opts.cacheSystem
          ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
          : opts.system,
        messages: opts.messages,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text;
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Realtime broadcast (server → widget/dashboard channels) ──────────
// Widget channel:    meddy:conv:<visitor_id>
// Dashboard channel: meddy:dashboard
export async function broadcast(
  topic: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ topic, event, payload, private: false }],
      }),
    });
  } catch (e) {
    console.warn(`broadcast ${topic}/${event} failed:`, (e as Error).message);
  }
}

// ── In-app notifications fan-out ─────────────────────────────────────
// Nexus ALWAYS creates the rows and lets the client decide banner/sound
// per user preference (server.js:1363-1365) — preserved.
// deno-lint-ignore no-explicit-any
type DbClient = any;

export async function notifyUsers(
  svc: DbClient,
  audience: "all" | "available" | string[],
  type: string,
  title: string,
  message: string,
  conversationId?: string | null,
): Promise<void> {
  let userIds: string[];
  if (Array.isArray(audience)) {
    userIds = audience;
  } else if (audience === "available") {
    const { data } = await svc
      .from("meddy_agent_status")
      .select("user_id")
      .eq("available", true);
    userIds = (data ?? []).map((r: { user_id: string }) => r.user_id);
  } else {
    const { data } = await svc
      .from("user_profiles")
      .select("id")
      .eq("is_active", true);
    userIds = (data ?? []).map((r: { id: string }) => r.id);
  }
  if (userIds.length === 0) return;
  await svc.from("notifications").insert(
    userIds.map((uid) => ({
      user_id: uid,
      type,
      title,
      message,
      link: "/meddy",
      conversation_id: conversationId ?? null,
    })),
  );
}

// ── Pushover (ported from server.js:795-882) ─────────────────────────
export async function sendPushover(
  userKey: string,
  title: string,
  message: string,
  opts?: { priority?: number; url?: string },
): Promise<void> {
  const token = (Deno.env.get("PUSHOVER_APP_TOKEN") ?? "").trim();
  if (!token || !userKey) return;
  const priority = opts?.priority ?? 0;
  const body: Record<string, string | number> = {
    token,
    user: userKey,
    title,
    message,
    sound: "pushover",
    priority,
    url: opts?.url ?? Deno.env.get("APP_BASE_URL") ?? "https://crm.medcurity.com",
    url_title: "Open in Pulse",
  };
  if (priority === 2) {
    body.retry = 30;
    body.expire = 300;
  }
  try {
    await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn("pushover failed:", (e as Error).message);
  }
}

/** One-sentence chat summary for phone pushes (server.js:823-841). */
export async function getConversationSummary(
  svc: DbClient,
  conversationId: string,
): Promise<string> {
  const { data: msgs } = await svc
    .from("meddy_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .eq("is_internal", false)
    .order("created_at", { ascending: false })
    .limit(5);
  const transcript = (msgs ?? [])
    .reverse()
    .map((m: { role: string; content: string }) =>
      `${m.role === "visitor" ? "Visitor" : "Meddy"}: ${m.content.substring(0, 200)}`)
    .join("\n");
  const summary = await aiComplete({
    system:
      "Summarize this chat in one sentence. Be specific about what the visitor is asking about. No filler.",
    messages: [{ role: "user", content: transcript || "(no messages yet)" }],
    maxTokens: 100,
    temperature: 0.2,
    timeoutMs: 5000,
  });
  return summary ?? "A visitor is requesting a human in Meddy chat.";
}

export async function pushoverAllKeyedUsers(
  svc: DbClient,
  title: string,
  message: string,
  opts?: { priority?: number; url?: string },
): Promise<void> {
  const { data } = await svc
    .from("user_notification_prefs")
    .select("pushover_key")
    .not("pushover_key", "is", null);
  for (const row of data ?? []) {
    if (row.pushover_key) await sendPushover(row.pushover_key, title, message, opts);
  }
}
