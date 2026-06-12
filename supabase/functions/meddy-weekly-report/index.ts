// meddy-weekly-report Edge Function — the weekly AI recap of Meddy chat
// activity, ported from OG Nexus sendWeeklyReport (server.js:6777-6880;
// verbatim source in PULSE-GAME-PLAN/meddy-port/09-supplements.md §12).
//
// Changes vs Nexus (Nathan 2026-06-12):
//   * Recipients are no longer a REPORT_EMAILS secret — anyone who
//     toggles "weekly report email" ON in My Settings → Notifications
//     gets it (default off). No recipients → silent skip.
//   * Sent from marketing@ via the Outlook sender (no Resend).
// The stats gathering, AI overview prompt, and email layout are ported
// faithfully so the report reads exactly like the one Nathan loves.
//
// Trigger: GitHub Actions cron, Tuesdays 8 AM Pacific (Nexus parity).
// Deploy: supabase functions deploy meddy-weekly-report

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  MEDDY_MODEL,
  emailsForPref,
  sendOutlookEmail,
} from "../_shared/meddy-core.ts";

const svc = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

Deno.serve(async () => {
  const recipients = await emailsForPref(svc, "email_meddy_weekly_report");
  if (recipients.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "no subscribers" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = new Date();
  const sinceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: conversations } = await svc
    .from("meddy_conversations")
    .select("*")
    .gte("created_at", sinceDate.toISOString())
    .order("updated_at", { ascending: false });

  // ── Stats gathering (ported verbatim semantics) ───────────────────
  let totalMessages = 0;
  let humanRequestCount = 0;
  const dayMessageCounts: Record<string, number> = {};
  const leads: Array<{ name: string; email: string; organization: string; askingAbout: string }> = [];
  const convoSummaries: Array<Record<string, unknown>> = [];

  for (const c of conversations ?? []) {
    const { data: msgs } = await svc
      .from("meddy_messages")
      .select("role, content")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: true });
    const all = msgs ?? [];
    totalMessages += all.length;
    const userMsgs = all.filter((m: { role: string }) => m.role === "visitor");

    if (c.is_human_requested || c.is_human_takeover) humanRequestCount++;

    const day = new Date(c.created_at).toLocaleDateString("en-US", {
      weekday: "long",
      timeZone: "America/Los_Angeles",
    });
    dayMessageCounts[day] = (dayMessageCounts[day] || 0) + all.length;

    if (c.visitor_name || c.visitor_email) {
      let firstUserMsg = "";
      for (let i = 0; i < userMsgs.length && i < 3; i++) {
        firstUserMsg += (userMsgs[i].content || "").substring(0, 100) + " ";
      }
      leads.push({
        name: c.visitor_name || "Unknown",
        email: c.visitor_email || "",
        organization: c.visitor_company || "",
        askingAbout: firstUserMsg.trim().substring(0, 200),
      });
    }

    convoSummaries.push({
      page: c.page_url || "unknown",
      contact: c.visitor_name
        ? c.visitor_name + (c.visitor_email ? " <" + c.visitor_email + ">" : "")
        : null,
      userMessages: userMsgs
        .map((m: { content: string }) => (m.content || "").substring(0, 200))
        .slice(0, 5),
      messageCount: all.length,
      humanRequested: !!(c.is_human_requested || c.is_human_takeover),
    });
  }

  let busiestDay = "";
  let busiestCount = 0;
  for (const day of Object.keys(dayMessageCounts)) {
    if (dayMessageCounts[day] > busiestCount) {
      busiestDay = day;
      busiestCount = dayMessageCounts[day];
    }
  }

  // ── AI overview (prompt VERBATIM from Nexus) ──────────────────────
  const convCount = (conversations ?? []).length;
  const overviewPrompt =
    'You are summarizing a week of chatbot activity for Medcurity\'s website assistant "Meddy". ' +
    "Write a 2-3 paragraph overview as if briefing a colleague. Cover: what visitors were asking about, any trends you notice, " +
    "notable conversations, and how many leads came in. Be specific and conversational, not generic.\n\n" +
    "Stats: " + convCount + " conversations, " + totalMessages + " messages, " +
    leads.length + " leads captured, " + humanRequestCount + " human requests, busiest day: " + busiestDay + "\n\n" +
    "Conversations:\n" + JSON.stringify(convoSummaries, null, 2) +
    "\n\nReturn ONLY the paragraphs as HTML (wrapped in <p> tags). No markdown code blocks.";

  let overview = "<p>Report overview unavailable.</p>";
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (key) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MEDDY_MODEL,
          max_tokens: 1000,
          temperature: 0.3,
          messages: [{ role: "user", content: overviewPrompt }],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.content?.[0]?.text === "string") overview = data.content[0].text;
      }
    } catch (err) {
      console.error("Failed to generate report overview:", (err as Error).message);
    }
  }

  // ── Email layout (ported verbatim) ────────────────────────────────
  const formatDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const dateRange = formatDate(sinceDate) + " - " + formatDate(now);
  const stripAngle = (s: string) => (s || "").replace(/[<>]/g, "");

  let leadsHtml = "";
  if (leads.length > 0) {
    leadsHtml =
      '<div style="margin-bottom:24px;"><h2 style="color:#1B3A5C;font-size:18px;margin:0 0 12px;">Leads This Week (' + leads.length + ")</h2>";
    for (const lead of leads) {
      leadsHtml +=
        '<div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin-bottom:8px;font-size:14px;"><strong>' + stripAngle(lead.name) + "</strong>";
      if (lead.email) leadsHtml += ' &mdash; <a href="mailto:' + stripAngle(lead.email) + '" style="color:#1B3A5C;">' + stripAngle(lead.email) + "</a>";
      if (lead.organization) leadsHtml += '<br><span style="color:#666;">Organization: ' + stripAngle(lead.organization) + "</span>";
      if (lead.askingAbout) leadsHtml += '<br><span style="color:#888;font-size:13px;">Asked about: ' + stripAngle(lead.askingAbout) + "</span>";
      leadsHtml += "</div>";
    }
    leadsHtml += "</div>";
  } else {
    leadsHtml =
      '<div style="margin-bottom:24px;"><h2 style="color:#1B3A5C;font-size:18px;margin:0 0 12px;">Leads This Week</h2><p style="color:#888;font-size:14px;">No contact submissions this week.</p></div>';
  }

  const stat = (n: number | string, label: string) =>
    '<div style="flex:1;min-width:100px;text-align:center;"><div style="font-size:28px;font-weight:700;color:#1B3A5C;">' + n + '</div><div style="font-size:11px;color:#888;">' + label + "</div></div>";

  const htmlBody =
    '<div style="font-family:system-ui,-apple-system,sans-serif;color:#333;max-width:700px;margin:0 auto;padding:20px;">' +
    '<div style="background:#1B3A5C;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;"><h1 style="margin:0;font-size:22px;">Meddy Weekly Report</h1><p style="margin:4px 0 0;opacity:0.8;font-size:14px;">' + dateRange + "</p></div>" +
    '<div style="background:#f8f9fa;padding:20px 24px;border:1px solid #e5e5e5;"><div style="display:flex;gap:16px;flex-wrap:wrap;">' +
    stat(convCount, "Conversations") + stat(totalMessages, "Messages") +
    stat(leads.length, "Leads") + stat(humanRequestCount, "Human Requests") +
    "</div>" +
    (busiestDay
      ? '<div style="text-align:center;margin-top:12px;font-size:12px;color:#888;">Busiest day: <strong style="color:#333;">' + busiestDay + "</strong></div>"
      : "") +
    "</div>" +
    '<div style="padding:24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 10px 10px;">' +
    '<div style="margin-bottom:24px;"><h2 style="color:#1B3A5C;font-size:18px;margin:0 0 12px;">Weekly Overview</h2>' + overview + "</div>" +
    leadsHtml + "</div>" +
    '<p style="text-align:center;font-size:12px;color:#999;margin-top:20px;">Meddy Weekly Report &bull; Medcurity &bull; Pulse</p></div>';

  const sent = await sendOutlookEmail(
    svc,
    recipients,
    "Meddy Weekly Report - " + dateRange,
    htmlBody,
  );

  return new Response(
    JSON.stringify({ ok: true, sent, recipients: recipients.length, conversations: convCount }),
    { headers: { "Content-Type": "application/json" } },
  );
});
