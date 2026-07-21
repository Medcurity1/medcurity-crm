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
  // Broadcasts are best-effort; a hung Realtime endpoint must never stall
  // the calling action, so the fetch itself is aborted at 5s.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5_000);
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // The staff dashboard channel is PRIVATE (it carries visitor
        // message previews + staff names; the realtime authorization
        // policy in 20260702000005 gates subscribers to active staff).
        // Per-visitor widget channels stay public — anonymous visitors
        // subscribe to their own conversation with the anon key.
        messages: [{ topic, event, payload, private: topic === "meddy:dashboard" }],
      }),
    });
  } catch (e) {
    console.warn(`broadcast ${topic}/${event} failed:`, (e as Error).message);
  } finally {
    clearTimeout(timer);
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
      // Deep-link straight to the conversation when we have one.
      link: conversationId ? `/meddy?conversation=${conversationId}` : "/meddy",
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
): Promise<boolean> {
  const token = (Deno.env.get("PUSHOVER_APP_TOKEN") ?? "").trim();
  if (!token) {
    console.warn("PUSHOVER_APP_TOKEN not set - push skipped");
    return false;
  }
  if (!userKey) return false;
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
    const res = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    // Pushover returns {status: 1} on success; anything else (bad key,
    // bad token) is a real failure callers may want to surface.
    if (data?.status !== 1) {
      console.warn("pushover rejected:", JSON.stringify(data?.errors ?? data));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("pushover failed:", (e as Error).message);
    return false;
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

// ── Per-user email opt-ins (Nathan 2026-06-12: no recipient secrets;
// users toggle Meddy emails in My Settings → Notifications) ──────────
// Pref keys (all default OFF — absent key means not subscribed):
//   email_meddy_form_alert | email_meddy_missed_chat | email_meddy_weekly_report
export async function emailsForPref(svc: DbClient, prefKey: string): Promise<string[]> {
  const { data: rows } = await svc
    .from("user_notification_prefs")
    .select("user_id")
    .eq(`prefs->>${prefKey}`, "true");
  const out: string[] = [];
  for (const r of rows ?? []) {
    const { data: u } = await svc.auth.admin.getUserById(r.user_id);
    if (u?.user?.email) out.push(u.user.email);
  }
  return out;
}

/** Send one email to a recipient list from marketing@ via the designated
 * Outlook connection (same plumbing as request-email-notify). Silently
 * no-ops when there are no recipients or the sender isn't connected. */
export async function sendOutlookEmail(
  svc: DbClient,
  recipients: string[],
  subject: string,
  html: string,
): Promise<boolean> {
  if (recipients.length === 0) return false;
  const senderEmail = (Deno.env.get("REQUEST_NOTIFY_SENDER_EMAIL") ?? "nathang@medcurity.com").trim();
  const fromAddress = (Deno.env.get("REQUEST_NOTIFY_FROM") ?? "marketing@medcurity.com").trim();
  const { data: connRow } = await svc
    .from("email_sync_connections")
    .select("id, access_token, refresh_token, token_expires_at")
    .ilike("email_address", senderEmail)
    .eq("provider", "outlook")
    .eq("is_active", true)
    .maybeSingle();
  if (!connRow) return false;
  const { ensureValidOutlookToken } = await import("./graph-token.ts");
  const token = await ensureValidOutlookToken(svc, connRow);
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        from: { emailAddress: { address: fromAddress } },
        toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  });
  return res.ok;
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
