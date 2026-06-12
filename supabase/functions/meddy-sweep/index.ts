// meddy-sweep Edge Function — scheduled safety net (GitHub Actions cron,
// every ~2 min). Replaces OG Nexus's IN-MEMORY timers, which silently
// died on every server restart (a known Nexus weakness — this is the
// durable version):
//
//   1. Missed chats (server.js:772-791): human requested >= 5 min ago,
//      still unassigned, not closed → meddy_missed_chat notification to
//      everyone + alert email. Idempotent via missed_chat_alerted /
//      missed_chat_emailed columns.
//   2. Pushover escalation (server.js:854-865): human requested >= 2 min
//      ago, still unassigned → priority-2 emergency push. Idempotent via
//      pushover_escalated.
//   3. Stale agents: available but no heartbeat for 2+ min → marked
//      unavailable; if nobody is left, waiting visitors get the
//      agents-unavailable notice (ports the WS presence close handler).
//
// Deploy: supabase functions deploy meddy-sweep   (anon JWT from cron)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isBusinessHours,
  broadcast,
  notifyUsers,
  pushoverAllKeyedUsers,
} from "../_shared/meddy-core.ts";
import { ensureValidOutlookToken } from "../_shared/graph-token.ts";

const svc = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async () => {
  const out = { missed: 0, escalated: 0, agentsMarkedAway: 0 };
  const now = Date.now();
  const fiveMinAgo = new Date(now - 5 * 60 * 1000).toISOString();
  const twoMinAgo = new Date(now - 2 * 60 * 1000).toISOString();

  // ── 1. Missed chats ──────────────────────────────────────────────
  const { data: missed } = await svc
    .from("meddy_conversations")
    .select("id, visitor_id, visitor_name, visitor_email, visitor_phone, visitor_company, page_url, missed_chat_emailed")
    .eq("is_human_requested", true)
    .is("assigned_to", null)
    .neq("status", "closed")
    .lte("human_requested_at", fiveMinAgo)
    .eq("missed_chat_alerted", false);
  for (const conv of missed ?? []) {
    await svc
      .from("meddy_conversations")
      .update({ missed_chat_alerted: true })
      .eq("id", conv.id);
    await notifyUsers(
      svc,
      "all",
      "meddy_missed_chat",
      "Missed chat - visitor waiting 5+ minutes",
      conv.visitor_name ? `${conv.visitor_name} is still waiting` : "A visitor is still waiting",
      conv.id,
    );
    await broadcast("meddy:dashboard", "missed_chat", { conversationId: conv.id });
    if (!conv.missed_chat_emailed) {
      await sendMissedChatEmail(conv);
    }
    out.missed++;
  }

  // ── 2. Pushover escalation (priority 2) ──────────────────────────
  const { data: waiting } = await svc
    .from("meddy_conversations")
    .select("id")
    .eq("is_human_requested", true)
    .is("assigned_to", null)
    .neq("status", "closed")
    .lte("human_requested_at", twoMinAgo)
    .eq("pushover_escalated", false);
  for (const conv of waiting ?? []) {
    await svc
      .from("meddy_conversations")
      .update({ pushover_escalated: true })
      .eq("id", conv.id);
    await pushoverAllKeyedUsers(
      svc,
      "URGENT: Visitor Still Waiting",
      "No agent has taken over. Visitor has been waiting 2 minutes.",
      { priority: 2 },
    );
    out.escalated++;
  }

  // ── 3. Stale agents ──────────────────────────────────────────────
  const { data: stale } = await svc
    .from("meddy_agent_status")
    .select("user_id")
    .eq("available", true)
    .lt("last_seen", twoMinAgo);
  if (stale && stale.length > 0) {
    await svc
      .from("meddy_agent_status")
      .update({ available: false })
      .eq("available", true)
      .lt("last_seen", twoMinAgo);
    out.agentsMarkedAway = stale.length;
    const { data: remaining } = await svc
      .from("meddy_agent_status")
      .select("user_id")
      .eq("available", true);
    if ((remaining ?? []).length === 0) {
      const cutoff = new Date(now - 30 * 60 * 1000).toISOString();
      const { data: stillWaiting } = await svc
        .from("meddy_conversations")
        .select("visitor_id")
        .eq("is_human_requested", true)
        .is("assigned_to", null)
        .neq("status", "closed")
        .gte("updated_at", cutoff);
      for (const w of stillWaiting ?? []) {
        await broadcast(`meddy:conv:${w.visitor_id}`, "agents-unavailable", {});
      }
    }
    await broadcast("meddy:dashboard", "team_status_changed", {});
  }

  return new Response(JSON.stringify({ ok: true, ...out }), {
    headers: { "Content-Type": "application/json" },
  });
});

/** Missed-chat email (ports server.js:1038-1108) via the Outlook sender.
 * Recipients: MEDDY_ALERT_EMAILS (comma-separated); silent skip if unset. */
// deno-lint-ignore no-explicit-any
async function sendMissedChatEmail(conv: any) {
  try {
    const recipients = (Deno.env.get("MEDDY_ALERT_EMAILS") ?? "")
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) return;

    // Re-check + dedup exactly like Nexus (1043-1047).
    const { data: fresh } = await svc
      .from("meddy_conversations")
      .select("assigned_to, status, missed_chat_emailed")
      .eq("id", conv.id)
      .single();
    if (!fresh || fresh.missed_chat_emailed || fresh.assigned_to || fresh.status === "closed") {
      return;
    }
    await svc
      .from("meddy_conversations")
      .update({ missed_chat_emailed: true })
      .eq("id", conv.id);

    const { data: msgs } = await svc
      .from("meddy_messages")
      .select("role, content")
      .eq("conversation_id", conv.id)
      .eq("is_internal", false)
      .order("created_at", { ascending: false })
      .limit(4);
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const transcript = (msgs ?? [])
      .reverse()
      .map((m: { role: string; content: string }) => {
        const label = m.role === "visitor" ? "Visitor" : m.role === "human" ? "Agent" : "Meddy";
        return `<p style="margin:4px 0;font-size:13px"><strong>${label}:</strong> ${esc(m.content.substring(0, 300))}</p>`;
      })
      .join("");

    const senderEmail = (Deno.env.get("REQUEST_NOTIFY_SENDER_EMAIL") ?? "nathang@medcurity.com").trim();
    const fromAddress = (Deno.env.get("REQUEST_NOTIFY_FROM") ?? "marketing@medcurity.com").trim();
    const { data: connRow } = await svc
      .from("email_sync_connections")
      .select("id, access_token, refresh_token, token_expires_at")
      .ilike("email_address", senderEmail)
      .eq("provider", "outlook")
      .eq("is_active", true)
      .maybeSingle();
    if (!connRow) return;
    const token = await ensureValidOutlookToken(svc, connRow);
    const appBase = (Deno.env.get("APP_BASE_URL") ?? "https://crm.medcurity.com").replace(/\/+$/, "");

    const afterHours = !isBusinessHours()
      ? `<p style="font-size:13px;color:#92400e;background:#fef3c7;padding:8px 12px;border-radius:6px">This request came in outside business hours (Mon-Fri, 8 AM - 5 PM Pacific).</p>`
      : "";
    const contactBlock = conv.visitor_email
      ? `<p style="font-size:13px;color:#444">Contact: ${esc(conv.visitor_name ?? "")} · ${esc(conv.visitor_email ?? "")}${conv.visitor_phone ? " · " + esc(conv.visitor_phone) : ""}</p>`
      : "";

    const html = [
      `<div style="margin:0 auto;max-width:560px;font-family:Arial,Helvetica,sans-serif">`,
      `<div style="background:#C8102E;border-radius:10px 10px 0 0;padding:13px 24px">`,
      `<span style="font-size:17px;font-weight:bold;color:#ffffff">Missed Chat</span>`,
      `</div>`,
      `<div style="border:1px solid #e2e6ec;border-top:0;border-radius:0 0 10px 10px;padding:22px 24px;background:#ffffff">`,
      `<p style="font-size:14px;color:#7a1d1d;background:#fee2e2;padding:10px 14px;border-radius:6px;font-weight:bold">This visitor requested to speak with someone 5 minutes ago and no one has responded.</p>`,
      afterHours,
      conv.page_url ? `<p style="font-size:13px;color:#666">Page: ${esc(conv.page_url)}</p>` : "",
      contactBlock,
      transcript,
      `<a href="${appBase}/meddy" style="display:inline-block;margin-top:14px;background:#1d4ed8;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold">Open in Pulse</a>`,
      `</div></div>`,
    ].join("");

    await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: "Missed Chat - Visitor waiting for a response",
          body: { contentType: "HTML", content: html },
          from: { emailAddress: { address: fromAddress } },
          toRecipients: recipients.map((address: string) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      }),
    });
  } catch (e) {
    console.warn("missed chat email failed:", (e as Error).message);
  }
}
