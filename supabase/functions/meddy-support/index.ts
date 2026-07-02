// ---------------------------------------------------------------------
// MEDDY SUPPORT — the API the app.medcurity.com AI Coach ("Meddy") calls.
//
// Deploy: supabase functions deploy meddy-support --no-verify-jwt
//         (the caller is Joe's platform backend, not a Supabase user; it
//          authenticates with the X-Support-Key shared secret instead)
// Secrets: MEDDY_SUPPORT_API_KEY   (required — requests 401 without it)
//          PUSHOVER_APP_TOKEN      (optional — phone pushes on escalation)
//          APP_BASE_URL            (optional — deep links in pushes)
//
// COMPLETELY WALLED OFF from the website Meddy: touches only the
// support_* tables (20260701000001_meddy_support_foundation.sql), imports
// nothing from the meddy functions, shares no conversation data.
//
// Control model (docs/meddy/ai-human-handoff-design.md): `assigned_to`
// is the gate. The Coach polls `status`; while `isHumanTakeover` is true
// it suppresses its own AI and renders agent messages; when it flips
// back false (hand-back) the Coach resumes in the same conversation.
//
// Actions (POST JSON, always { action, sessionId, ... }):
//   upsert-conversation  register/locate a chat + attach identity
//   post-messages        sync transcript lines (idempotent by clientMsgId)
//   request-human        flag for takeover + notify the team
//   status               poll: who's driving + agent/system msgs since cursor
//   close                platform side ended the chat
//
// Security notes (deliberate upgrades over older inbound endpoints):
//   * constant-time key comparison (no timing side-channel)
//   * NO allow-through fallbacks: missing secret/key/mismatch => 401/503
//   * light per-IP rate limit as a backstop
// ---------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPPORT_API_KEY = Deno.env.get("MEDDY_SUPPORT_API_KEY") ?? "";
const PUSHOVER_APP_TOKEN = Deno.env.get("PUSHOVER_APP_TOKEN") ?? "";
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://crm.medcurity.com";

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-support-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Constant-time string equality — both inputs hashed to fixed length
// first so length differences leak nothing either.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// Light per-IP rate limit (in-memory, best effort — the key is the real
// gate; this is a backstop against a leaked key being hammered).
const rateBucket = new Map<string, { n: number; reset: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const cur = rateBucket.get(ip);
  if (!cur || now > cur.reset) {
    rateBucket.set(ip, { n: 1, reset: now + 15 * 60_000 });
    return false;
  }
  cur.n += 1;
  return cur.n > 900; // polling every few seconds stays well under this
}

type ConvRow = {
  id: string;
  platform_session_id: string;
  status: string;
  assigned_to: string | null;
  is_human_takeover: boolean;
  is_human_requested: boolean;
  customer_name: string | null;
  customer_email: string | null;
  customer_company: string | null;
};

async function findOrCreate(sessionId: string): Promise<ConvRow> {
  const { data: existing } = await svc
    .from("support_conversations")
    .select("id, platform_session_id, status, assigned_to, is_human_takeover, is_human_requested, customer_name, customer_email, customer_company")
    .eq("platform_session_id", sessionId)
    .maybeSingle();
  if (existing) return existing as ConvRow;

  const { data: created, error } = await svc
    .from("support_conversations")
    .insert({ platform_session_id: sessionId })
    .select("id, platform_session_id, status, assigned_to, is_human_takeover, is_human_requested, customer_name, customer_email, customer_company")
    .single();
  if (!error && created) return created as ConvRow;

  // Unique-index race: another call created it first — fetch the winner.
  const { data: winner, error: refetchErr } = await svc
    .from("support_conversations")
    .select("id, platform_session_id, status, assigned_to, is_human_takeover, is_human_requested, customer_name, customer_email, customer_company")
    .eq("platform_session_id", sessionId)
    .single();
  if (refetchErr || !winner) throw new Error("could not create conversation");
  return winner as ConvRow;
}

async function agentName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await svc
    .from("user_profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return (data?.full_name as string | undefined) ?? null;
}

function convState(conv: ConvRow, name: string | null) {
  return {
    conversationId: conv.id,
    status: conv.status,
    isHumanRequested: conv.is_human_requested,
    isHumanTakeover: conv.is_human_takeover,
    // Display name only — internal ids never leave Pulse.
    agentName: conv.is_human_takeover ? name : null,
  };
}

// Notify the team a platform customer wants a human: notification rows
// (rides the existing banner/sound engine) + Pushover phone pushes.
async function notifyHumanRequested(conv: ConvRow) {
  const who = conv.customer_name || conv.customer_email || "A platform customer";
  const company = conv.customer_company ? ` (${conv.customer_company})` : "";
  const title = "Support: human requested";
  const message = `${who}${company} asked for a human in the platform Meddy.`;
  const link = `/support?conversation=${conv.id}`;

  const { data: users } = await svc
    .from("user_profiles")
    .select("id")
    .eq("is_active", true);
  if (users?.length) {
    await svc.from("notifications").insert(
      users.map((u: { id: string }) => ({
        user_id: u.id,
        type: "support_human_requested",
        title,
        message,
        link,
        conversation_id: conv.id,
      })),
    );
  }

  if (PUSHOVER_APP_TOKEN) {
    const { data: prefs } = await svc
      .from("user_notification_prefs")
      .select("user_id, pushover_key")
      .not("pushover_key", "is", null);
    for (const p of prefs ?? []) {
      const key = (p as { pushover_key: string | null }).pushover_key;
      if (!key) continue;
      try {
        await fetch("https://api.pushover.net/1/messages.json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token: PUSHOVER_APP_TOKEN,
            user: key,
            title,
            message,
            url: `${APP_BASE_URL}${link}`,
            url_title: "Open in Pulse",
            priority: 1,
          }),
        });
      } catch (e) {
        console.warn("pushover send failed:", (e as Error).message);
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // --- Auth: dedicated shared secret; no fallbacks, no allow-through ---
  if (!SUPPORT_API_KEY) {
    return json({ error: "support API not configured" }, 503);
  }
  const presented = req.headers.get("x-support-key") ?? "";
  if (!presented || !(await timingSafeEqual(presented, SUPPORT_API_KEY))) {
    return json({ error: "unauthorized" }, 401);
  }

  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  if (rateLimited(ip)) return json({ error: "rate limited" }, 429);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }

  const action = String(body.action ?? "");
  const sessionId = String(body.sessionId ?? "").slice(0, 80).trim();
  if (!sessionId) return json({ error: "sessionId required" }, 400);

  try {
    switch (action) {
      // ── Register / locate + attach identity ─────────────────────────
      case "upsert-conversation": {
        const conv = await findOrCreate(sessionId);
        const user = (body.user ?? {}) as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        if (typeof user.id === "string" && user.id) patch.platform_user_id = String(user.id).slice(0, 120);
        if (typeof user.name === "string" && user.name) patch.customer_name = String(user.name).slice(0, 200);
        if (typeof user.email === "string" && user.email) patch.customer_email = String(user.email).slice(0, 320).toLowerCase();
        if (typeof user.company === "string" && user.company) patch.customer_company = String(user.company).slice(0, 200);
        if (Object.keys(patch).length > 0) {
          await svc.from("support_conversations").update(patch).eq("id", conv.id);
          Object.assign(conv, {
            customer_name: (patch.customer_name as string) ?? conv.customer_name,
            customer_email: (patch.customer_email as string) ?? conv.customer_email,
            customer_company: (patch.customer_company as string) ?? conv.customer_company,
          });
        }
        return json({ ok: true, ...convState(conv, await agentName(conv.assigned_to)) });
      }

      // ── Transcript sync (idempotent) ─────────────────────────────────
      case "post-messages": {
        const conv = await findOrCreate(sessionId);
        const raw = Array.isArray(body.messages) ? body.messages : [];
        if (raw.length === 0) return json({ ok: true, inserted: 0 });
        if (raw.length > 50) return json({ error: "max 50 messages per call" }, 400);

        // A new customer message on a closed conversation reopens it
        // (mirrors the website behavior — people come back).
        if (conv.status === "closed") {
          await svc
            .from("support_conversations")
            .update({ status: "active", closed_at: null })
            .eq("id", conv.id);
        }

        let inserted = 0;
        for (const m of raw) {
          const msg = m as Record<string, unknown>;
          const role = msg.role === "customer" || msg.role === "assistant" ? msg.role : null;
          const content = typeof msg.content === "string" ? msg.content.slice(0, 8000).trim() : "";
          if (!role || !content) continue;
          const clientMsgId = typeof msg.clientMsgId === "string" ? msg.clientMsgId.slice(0, 80) : null;

          if (clientMsgId) {
            const { data: dup } = await svc
              .from("support_messages")
              .select("id")
              .eq("conversation_id", conv.id)
              .eq("client_msg_id", clientMsgId)
              .maybeSingle();
            if (dup) continue; // already synced
          }
          const { error: insErr } = await svc.from("support_messages").insert({
            conversation_id: conv.id,
            role,
            content,
            client_msg_id: clientMsgId,
            sender_name: role === "customer" ? (conv.customer_name ?? "Customer") : "Meddy",
          });
          if (!insErr) inserted += 1;
        }
        if (inserted > 0) {
          await svc
            .from("support_conversations")
            .update({ last_message_at: new Date().toISOString() })
            .eq("id", conv.id);
        }
        return json({ ok: true, inserted });
      }

      // ── Escalation: the customer wants a human ───────────────────────
      case "request-human": {
        const conv = await findOrCreate(sessionId);
        if (conv.is_human_takeover) {
          // Someone is already driving — nothing to escalate.
          return json({ ok: true, ...convState(conv, await agentName(conv.assigned_to)) });
        }
        if (!conv.is_human_requested) {
          await svc
            .from("support_conversations")
            .update({
              is_human_requested: true,
              human_requested_at: new Date().toISOString(),
              status: "active",
              closed_at: null,
            })
            .eq("id", conv.id);
          await svc.from("support_messages").insert({
            conversation_id: conv.id,
            role: "system",
            content: "human_requested",
            is_internal: true,
          });
          conv.is_human_requested = true;
          await notifyHumanRequested(conv);
        }
        return json({ ok: true, ...convState(conv, null) });
      }

      // ── Poll: who's driving + human/system messages since cursor ─────
      case "status": {
        const conv = await findOrCreate(sessionId);
        const sinceId = Number(body.sinceMessageId ?? 0) || 0;
        const { data: msgs } = await svc
          .from("support_messages")
          .select("id, role, content, sender_name, created_at")
          .eq("conversation_id", conv.id)
          .eq("is_internal", false)
          .in("role", ["agent", "system"])
          .gt("id", sinceId)
          .order("id", { ascending: true })
          .limit(100);
        return json({
          ok: true,
          ...convState(conv, await agentName(conv.assigned_to)),
          messages: (msgs ?? []).map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            senderName: m.sender_name,
            at: m.created_at,
          })),
        });
      }

      // ── The platform side ended the chat ─────────────────────────────
      case "close": {
        const conv = await findOrCreate(sessionId);
        await svc
          .from("support_conversations")
          .update({
            status: "closed",
            closed_at: new Date().toISOString(),
            assigned_to: null,
            is_human_takeover: false,
            is_human_requested: false,
          })
          .eq("id", conv.id);
        await svc.from("support_messages").insert({
          conversation_id: conv.id,
          role: "system",
          content: "closed",
          sender_name: "Platform",
        });
        return json({ ok: true, conversationId: conv.id, status: "closed" });
      }

      default:
        return json({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error("meddy-support error:", (e as Error).message);
    return json({ error: "internal error" }, 500);
  }
});
