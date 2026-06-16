// meddy-staff-action Edge Function — authenticated staff operations on
// Meddy conversations. Ports the Nexus dashboard endpoints (server.js
// §5630-5882) with their exact semantics:
//
//   message      {conversationId, content, isInternal?} — membership-gated;
//                whisper = isInternal (dashboard-only); the [FORM] quick
//                reply pushes the contact form to the visitor instead.
//   takeover     {conversationId} — atomic one-way claim (409 on race).
//   join         {conversationId} — only after a takeover exists.
//   close        {conversationId} / reopen {conversationId}
//   availability {available} — manual toggle; Away sets away_manual.
//   heartbeat    {} — bumps last_seen while the Meddy tab is open.
//
// Deploy: supabase functions deploy meddy-staff-action  (JWT verified)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  TAKEOVER_SYSTEM_MESSAGE,
  FORM_ALREADY_CAPTURED,
  FORM_SENT_MESSAGE,
  broadcast,
  sendPushover,
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  // Caller identity + active-staff check.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData } = await userClient.auth.getUser();
  const caller = userData?.user;
  if (!caller) return json({ error: "Not authenticated" }, 401);
  const { data: profile } = await svc
    .from("user_profiles")
    .select("id, full_name, role, is_active")
    .eq("id", caller.id)
    .single();
  if (!profile?.is_active) return json({ error: "Not authorized" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action ?? "");
  const conversationId = body.conversationId ? String(body.conversationId) : null;

  async function loadConv() {
    if (!conversationId) return null;
    const { data } = await svc
      .from("meddy_conversations")
      .select("id, visitor_id, status, assigned_to, visitor_email")
      .eq("id", conversationId)
      .maybeSingle();
    return data;
  }

  try {
    switch (action) {
      // ── Agent / whisper message ──────────────────────────────────
      case "message": {
        const conv = await loadConv();
        if (!conv) return json({ error: "Conversation not found" }, 404);
        const isInternal = !!body.isInternal;
        let content = String(body.content ?? "").slice(0, 1000).trim();
        if (!content) return json({ error: "Empty message" }, 400);

        // Membership gate (server.js:5637-5638).
        const { data: member } = await svc
          .from("meddy_conversation_agents")
          .select("user_id")
          .eq("conversation_id", conv.id)
          .eq("user_id", caller.id)
          .maybeSingle();
        if (!member) {
          return json({ error: "Take over or join the conversation first" }, 403);
        }

        // [FORM] sentinel (server.js:5645-5664).
        if (content === "[FORM]") {
          if (conv.visitor_email) {
            const note = FORM_ALREADY_CAPTURED;
            await svc.from("meddy_messages").insert({
              conversation_id: conv.id,
              role: "assistant",
              content: note,
              sender_type: "system",
              is_internal: true,
            });
            await broadcast("meddy:dashboard", "new-message", {
              conversationId: conv.id,
              internal: true,
            });
            return json({ success: true, formSent: false, note });
          }
          await svc.from("meddy_messages").insert({
            conversation_id: conv.id,
            role: "assistant",
            content: FORM_SENT_MESSAGE,
            sender_type: "system",
            is_internal: true,
          });
          await broadcast(`meddy:conv:${conv.visitor_id}`, "show-form", {
            reason: "agent_requested",
          });
          await broadcast("meddy:dashboard", "new-message", {
            conversationId: conv.id,
            internal: true,
          });
          return json({ success: true, formSent: true });
        }

        await svc.from("meddy_messages").insert({
          conversation_id: conv.id,
          role: "human",
          content,
          sender_name: profile.full_name,
          sender_type: isInternal ? "internal" : "employee",
          is_internal: isInternal,
        });
        await svc
          .from("meddy_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conv.id);

        // Whispers go to the dashboard only; normal agent messages also
        // reach the visitor's widget channel (server.js:5671-5677).
        await broadcast("meddy:dashboard", "new-message", {
          conversationId: conv.id,
          role: "human",
          senderName: profile.full_name,
          internal: isInternal,
        });
        if (!isInternal) {
          await broadcast(`meddy:conv:${conv.visitor_id}`, "new-message", {
            role: "human",
            content,
            senderName: profile.full_name,
          });
        }
        return json({ success: true });
      }

      // ── Takeover: atomic, one-way (server.js:5683-5711) ──────────
      case "takeover": {
        const conv = await loadConv();
        if (!conv) return json({ error: "Conversation not found" }, 404);
        const { data: claimed } = await svc
          .from("meddy_conversations")
          .update({ is_human_takeover: true, assigned_to: caller.id })
          .eq("id", conv.id)
          .is("assigned_to", null)
          .select("id")
          .maybeSingle();
        if (!claimed) {
          return json(
            { error: "This conversation was already taken over by another agent" },
            409,
          );
        }
        await svc.from("meddy_conversation_agents").upsert(
          { conversation_id: conv.id, user_id: caller.id },
          { onConflict: "conversation_id,user_id", ignoreDuplicates: true },
        );
        await svc.from("meddy_messages").insert({
          conversation_id: conv.id,
          role: "assistant",
          content: TAKEOVER_SYSTEM_MESSAGE,
          sender_type: "system",
        });
        await broadcast(`meddy:conv:${conv.visitor_id}`, "new-message", {
          role: "assistant",
          content: TAKEOVER_SYSTEM_MESSAGE,
          senderType: "system",
        });
        await broadcast(`meddy:conv:${conv.visitor_id}`, "taken-over", {
          displayName: profile.full_name,
        });
        await broadcast("meddy:dashboard", "conversation_taken_over", {
          conversationId: conv.id,
          userId: caller.id,
          displayName: profile.full_name,
        });
        return json({ success: true });
      }

      // ── Join (after takeover exists; server.js:5714-5734) ────────
      case "join": {
        const conv = await loadConv();
        if (!conv) return json({ error: "Conversation not found" }, 404);
        if (!conv.assigned_to) {
          return json({ error: "Take over the conversation first" }, 400);
        }
        const { data: already } = await svc
          .from("meddy_conversation_agents")
          .select("user_id")
          .eq("conversation_id", conv.id)
          .eq("user_id", caller.id)
          .maybeSingle();
        if (!already) {
          await svc.from("meddy_conversation_agents").insert({
            conversation_id: conv.id,
            user_id: caller.id,
          });
          const note = `${profile.full_name} joined the conversation.`;
          await svc.from("meddy_messages").insert({
            conversation_id: conv.id,
            role: "assistant",
            content: note,
            sender_type: "system",
            is_internal: true,
          });
          await broadcast("meddy:dashboard", "conversation_agents_updated", {
            conversationId: conv.id,
          });
        }
        return json({ success: true });
      }

      // ── Close / reopen ───────────────────────────────────────────
      case "close": {
        const conv = await loadConv();
        if (!conv) return json({ error: "Conversation not found" }, 404);
        await svc
          .from("meddy_conversations")
          .update({ status: "closed" })
          .eq("id", conv.id);
        await broadcast(`meddy:conv:${conv.visitor_id}`, "conversation-closed", {});
        await broadcast("meddy:dashboard", "conversation_closed", {
          conversationId: conv.id,
        });
        return json({ success: true });
      }
      case "reopen": {
        const conv = await loadConv();
        if (!conv) return json({ error: "Conversation not found" }, 404);
        // Parity: reopen does NOT clear assigned_to (server.js:5757-5764).
        await svc
          .from("meddy_conversations")
          .update({ status: "active" })
          .eq("id", conv.id);
        await broadcast("meddy:dashboard", "conversation_reopened", {
          conversationId: conv.id,
        });
        return json({ success: true });
      }

      // ── Hide lead (admin; ports server.js:5817-5825) ─────────────
      // Never deletes — only drops the row out of the leads filter.
      case "hide_lead": {
        if (profile.role !== "admin" && profile.role !== "super_admin") {
          return json({ error: "Admins only" }, 403);
        }
        const conv = await loadConv();
        if (!conv) return json({ error: "Conversation not found" }, 404);
        await svc
          .from("meddy_conversations")
          .update({ hidden_from_leads: true })
          .eq("id", conv.id);
        return json({ success: true });
      }

      // ── Availability toggle + heartbeat ──────────────────────────
      case "availability": {
        const available = !!body.available;
        await svc.from("meddy_agent_status").upsert({
          user_id: caller.id,
          available,
          // Manual Away sticks until the user flips back (the Nexus
          // away_manual design that finally made availability behave).
          away_manual: !available,
          last_seen: new Date().toISOString(),
        });
        if (!available) {
          const { data: stillAvail } = await svc
            .from("meddy_agent_status")
            .select("user_id")
            .eq("available", true);
          if ((stillAvail ?? []).length === 0) {
            await notifyWaitingVisitors();
          }
        }
        await broadcast("meddy:dashboard", "team_status_changed", {
          userId: caller.id,
          available,
        });
        return json({ success: true, available });
      }
      // ── Pushover self-test (ports POST /api/pushover/test) ───────
      // Admins may pass userId to test someone else's key.
      case "pushover_test": {
        const targetId =
          body.userId &&
          (profile.role === "admin" || profile.role === "super_admin")
            ? String(body.userId)
            : caller.id;
        const { data: row } = await svc
          .from("user_notification_prefs")
          .select("pushover_key")
          .eq("user_id", targetId)
          .maybeSingle();
        if (!row?.pushover_key) {
          return json({ error: "No Pushover key on file" }, 400);
        }
        if (!(Deno.env.get("PUSHOVER_APP_TOKEN") ?? "").trim()) {
          return json({ error: "Pushover app token not configured" }, 400);
        }
        const sent = await sendPushover(
          row.pushover_key,
          "Pulse Test",
          "Phone notifications are working!",
        );
        if (!sent) {
          return json({ error: "Pushover rejected the push - check the key" }, 400);
        }
        return json({ success: true });
      }

      case "heartbeat": {
        // Bumps last_seen; flips Available back on unless manually Away
        // (ports the WS-connect behavior, server.js:6595-6596).
        // Two individually-atomic statements instead of read-then-upsert:
        // the old version could interleave with a concurrent Away toggle
        // and leave available=true + away_manual=true (a stuck Available
        // that every later beat skipped). The UPDATE re-checks
        // away_manual in its own WHERE, so any interleaving converges.
        await svc.from("meddy_agent_status").upsert({
          user_id: caller.id,
          last_seen: new Date().toISOString(),
        });
        await svc
          .from("meddy_agent_status")
          .update({ available: true })
          .eq("user_id", caller.id)
          .eq("away_manual", false);
        return json({ success: true });
      }

      // ── Fast disconnect: a teammate's last tab dropped off presence ──
      // The caller saw `user_id` leave the live presence channel (closed
      // tab / sleep / lost network). Mark them away within seconds instead
      // of waiting for the 2-min sweep. Only flips a row that is currently
      // Available AND hasn't checked in within ~20s, so a fresh reconnect
      // (their new tab just heartbeated) is never clobbered. Never touches
      // away_manual. Idempotent — redundant calls from other peers no-op.
      case "peer_offline": {
        const targetId = typeof body.user_id === "string" ? body.user_id : "";
        if (!targetId) return json({ error: "user_id required" }, 400);
        const cutoff = new Date(Date.now() - 20_000).toISOString();
        const { data: flipped } = await svc
          .from("meddy_agent_status")
          .update({ available: false, updated_at: new Date().toISOString() })
          .eq("user_id", targetId)
          .eq("available", true)
          .lt("last_seen", cutoff)
          .select("user_id");
        if ((flipped ?? []).length > 0) {
          await broadcast("meddy:dashboard", "team_status_changed", {
            userId: targetId,
            available: false,
          });
        }
        return json({ success: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("meddy-staff-action error:", err);
    return json({ error: "Internal error" }, 500);
  }
});

/** notifyWaitingVisitors (server.js:5885-5895): tell visitors who asked
 * for a human (unassigned, open, active in last 30 min) that no agents
 * are available. */
async function notifyWaitingVisitors() {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: waiting } = await svc
    .from("meddy_conversations")
    .select("visitor_id")
    .eq("is_human_requested", true)
    .is("assigned_to", null)
    .neq("status", "closed")
    .gte("updated_at", cutoff);
  for (const w of waiting ?? []) {
    await broadcast(`meddy:conv:${w.visitor_id}`, "agents-unavailable", {});
  }
}
