// request-email-notify Edge Function
//
// Sends the email notice for a newly submitted request: ONE email, from
// the shared marketing mailbox, with ALL routed recipients on the same
// message (e.g. collateral -> Jordan + Nathan as co-recipients).
//
// How it sends: Microsoft Graph /me/sendMail using the designated
// sender's connected Outlook token (delegated Mail.Send), with
// message.from set to the marketing address ("Send As" rights on that
// mailbox make Graph accept it). No third-party email service.
//
// Config (Supabase secrets, both optional — sensible defaults):
//   REQUEST_NOTIFY_SENDER_EMAIL  mailbox whose CRM Outlook connection is
//                                used to send (default nathang@medcurity.com)
//   REQUEST_NOTIFY_FROM          the From address shown to recipients
//                                (default marketing@medcurity.com)
//   APP_BASE_URL                 link target for the "Open in Pulse" button
//
// Abuse/idempotency guard: compare-and-swaps requests.email_notified_at
// (set where null) BEFORE sending — a request can only ever produce one
// email, no matter how many times this function is invoked. On send
// failure the stamp is reset so a retry can succeed.
//
// Called fire-and-forget by the client right after a successful submit.
// The in-app bell (DB trigger) is the reliable channel; this is the
// best-effort email layer on top.
//
// Deploy: supabase functions deploy request-email-notify

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureValidOutlookToken } from "../_shared/graph-token.ts";

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
const SENDER_EMAIL = (
  Deno.env.get("REQUEST_NOTIFY_SENDER_EMAIL") ?? "nathang@medcurity.com"
).trim();
const FROM_ADDRESS = (
  Deno.env.get("REQUEST_NOTIFY_FROM") ?? "marketing@medcurity.com"
).trim();
const APP_BASE = (Deno.env.get("APP_BASE_URL") ?? "https://crm.medcurity.com")
  .replace(/\/+$/, "");

const TYPE_LABEL: Record<string, string> = {
  collateral: "collateral request",
  product: "product request",
  crm: "CRM request",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  try {
    // Must be a signed-in CRM user (any role — submitting is open to all).
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Not authenticated" }, 401);

    const { requestId } = (await req.json()) as { requestId?: string };
    if (!requestId) return json({ error: "Missing requestId" }, 400);

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Claim the email slot (CAS on email_notified_at IS NULL). Guarantees
    // at most one email per request regardless of repeat invocations.
    const { data: reqRow, error: claimErr } = await svc
      .from("requests")
      .update({ email_notified_at: new Date().toISOString() })
      .eq("id", requestId)
      .is("email_notified_at", null)
      .select()
      .maybeSingle();
    if (claimErr) return json({ error: claimErr.message }, 500);
    if (!reqRow) return json({ skipped: "already notified or not found" });

    // Product BUG reports skip the approval email — they file straight to
    // Jira on submit. Only the fallback path (filing failed/unconfigured,
    // request still pending with no ticket) emails the reviewers like a
    // normal product request. Keep the claim stamp either way: a filed
    // bug must never email later.
    const isBug =
      reqRow.type === "product" &&
      ((reqRow.details ?? {}) as Record<string, unknown>).category === "bug";
    if (isBug && (reqRow.status !== "pending" || reqRow.jira_issue_key)) {
      return json({ skipped: "bug auto-filed to Jira" });
    }

    async function unclaim() {
      await svc
        .from("requests")
        .update({ email_notified_at: null })
        .eq("id", requestId);
    }

    // Resolve routed recipients -> their auth emails.
    const { data: routing } = await svc
      .from("request_routing")
      .select("user_id")
      .eq("type", reqRow.type);
    const recipientEmails: string[] = [];
    for (const r of routing ?? []) {
      const { data: u } = await svc.auth.admin.getUserById(r.user_id);
      const email = u?.user?.email;
      if (email) recipientEmails.push(email);
    }
    if (recipientEmails.length === 0) {
      await unclaim();
      return json({ skipped: "no routed recipients" });
    }

    // The designated sender's Outlook connection (token carries Mail.Send;
    // "Send As" on the marketing mailbox lets us set From to it).
    const { data: conn } = await svc
      .from("email_sync_connections")
      .select("id, access_token, refresh_token, token_expires_at, email_address")
      .ilike("email_address", SENDER_EMAIL)
      .eq("provider", "outlook")
      .eq("is_active", true)
      .maybeSingle();
    if (!conn || (!conn.access_token && !conn.refresh_token)) {
      await unclaim();
      return json(
        { skipped: `sender mailbox ${SENDER_EMAIL} has no active Outlook connection` },
      );
    }

    let token: string;
    try {
      token = await ensureValidOutlookToken(svc, conn);
    } catch (e) {
      await unclaim();
      return json({ error: `token refresh failed: ${(e as Error).message}` }, 502);
    }

    const label = isBug ? "product bug report" : (TYPE_LABEL[reqRow.type] ?? "request");
    const subject = `New ${label}: ${reqRow.title}`;
    const html = [
      `<p>A new <strong>${escapeHtml(label)}</strong> is waiting for review.</p>`,
      `<table style="font-size:14px;border-collapse:collapse">`,
      `<tr><td style="padding:2px 12px 2px 0;color:#666">From</td><td>${escapeHtml(reqRow.requester_name ?? "Unknown")}</td></tr>`,
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Title</td><td>${escapeHtml(reqRow.title)}</td></tr>`,
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Priority</td><td>${escapeHtml(reqRow.priority)}</td></tr>`,
      `</table>`,
      reqRow.description
        ? `<p style="color:#444;white-space:pre-wrap">${escapeHtml(reqRow.description)}</p>`
        : "",
      `<p><a href="${APP_BASE}/nexus" style="display:inline-block;background:#1d4ed8;color:#fff;padding:9px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">Open in Pulse</a></p>`,
      `<p style="color:#999;font-size:12px">Sent by Pulse. Review and act on requests inside the CRM.</p>`,
    ].join("");

    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          from: { emailAddress: { address: FROM_ADDRESS } },
          toRecipients: recipientEmails.map((address) => ({
            emailAddress: { address },
          })),
        },
        saveToSentItems: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await unclaim();
      return json({ error: `sendMail ${res.status}: ${text.slice(0, 300)}` }, 502);
    }

    return json({ sent: true, to: recipientEmails, from: FROM_ADDRESS });
  } catch (err) {
    console.error("request-email-notify error:", err);
    return json({ error: String(err) }, 500);
  }
});
