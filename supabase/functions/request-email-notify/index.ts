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
// Helm's ticket board (MSD-999): emails that reference a filed ticket link to
// it in Helm. /tickets?view=list&q=<key> pulls up exactly that ticket.
const HELM_BASE = (
  Deno.env.get("HELM_APP_URL") ?? "https://app-helm-prod-ad7881.azurewebsites.net"
).replace(/\/+$/, "");

function helmTicketUrl(jiraKey: string): string {
  return `${HELM_BASE}/tickets?view=list&q=${encodeURIComponent(jiraKey)}`;
}

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

    // Product BUG reports get their OWN email (built below), not the review
    // email: a bug files straight to Jira on submit, so there's nothing to
    // approve — but the routed product team still needs to know a ticket
    // landed and that the work is waiting in the dev tools. A bug whose
    // filing FAILED stays pending with no ticket and falls through to the
    // normal review email, so nothing is ever silently dropped.
    const isBug =
      reqRow.type === "product" &&
      ((reqRow.details ?? {}) as Record<string, unknown>).category === "bug";
    const isFiledBug = isBug && (reqRow.status !== "pending" || !!reqRow.jira_issue_key);

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

    // Client-impact determination (MSD-957). Rachel's ask was that the
    // client-facing decision appear IN the email, not just in a database
    // column, so it is a first-class row in the details table for bugs.
    const details = (reqRow.details ?? {}) as Record<string, unknown>;
    const clientFacing = details.client_facing === true;
    const cfReasoning =
      typeof details.client_facing_reasoning === "string"
        ? details.client_facing_reasoning
        : "";
    const cfSource = details.client_facing_source === "submitter" ? "submitter" : "ai";
    // No automatic verdict was produced — the codebase check failed or timed
    // out and a person answered unaided (2026-08-12). A "No" from that path
    // was rendering as a calm green "No" in exactly the same layout as a
    // 0.95-confidence verdict, in a normal-importance email. It shouldn't.
    const cfDegraded =
      typeof details.client_facing_degraded === "boolean"
        ? details.client_facing_degraded
        : !!cfReasoning && Number(details.client_facing_confidence) === 0;

    // Shared detail rows (From / Title / Priority) used by both templates.
    const detailRows = [
      `<table style="font-size:14px;border-collapse:collapse">`,
      `<tr><td style="padding:2px 12px 2px 0;color:#666">From</td><td>${escapeHtml(reqRow.requester_name ?? "Unknown")}</td></tr>`,
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Title</td><td>${escapeHtml(reqRow.title)}</td></tr>`,
      `<tr><td style="padding:2px 12px 2px 0;color:#666">Priority</td><td>${escapeHtml(reqRow.priority)}</td></tr>`,
      isBug
        ? `<tr><td style="padding:2px 12px 2px 0;color:#666">Client-facing</td><td><strong style="color:${
            clientFacing ? "#b91c1c" : cfDegraded ? "#b45309" : "#166534"
          }">${clientFacing ? "Yes" : "No"}${
            cfDegraded ? " — not verified" : ""
          }</strong></td></tr>`
        : "",
      `</table>`,
      isBug && cfDegraded
        ? `<p style="background:#fef2f2;border-left:3px solid #dc2626;padding:8px 12px;color:#7f1d1d;font-size:13px;margin:8px 0 0"><strong>The automatic check didn't run on this one.</strong> Nothing read the codebase, so the answer above is the reporter's own call. If it turns out a client is affected, it should go to the dev team now rather than wait here.</p>`
        : "",
      isBug && cfReasoning && !cfDegraded
        ? `<p style="color:#666;font-size:13px;margin:6px 0 0">${escapeHtml(cfReasoning)}${
            cfSource === "submitter" ? " (set by the person reporting it)" : ""
          }</p>`
        : "",
      reqRow.description
        ? `<p style="color:#444;white-space:pre-wrap">${escapeHtml(reqRow.description)}</p>`
        : "",
    ].join("");

    let subject: string;
    let html: string;
    // MSD-999 (Rachel): every email about a client-facing ticket that went
    // straight to the dev team is HIGH IMPORTANCE — it's the only signal that
    // work skipped the review queue. Review emails stay normal.
    let importance: "high" | "normal" = "normal";

    if (isFiledBug) {
      // A bug affecting a client. It went straight to the dev team on purpose
      // — nothing about it is waiting on a person — so this is a heads-up, not
      // a request for action, and it links to the ticket in Helm rather than
      // back into Pulse. Deliberately does NOT say "no action needed": the dev
      // team still has to work it; there is just nothing to approve.
      importance = "high";
      const key = reqRow.jira_issue_key as string | null;
      const ticket = key
        ? ` as <a href="${helmTicketUrl(key)}" style="font-weight:600">${escapeHtml(key)}</a>`
        : "";
      subject = `Client-impacting bug: ${reqRow.title}`;
      html = [
        `<p>A bug came in that <strong>is affecting a client</strong>, so it went straight to the dev team${ticket} without waiting for review.</p>`,
        detailRows,
        key
          ? `<p><a href="${helmTicketUrl(key)}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:9px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">Open ${escapeHtml(key)} in Helm</a>${
              reqRow.jira_issue_url
                ? `&nbsp;&nbsp;<a href="${reqRow.jira_issue_url}" style="font-size:13px">View in Jira</a>`
                : ""
            }</p>`
          : `<p>Check <strong>Helm</strong> or <strong>Jira</strong> for the ticket and full details.</p>`,
        `<p style="color:#999;font-size:12px">Sent by Pulse. Time-sensitive bugs affecting clients skip the review queue so nothing holds them up — this is your heads-up that one landed. It's been assigned to Makena.</p>`,
      ].join("");
    } else if (isBug) {
      // A bug NOT affecting clients. Nothing has been filed. It is sitting in
      // the review queue waiting on a decision, so this one does link back.
      //
      // If no automatic check ran, this email is the only thing standing
      // between an unverified "no" and a queue with no SLA — so it says so in
      // the subject line and goes out high importance.
      if (cfDegraded) importance = "high";
      subject = cfDegraded
        ? `Bug report to review (check failed): ${reqRow.title}`
        : `Bug report to review: ${reqRow.title}`;
      html = [
        cfDegraded
          ? `<p>A new <strong>bug report</strong> came in, and the automatic client-impact check <strong>failed</strong> on it. It was marked as not affecting clients by the person reporting it, so nothing has been sent to the dev team — please sanity-check that before it waits.</p>`
          : `<p>A new <strong>bug report</strong> came in. It doesn't look like it's affecting clients, so nothing has been sent to the dev team yet — it's waiting on your call.</p>`,
        detailRows,
        `<p><a href="${APP_BASE}/nexus" style="display:inline-block;background:#1d4ed8;color:#fff;padding:9px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">Review in Pulse</a></p>`,
        `<p style="color:#999;font-size:12px">Sent by Pulse. Approving it files the Jira ticket; denying it closes the request.</p>`,
      ].join("");
    } else {
      const label = TYPE_LABEL[reqRow.type] ?? "request";
      subject = `New ${label}: ${reqRow.title}`;
      html = [
        `<p>A new <strong>${escapeHtml(label)}</strong> is waiting for review.</p>`,
        detailRows,
        `<p><a href="${APP_BASE}/nexus" style="display:inline-block;background:#1d4ed8;color:#fff;padding:9px 22px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">Open in Pulse</a></p>`,
        `<p style="color:#999;font-size:12px">Sent by Pulse. Review and act on requests inside the CRM.</p>`,
      ].join("");
    }

    const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject,
          importance,
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
