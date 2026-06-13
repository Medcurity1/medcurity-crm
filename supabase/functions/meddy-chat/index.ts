// meddy-chat Edge Function — the PUBLIC visitor-facing Meddy API.
//
// Ports OG Nexus's widget endpoints (/api/chat family, server.js) onto
// Supabase. One function, action-routed. Deployed with --no-verify-jwt
// (visitors are anonymous); writes use the service role; visitors NEVER
// read tables directly (history lives client-side in the widget, exactly
// like Nexus — see security note at server.js:1589-1591).
//
// Actions:
//   chat          {sessionId, message, clientMsgId?, pageUrl?, pageContext?}
//                 → SSE stream: {type:'text'|'state'|'limit_reached'|
//                   'show_lead_form'|'error'} ... data: [DONE]
//   contact       {sessionId, name, email, organization?, phone?}
//   request-human {sessionId, pageUrl?}
//   end           {sessionId}
//   status        {} → {anyAvailable, availableCount}
//   hours         {} → {open}
//
// Pipeline parity notes are inline; research: PULSE-GAME-PLAN/meddy-port/.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MEDDY_PROMPT_ADDENDUM, MEDDY_SYSTEM_PROMPT } from "../_shared/meddy-prompt.ts";
import {
  BUYING_KEYWORDS,
  HUMAN_REQUEST_PHRASES,
  PRICING_AFFIRMATIVES,
  PRICING_TRIGGER_WORDS,
  LIMIT_REPLY,
  NO_KEY_REPLY,
  TIMEOUT_REPLY,
  ERROR_REPLY,
  LEAD_FORM_REPLY,
  HUMAN_REQUEST_REPLY_OPEN,
  HUMAN_REQUEST_REPLY_CLOSED,
  HUMAN_REQUEST_ALERT,
  VISITOR_ENDED_MESSAGE,
  MEDDY_MODEL,
  isBusinessHours,
  postProcessAiResponse,
  aiComplete,
  broadcast,
  notifyUsers,
  getConversationSummary,
  pushoverAllKeyedUsers,
  emailsForPref,
  sendOutlookEmail,
} from "../_shared/meddy-core.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const svc = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// ── Per-IP rate limit (ports server.js:1159-1169: 150 req / 15 min).
// In-memory per isolate — best effort, same spirit as Nexus.
const rateMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let r = rateMap.get(ip);
  if (!r || now > r.resetAt) {
    r = { count: 0, resetAt: now + 15 * 60 * 1000 };
    rateMap.set(ip, r);
  }
  r.count++;
  return r.count <= 150;
}

// Per-conversation AI lock (ports _aiLocks, server.js:1173).
const aiLocks = new Set<string>();

interface Conv {
  id: string;
  visitor_id: string;
  status: string;
  assigned_to: string | null;
  is_human_requested: boolean;
  buying_intent_alerted: boolean;
  pricing_discussed: boolean;
  ai_message_count: number;
  visitor_name: string | null;
  visitor_email: string | null;
  form_alert_sent: boolean;
  source_site: string;
  page_url: string | null;
  crm_contact_id: string | null;
}

function deriveSourceSite(pageUrl?: string | null): string {
  if (pageUrl && pageUrl.includes("app.medcurity.com")) return "app";
  if (pageUrl && pageUrl.includes("meddy-test")) return "test";
  return "main";
}

/** Find-or-create by visitor_id (the Nexus duplicate-conversation fix:
 * unique index + idempotent insert). Fires new-conversation effects on
 * create (server.js:1705-1716). */
async function findOrCreateConversation(
  sessionId: string,
  pageUrl?: string | null,
): Promise<{ conv: Conv; created: boolean }> {
  const { data: existing } = await svc
    .from("meddy_conversations")
    .select("*")
    .eq("visitor_id", sessionId)
    .maybeSingle();
  if (existing) return { conv: existing as Conv, created: false };

  const sourceSite = deriveSourceSite(pageUrl);
  const { data: inserted } = await svc
    .from("meddy_conversations")
    .insert({
      visitor_id: sessionId,
      page_url: pageUrl ?? null,
      source_site: sourceSite,
    })
    .select()
    .maybeSingle();

  let conv = inserted as Conv | null;
  if (!conv) {
    // Lost a race on the unique index — fetch the winner.
    const { data: again } = await svc
      .from("meddy_conversations")
      .select("*")
      .eq("visitor_id", sessionId)
      .single();
    conv = again as Conv;
    return { conv, created: false };
  }

  // New-conversation effects.
  await notifyUsers(
    svc,
    "all",
    "meddy_new_chat",
    "New Meddy chat started",
    sourceSite === "app" ? "A visitor on app.medcurity.com started a chat" : "A visitor started a chat",
    conv.id,
  );
  await broadcast("meddy:dashboard", "new_conversation", {
    conversationId: conv.id,
    sessionId,
    sourceSite,
  });
  if (sourceSite === "app") {
    // App-site chats push to phones (triggerNewAppChatPushover, 869-882).
    await pushoverAllKeyedUsers(
      svc,
      "New App Chat",
      "A visitor started a chat on app.medcurity.com",
      { priority: 0 },
    );
  }
  return { conv, created: true };
}

/** trackVisitorUrl (server.js:1349-1360): no consecutive dupes. */
async function trackUrl(conv: Conv, pageUrl?: string | null) {
  if (!pageUrl) return;
  const { data: last } = await svc
    .from("meddy_url_history")
    .select("page_url")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(1);
  if (last?.[0]?.page_url === pageUrl) return;
  await svc.from("meddy_url_history").insert({
    conversation_id: conv.id,
    page_url: pageUrl,
  });
  await svc
    .from("meddy_conversations")
    .update({ page_url: pageUrl, source_site: deriveSourceSite(pageUrl) })
    .eq("id", conv.id);
  await broadcast("meddy:dashboard", "visitor_url", {
    conversationId: conv.id,
    pageUrl,
  });
}

async function insertMessage(row: Record<string, unknown>) {
  const { data } = await svc.from("meddy_messages").insert(row).select().single();
  return data;
}

/** All effects of a human request — shared by phrase detection and the
 * explicit button (union of server.js:1524-1548 / 1630-1666 / 2050-2089;
 * the Nexus /api/request-human path skipped Pushover by accident — we
 * consciously include it everywhere, per the build plan). */
async function applyHumanRequest(
  conv: Conv,
  opts: { viaButton: boolean },
): Promise<void> {
  const open = isBusinessHours();
  await svc
    .from("meddy_conversations")
    .update({
      is_human_requested: true,
      human_requested_at: new Date().toISOString(),
    })
    .eq("id", conv.id);

  // Visitor-facing system message (variant texts per path).
  const visitorMsg = opts.viaButton
    ? (open
      ? "I'll connect you with a Medcurity team member. Someone will be with you shortly!"
      : HUMAN_REQUEST_REPLY_CLOSED)
    : (open ? HUMAN_REQUEST_REPLY_OPEN : HUMAN_REQUEST_REPLY_CLOSED);
  const sysRow = await insertMessage({
    conversation_id: conv.id,
    role: "assistant",
    content: visitorMsg,
    sender_type: "system",
  });
  await broadcast(`meddy:conv:${conv.visitor_id}`, "new-message", {
    role: "assistant",
    content: visitorMsg,
    senderType: "system",
  });

  // Dashboard-only internal alert row.
  await insertMessage({
    conversation_id: conv.id,
    role: "assistant",
    content: HUMAN_REQUEST_ALERT,
    sender_type: "human_request_alert",
    is_internal: true,
  });

  // Notify available agents, or everyone with the no-agents warning.
  const { data: avail } = await svc
    .from("meddy_agent_status")
    .select("user_id")
    .eq("available", true);
  if ((avail ?? []).length > 0) {
    await notifyUsers(
      svc,
      (avail ?? []).map((r: { user_id: string }) => r.user_id),
      "meddy_human_requested",
      "A visitor is requesting a human",
      conv.visitor_name ? `From ${conv.visitor_name}` : "Open Meddy to take over",
      conv.id,
    );
  } else {
    await notifyUsers(
      svc,
      "all",
      "meddy_human_requested",
      "Human requested - no agents available!",
      "No one is marked available in Meddy",
      conv.id,
    );
  }
  await broadcast("meddy:dashboard", "human_requested", {
    conversationId: conv.id,
    sessionId: conv.visitor_id,
  });
  await broadcast("meddy:dashboard", "new-message", {
    conversationId: conv.id,
    internal: true,
  });

  // Phone push with a one-sentence AI summary (priority 1). The 2-minute
  // priority-2 escalation is handled by meddy-sweep (pushover_escalated).
  const summary = await getConversationSummary(svc, conv.id);
  await pushoverAllKeyedUsers(
    svc,
    `Human Requested - ${conv.source_site === "app" ? "App" : "Main Site"}`,
    summary,
    { priority: 1 },
  );
  if (sysRow) {
    await broadcast("meddy:dashboard", "refresh", { conversationId: conv.id });
  }
}

// ── The chat (SSE) pipeline ──────────────────────────────────────────
async function handleChat(req: Request, body: Record<string, unknown>) {
  const sessionId = String(body.sessionId ?? "").slice(0, 80);
  const message = String(body.message ?? "").slice(0, 4000).trim();
  const clientMsgId = body.clientMsgId ? String(body.clientMsgId).slice(0, 80) : null;
  const pageUrl = body.pageUrl ? String(body.pageUrl).slice(0, 600) : null;
  const pageContext = body.pageContext ? String(body.pageContext).slice(0, 300) : null;
  if (!sessionId || !message) return json({ error: "Missing sessionId or message" }, 400);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(ip)) return json({ error: "Rate limited" }, 429);

  const { conv } = await findOrCreateConversation(sessionId, pageUrl);
  await trackUrl(conv, pageUrl);

  // SSE plumbing.
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const send = (obj: Record<string, unknown>) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
  const done = () => {
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    controller.close();
  };

  const work = (async () => {
    try {
      // Duplicate-resend guard (server.js:1756-1780): same cid, or
      // identical visitor text stored within the last 6 minutes.
      if (clientMsgId) {
        const { data: dup } = await svc
          .from("meddy_messages")
          .select("id")
          .eq("conversation_id", conv.id)
          .eq("client_msg_id", clientMsgId)
          .limit(1);
        if (dup && dup.length > 0) return done();
      }
      const sixMinAgo = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const { data: recentSame } = await svc
        .from("meddy_messages")
        .select("id")
        .eq("conversation_id", conv.id)
        .eq("role", "visitor")
        .eq("content", message)
        .gte("created_at", sixMinAgo)
        .limit(1);
      if (recentSame && recentSame.length > 0) return done();

      // Reopen closed conversations on a new visitor message.
      if (conv.status === "closed") {
        await svc
          .from("meddy_conversations")
          .update({ status: "active" })
          .eq("id", conv.id);
        await broadcast("meddy:dashboard", "conversation_reopened", {
          conversationId: conv.id,
        });
      }

      // Store the visitor message.
      await insertMessage({
        conversation_id: conv.id,
        role: "visitor",
        content: message,
        sender_type: "visitor",
        client_msg_id: clientMsgId,
      });
      await svc
        .from("meddy_conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", conv.id);
      await broadcast("meddy:dashboard", "new-message", {
        conversationId: conv.id,
        sessionId,
        role: "visitor",
        content: message.slice(0, 300),
      });
      // Ding for agents who joined this conversation.
      const { data: joined } = await svc
        .from("meddy_conversation_agents")
        .select("user_id")
        .eq("conversation_id", conv.id);
      if (joined && joined.length > 0) {
        await broadcast("meddy:dashboard", "chat_message_ding", {
          conversationId: conv.id,
          agentIds: joined.map((r: { user_id: string }) => r.user_id),
        });
      }

      // Buying-intent detection (once per conversation).
      const lower = message.toLowerCase();
      if (!conv.buying_intent_alerted) {
        const found = BUYING_KEYWORDS.find((k) => lower.includes(k));
        if (found) {
          await svc
            .from("meddy_conversations")
            .update({ buying_intent_alerted: true })
            .eq("id", conv.id);
          conv.buying_intent_alerted = true;
          await notifyUsers(
            svc,
            "all",
            "meddy_buying_intent",
            "Buying intent detected",
            `Keyword: ${found}`,
            conv.id,
          );
          await broadcast("meddy:dashboard", "buying_intent", {
            conversationId: conv.id,
            keyword: found,
          });
        }
      }

      // Human-request phrase detection (first time, pre-takeover only).
      if (!conv.is_human_requested && !conv.assigned_to) {
        const hit = HUMAN_REQUEST_PHRASES.find((p) => lower.includes(p));
        if (hit) {
          await applyHumanRequest(conv, { viaButton: false });
          conv.is_human_requested = true;
          // The human-request system reply IS the response to this
          // message (Nexus inserts it and ends the AI turn).
          return done();
        }
      }

      // Takeover suppression: agents own the conversation now.
      if (conv.assigned_to) {
        send({ type: "state", taken_over: true });
        return done();
      }

      // Hard AI cap (25 replies/conversation).
      if (conv.ai_message_count >= 25) {
        send({ type: "limit_reached", text: LIMIT_REPLY });
        return done();
      }

      // Pricing follow-up lead capture (server.js:1555-1565).
      if (
        conv.pricing_discussed &&
        message.length < 20 &&
        PRICING_AFFIRMATIVES.some((a) => lower.includes(a))
      ) {
        send({ type: "text", text: LEAD_FORM_REPLY });
        send({ type: "show_lead_form" });
        await insertMessage({
          conversation_id: conv.id,
          role: "assistant",
          content: LEAD_FORM_REPLY,
          sender_type: "ai",
        });
        await svc
          .from("meddy_conversations")
          .update({ pricing_discussed: false })
          .eq("id", conv.id);
        return done();
      }

      if (!Deno.env.get("ANTHROPIC_API_KEY")) {
        console.error("[meddy-chat] ANTHROPIC_API_KEY missing - serving NO_KEY_REPLY");
        send({ type: "text", text: NO_KEY_REPLY });
        return done();
      }

      // Per-conversation AI lock.
      if (aiLocks.has(conv.id)) return done();
      aiLocks.add(conv.id);
      try {
        // Context note (verbatim construction, server.js:1891-1901).
        let contextNote = "";
        if (pageContext) {
          contextNote += "\n\nThe visitor is currently on this page: " + pageContext;
        }
        const open = isBusinessHours();
        contextNote +=
          "\n\nBusiness hours status: Medcurity's team is " +
          (open ? "currently available" : "currently outside business hours") +
          ". Business hours are Monday through Friday, 8 AM to 5 PM Pacific Time." +
          (open
            ? ""
            : " If the visitor asks to speak with someone, let them know the team is not available right now and offer to capture their name and email so someone can follow up when the office opens.");
        if (conv.is_human_requested && !conv.assigned_to) {
          contextNote +=
            "\n\nIMPORTANT: The visitor has requested to speak with a human agent. A team member has been notified and will join shortly. Continue helping the visitor naturally while they wait. You can say something like \"Our team has been notified and someone will be with you soon. In the meantime, I'm happy to help with any questions.\" but do NOT repeat this acknowledgment every message - only mention it once in your first response after the request. After that, just help normally. Do NOT proactively mention forms or contact info unless specifically asked.";
        }
        if (conv.ai_message_count >= 20) {
          contextNote +=
            "\n\nIMPORTANT: Naturally work into your response that the visitor can reach the Medcurity team directly at medcurity.com/contact or (509) 867-3645 if they'd like to keep the conversation going or get into specifics. Keep it brief and conversational.";
        }

        // KB injection exactly as Nexus's reloadSystemPrompt did.
        const { data: kb } = await svc
          .from("meddy_kb_content")
          .select("content")
          .eq("id", 1)
          .single();
        const systemPrompt =
          MEDDY_SYSTEM_PROMPT +
          MEDDY_PROMPT_ADDENDUM +
          "\n\nCURRENT WEBSITE CONTENT (auto-updated daily):\n" +
          (kb?.content ?? "") +
          contextNote;

        // History: non-internal visitor/assistant, last 20, 500 chars,
        // consecutive-merge, leading-non-user strip (server.js:1904-1917).
        const { data: histRows } = await svc
          .from("meddy_messages")
          .select("role, content")
          .eq("conversation_id", conv.id)
          .eq("is_internal", false)
          .in("role", ["visitor", "assistant"])
          .order("created_at", { ascending: true });
        let mapped = (histRows ?? [])
          .slice(-20)
          .map((m: { role: string; content: string }) => ({
            role: m.role === "visitor" ? ("user" as const) : ("assistant" as const),
            content: m.content.substring(0, 500),
          }))
          .filter((m) => m.content.trim().length > 0);
        const merged: typeof mapped = [];
        for (const m of mapped) {
          const prev = merged[merged.length - 1];
          if (prev && prev.role === m.role) prev.content += "\n" + m.content;
          else merged.push({ ...m });
        }
        while (merged.length && merged[0].role !== "user") merged.shift();
        if (merged.length === 0) merged.push({ role: "user", content: message.substring(0, 500) });

        await broadcast(`meddy:conv:${sessionId}`, "ai-typing", {});

        // Streaming Anthropic call (server.js:1947-1959 params).
        const ac = new AbortController();
        const timeout = setTimeout(() => ac.abort(), 30_000);
        let full = "";
        try {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            signal: ac.signal,
            headers: {
              "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: MEDDY_MODEL,
              max_tokens: 400,
              temperature: 0.3,
              stream: true,
              system: [
                {
                  type: "text",
                  text: systemPrompt,
                  cache_control: { type: "ephemeral" },
                },
              ],
              messages: merged,
            }),
          });
          if (!res.ok || !res.body) throw new Error(`anthropic ${res.status}`);
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done: rdone } = await reader.read();
            if (rdone) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") continue;
              try {
                const evt = JSON.parse(payload);
                const text = evt?.delta?.text;
                if (typeof text === "string" && text) {
                  const cleaned = text.replace(/—/g, " - ");
                  full += cleaned;
                  send({ type: "text", text: cleaned });
                }
              } catch {
                /* keep-alive / non-JSON lines */
              }
            }
          }
        } catch (err) {
          const msg = (err as Error).name === "AbortError" ? TIMEOUT_REPLY : ERROR_REPLY;
          send({ type: "error", text: msg });
          await insertMessage({
            conversation_id: conv.id,
            role: "assistant",
            content: "Message delivery failed - AI was unable to respond.",
            sender_type: "error",
            is_internal: true,
          });
          await broadcast(`meddy:conv:${sessionId}`, "ai-typing-stop", {});
          return done();
        } finally {
          clearTimeout(timeout);
        }

        await broadcast(`meddy:conv:${sessionId}`, "ai-typing-stop", {});
        const finalText = postProcessAiResponse(full);

        // Mid-stream takeover race: discard the AI reply (server.js:1995).
        const { data: recheck } = await svc
          .from("meddy_conversations")
          .select("assigned_to, ai_message_count, pricing_discussed")
          .eq("id", conv.id)
          .single();
        if (recheck?.assigned_to) return done();

        await insertMessage({
          conversation_id: conv.id,
          role: "assistant",
          content: finalText,
          sender_type: "ai",
          sender_name: "Meddy",
        });
        const updates: Record<string, unknown> = {
          ai_message_count: (recheck?.ai_message_count ?? conv.ai_message_count) + 1,
        };
        const replyLower = finalText.toLowerCase();
        if (PRICING_TRIGGER_WORDS.some((w) => replyLower.includes(w.toLowerCase()))) {
          updates.pricing_discussed = true;
        }
        await svc.from("meddy_conversations").update(updates).eq("id", conv.id);
        await broadcast("meddy:dashboard", "new-message", {
          conversationId: conv.id,
          sessionId,
          role: "assistant",
          senderName: "Meddy",
          content: finalText.slice(0, 300),
        });
        return done();
      } finally {
        aiLocks.delete(conv.id);
      }
    } catch (err) {
      console.error("meddy-chat pipeline error:", err);
      try {
        send({ type: "error", text: ERROR_REPLY });
        done();
      } catch {
        /* stream already closed */
      }
    }
  })();

  // Keep the worker alive past response return.
  // @ts-ignore EdgeRuntime global exists in Supabase edge runtime
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

// ── Contact form → conversation PII + real CRM contact ───────────────
async function handleContact(body: Record<string, unknown>) {
  const sessionId = String(body.sessionId ?? "").slice(0, 80);
  const name = String(body.name ?? "").slice(0, 120).trim();
  const email = String(body.email ?? "").slice(0, 200).trim().toLowerCase();
  const organization = String(body.organization ?? body.company ?? "").slice(0, 200).trim();
  const phone = String(body.phone ?? "").slice(0, 50).trim();
  if (!sessionId || !name || !email) {
    return json({ error: "Missing sessionId, name, or email" }, 400);
  }

  const { conv } = await findOrCreateConversation(sessionId, null);
  await svc
    .from("meddy_conversations")
    .update({
      visitor_name: name,
      visitor_email: email,
      visitor_phone: phone || null,
      visitor_company: organization || null,
    })
    .eq("id", conv.id);

  // CRM mapping: existing contact by email → link + note; otherwise
  // create under the "Meddy Website Inquiries" holding account.
  let contactId: string | null = null;
  let accountId: string | null = null;
  let isNewContact = false;
  const { data: existing } = await svc
    .from("contacts")
    .select("id, account_id, first_name, last_name")
    .ilike("email", email)
    .is("archived_at", null)
    .limit(1);
  if (existing && existing.length > 0) {
    contactId = existing[0].id;
    accountId = existing[0].account_id;
  } else {
    const { data: holding } = await svc
      .from("accounts")
      .select("id")
      .eq("name", "Meddy Website Inquiries")
      .limit(1);
    if (holding && holding.length > 0) {
      const parts = name.split(/\s+/);
      const firstName = parts[0] ?? name;
      const lastName = parts.slice(1).join(" ") || "(from Meddy chat)";
      const { data: created } = await svc
        .from("contacts")
        .insert({
          account_id: holding[0].id,
          first_name: firstName,
          last_name: lastName,
          email,
          phone: phone || null,
        })
        .select("id, account_id")
        .maybeSingle();
      if (created) {
        contactId = created.id;
        accountId = created.account_id;
        isNewContact = true;
      }
    }
  }
  if (contactId) {
    await svc
      .from("meddy_conversations")
      .update({ crm_contact_id: contactId })
      .eq("id", conv.id);
    // "Had a Meddy chat" note on the contact's timeline.
    await svc.from("activities").insert({
      activity_type: "note",
      subject: "Meddy chat - contact form submitted",
      body:
        `Submitted via the Meddy website chat.\n` +
        `Name: ${name}\nEmail: ${email}` +
        (organization ? `\nOrganization: ${organization}` : "") +
        (phone ? `\nPhone: ${phone}` : "") +
        (conv.page_url ? `\nPage: ${conv.page_url}` : ""),
      contact_id: contactId,
      account_id: accountId,
      activity_date: new Date().toISOString(),
    });
  }

  // Notify admins (meddy_contact_received is admin-scoped per plan).
  const { data: admins } = await svc
    .from("user_profiles")
    .select("id")
    .in("role", ["admin", "super_admin"])
    .eq("is_active", true);
  await notifyUsers(
    svc,
    (admins ?? []).map((r: { id: string }) => r.id),
    "meddy_contact_received",
    "New contact from Meddy chat",
    `${name} (${email})${organization ? " - " + organization : ""}`,
    conv.id,
  );
  await broadcast("meddy:dashboard", "contact_submitted", {
    conversationId: conv.id,
    name,
    email,
  });

  // Form-alert email (HOT LEAD aware), via the Outlook sender pattern.
  await sendFormAlertEmail(conv.id, { name, email, organization, phone });

  return json({ success: true, linkedContact: !!contactId, isNewContact });
}

/** Ports sendFormAlertEmail (server.js:953-1034) onto the Outlook
 * sender. Recipients = users who toggled "form alert emails" ON in My
 * Settings → Notifications (per-user opt-in, no secrets — Nathan
 * 2026-06-12). Silently skipped when nobody opted in. */
async function sendFormAlertEmail(
  conversationId: string,
  c: { name: string; email: string; organization: string; phone: string },
) {
  try {
    const recipients = await emailsForPref(svc, "email_meddy_form_alert");
    if (recipients.length === 0) return;

    const { data: conv } = await svc
      .from("meddy_conversations")
      .select("form_alert_sent, page_url")
      .eq("id", conversationId)
      .single();
    if (!conv || conv.form_alert_sent) return;
    await svc
      .from("meddy_conversations")
      .update({ form_alert_sent: true })
      .eq("id", conversationId);

    const { data: msgs } = await svc
      .from("meddy_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .eq("is_internal", false)
      .order("created_at", { ascending: false })
      .limit(8);
    const ordered = (msgs ?? []).reverse();
    const transcript = ordered
      .map((m: { role: string; content: string }) => {
        const label = m.role === "visitor" ? "Visitor" : m.role === "human" ? "Agent" : "Meddy";
        return `${label}: ${m.content.substring(0, 300)}`;
      })
      .join("\n");
    const allText = ordered.map((m: { content: string }) => m.content).join(" ").toLowerCase();
    const hot = BUYING_KEYWORDS.some((k) => allText.includes(k));

    const summary = await aiComplete({
      system:
        "Summarize this chatbot conversation in 2-3 sentences. Focus on what the visitor asked about and what they seemed interested in. Be concise and specific.",
      messages: [{ role: "user", content: `Conversation:\n${transcript}` }],
      maxTokens: 200,
      temperature: 0.2,
      timeoutMs: 10_000,
    });

    const appBase = (Deno.env.get("APP_BASE_URL") ?? "https://crm.medcurity.com").replace(/\/+$/, "");
    const headerColor = hot ? "#C8102E" : "#1B3A5C";
    const subject = hot
      ? `HOT LEAD from Meddy - ${c.name}`
      : `New Contact from Meddy - ${c.name}`;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const html = [
      `<div style="margin:0 auto;max-width:560px;font-family:Arial,Helvetica,sans-serif">`,
      `<div style="background:${headerColor};border-radius:10px 10px 0 0;padding:13px 24px">`,
      `<span style="font-size:17px;font-weight:bold;color:#ffffff">${hot ? "HOT LEAD from Meddy" : "New Contact from Meddy"}</span>`,
      `</div>`,
      `<div style="border:1px solid #e2e6ec;border-top:0;border-radius:0 0 10px 10px;padding:22px 24px;background:#ffffff">`,
      `<table style="border-collapse:collapse;font-size:14px">`,
      `<tr><td style="padding:3px 14px 3px 0;color:#777">Name</td><td>${esc(c.name)}</td></tr>`,
      `<tr><td style="padding:3px 14px 3px 0;color:#777">Email</td><td>${esc(c.email)}</td></tr>`,
      c.organization ? `<tr><td style="padding:3px 14px 3px 0;color:#777">Organization</td><td>${esc(c.organization)}</td></tr>` : "",
      c.phone ? `<tr><td style="padding:3px 14px 3px 0;color:#777">Phone</td><td>${esc(c.phone)}</td></tr>` : "",
      conv.page_url ? `<tr><td style="padding:3px 14px 3px 0;color:#777">Page</td><td>${esc(conv.page_url)}</td></tr>` : "",
      `</table>`,
      summary ? `<p style="font-size:14px;color:#444;margin:14px 0 0"><em>${esc(summary)}</em></p>` : "",
      `<a href="${appBase}/meddy" style="display:inline-block;margin-top:16px;background:#1d4ed8;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold">Open in Pulse</a>`,
      `</div></div>`,
    ].join("");

    await sendOutlookEmail(svc, recipients, subject, html);
  } catch (e) {
    console.warn("form alert email failed:", (e as Error).message);
  }
}

// ── Entry ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "");

  try {
    switch (action) {
      case "chat":
        return await handleChat(req, body);
      case "contact":
        return await handleContact(body);
      case "request-human": {
        const sessionId = String(body.sessionId ?? "").slice(0, 80);
        if (!sessionId) return json({ error: "Missing sessionId" }, 400);
        const { conv } = await findOrCreateConversation(
          sessionId,
          body.pageUrl ? String(body.pageUrl) : null,
        );
        if (!conv.is_human_requested) {
          await applyHumanRequest(conv, { viaButton: true });
        }
        const { data: avail } = await svc
          .from("meddy_agent_status")
          .select("user_id")
          .eq("available", true);
        return json({ success: true, available: (avail ?? []).length > 0 });
      }
      case "end": {
        const sessionId = String(body.sessionId ?? "").slice(0, 80);
        if (!sessionId) return json({ error: "Missing sessionId" }, 400);
        const { data: conv } = await svc
          .from("meddy_conversations")
          .select("id, visitor_id")
          .eq("visitor_id", sessionId)
          .maybeSingle();
        if (conv) {
          await insertMessage({
            conversation_id: conv.id,
            role: "assistant",
            content: VISITOR_ENDED_MESSAGE,
            sender_type: "system",
            is_internal: true,
          });
          await svc
            .from("meddy_conversations")
            .update({ status: "closed" })
            .eq("id", conv.id);
          await broadcast("meddy:dashboard", "conversation_closed", {
            conversationId: conv.id,
          });
        }
        return json({ success: true });
      }
      case "status": {
        const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data } = await svc
          .from("meddy_agent_status")
          .select("user_id")
          .eq("available", true)
          .gte("last_seen", cutoff);
        const n = (data ?? []).length;
        return json({ anyAvailable: n > 0, availableCount: n });
      }
      case "hours":
        return json({ open: isBusinessHours() });
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("meddy-chat error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
