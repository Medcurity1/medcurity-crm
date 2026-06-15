// task-digest Edge Function — one morning email per rep listing the
// tasks they have due today (plus anything overdue), each linking into
// Pulse.
//
// This is the "daily morning digest" option from My Settings →
// Notifications (pref key email_task_digest, opt-in). It does NOT replace
// the per-task reminder emails — reps choose either, both, or neither.
// Molly asked for digest-only; Summer asked for both.
//
// Sends via the rep's own connected Outlook, the same proven path
// task-reminders uses (ensureValidOutlookToken + Graph /me/sendMail), so
// there's no new sender or secret. Reps without Outlook connected are
// skipped (same limitation as the per-task emails).
//
// Trigger: GitHub Actions cron, weekday mornings ~8 AM Pacific.
// Deploy: supabase functions deploy task-digest

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureValidOutlookToken } from "../_shared/graph-token.ts";

const APP_BASE = (Deno.env.get("APP_BASE_URL") ?? "https://crm.medcurity.com").replace(
  /\/+$/,
  "",
);

const TASK_SELECT =
  "id, owner_user_id, subject, due_at, account_id, contact_id, opportunity_id, lead_id, " +
  "account:accounts!account_id(id, name), " +
  "contact:contacts!contact_id(id, first_name, last_name), " +
  "opportunity:opportunities!opportunity_id(id, name), " +
  "lead:leads!lead_id(id, first_name, last_name, company)";

interface TaskRow {
  id: string;
  owner_user_id: string;
  subject: string;
  due_at: string | null;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  account?: { id: string; name: string | null } | null;
  contact?: { id: string; first_name: string | null; last_name: string | null } | null;
  opportunity?: { id: string; name: string | null } | null;
  lead?: { id: string; first_name: string | null; last_name: string | null; company: string | null } | null;
}

interface Conn {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook";
  email_address: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** YYYY-MM-DD in Pacific. String compare on this is chronological and
 * dodges DST math entirely. */
function pacificYMD(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function dueLabel(iso: string | null): string {
  if (!iso) return "No due date";
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function taskLink(t: TaskRow): string {
  const base = t.opportunity_id
    ? `/opportunities/${t.opportunity_id}`
    : t.contact_id
      ? `/contacts/${t.contact_id}`
      : t.account_id
        ? `/accounts/${t.account_id}`
        : t.lead_id
          ? `/leads/${t.lead_id}`
          : `/activities?type=task&owner=me`;
  const hasRecord = t.opportunity_id || t.contact_id || t.account_id || t.lead_id;
  const link = hasRecord ? `${base}?open_task=${t.id}` : `${base}&open_task=${t.id}`;
  return `${APP_BASE}${link}`;
}

function relatedName(t: TaskRow): string | null {
  if (t.opportunity?.name) return t.opportunity.name;
  if (t.contact) {
    const n = [t.contact.first_name, t.contact.last_name].filter(Boolean).join(" ");
    if (n) return n;
  }
  if (t.account?.name) return t.account.name;
  if (t.lead) {
    const n =
      [t.lead.first_name, t.lead.last_name].filter(Boolean).join(" ") || t.lead.company;
    if (n) return n;
  }
  return null;
}

function taskRowHtml(t: TaskRow): string {
  const related = relatedName(t);
  return [
    `<tr><td style="padding:10px 0;border-bottom:1px solid #eef1f5">`,
    `<a href="${taskLink(t)}" style="color:#127ebf;text-decoration:none;font-weight:bold;font-size:14px">${escapeHtml(t.subject)}</a>`,
    `<div style="font-size:12px;color:#888;margin-top:2px">Due ${escapeHtml(dueLabel(t.due_at))}`,
    related ? ` &middot; ${escapeHtml(related)}` : "",
    `</div></td></tr>`,
  ].join("");
}

function buildDigestHtml(overdue: TaskRow[], dueToday: TaskRow[]): string {
  const section = (title: string, color: string, rows: TaskRow[]) =>
    rows.length === 0
      ? ""
      : `<h3 style="margin:18px 0 2px;font-size:13px;color:${color};text-transform:uppercase;letter-spacing:.5px">${title} (${rows.length})</h3>` +
        `<table style="width:100%;border-collapse:collapse">${rows.map(taskRowHtml).join("")}</table>`;

  return [
    `<div style="margin:0 auto;max-width:560px;font-family:Arial,Helvetica,sans-serif">`,
    `<div style="background:#14181f;border-radius:10px 10px 0 0;padding:13px 24px">`,
    `<span style="font-size:19px;font-weight:bold;color:#dfe6ef;letter-spacing:1px">Pulse</span>`,
    `<span style="float:right;color:#8d99ad;font-size:12px;line-height:23px">Daily task digest</span>`,
    `</div>`,
    `<div style="border:1px solid #e2e6ec;border-top:0;border-radius:0 0 10px 10px;padding:22px 24px;background:#ffffff">`,
    `<p style="margin:0 0 6px;font-size:14px;color:#444">Here's what's on your plate today.</p>`,
    section("Overdue", "#b91c1c", overdue),
    section("Due today", "#1d4ed8", dueToday),
    `<a href="${APP_BASE}/activities?type=task&owner=me" style="display:inline-block;margin-top:18px;background:#1d4ed8;color:#ffffff;padding:10px 26px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold">View all my tasks</a>`,
    `<p style="margin:18px 0 0;font-size:11px;color:#9aa3af">Daily digest from Pulse. Turn this off any time in My Settings &rarr; Notifications.</p>`,
    `</div></div>`,
  ].join("");
}

async function sendMail(
  accessToken: string,
  toAddress: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: [{ emailAddress: { address: toAddress } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

async function digestForUser(
  supabase: SupabaseClient,
  userId: string,
  todayP: string,
): Promise<"sent" | "no_tasks" | "no_outlook" | "error"> {
  const { data: tasks } = await supabase
    .from("activities")
    .select(TASK_SELECT)
    .eq("owner_user_id", userId)
    .eq("activity_type", "task")
    .is("completed_at", null)
    .is("archived_at", null)
    .not("due_at", "is", null)
    .order("due_at", { ascending: true });

  const due = ((tasks ?? []) as unknown as TaskRow[]).filter(
    (t) => t.due_at && pacificYMD(new Date(t.due_at)) <= todayP,
  );
  if (due.length === 0) return "no_tasks";

  const overdue = due.filter((t) => pacificYMD(new Date(t.due_at!)) < todayP);
  const dueToday = due.filter((t) => pacificYMD(new Date(t.due_at!)) === todayP);

  const { data: conn } = await supabase
    .from("email_sync_connections")
    .select("id, user_id, provider, email_address, access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("provider", "outlook")
    .eq("is_active", true)
    .maybeSingle();
  if (!conn?.email_address || !(conn.access_token || conn.refresh_token)) {
    return "no_outlook";
  }

  const subject = `Your tasks for today (${due.length})`;
  const html = buildDigestHtml(overdue, dueToday);
  try {
    const token = await ensureValidOutlookToken(supabase, conn as Conn);
    let res = await sendMail(token, conn.email_address, subject, html);
    if (!res.ok && res.status === 401) {
      const fresh = await ensureValidOutlookToken(supabase, conn as Conn, true);
      res = await sendMail(fresh, conn.email_address, subject, html);
    }
    if (!res.ok) {
      console.warn(`task-digest: send failed for ${userId}: ${res.error}`);
      return "error";
    }
    return "sent";
  } catch (e) {
    console.warn(`task-digest: token/send failed for ${userId}: ${(e as Error).message}`);
    return "error";
  }
}

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  // Everyone who opted into the daily digest.
  const { data: prefRows } = await supabase
    .from("user_notification_prefs")
    .select("user_id, prefs");
  const digestUsers = (prefRows ?? [])
    .filter((r) => {
      const v = (r.prefs ?? {})["email_task_digest"];
      return v === true || v === "true";
    })
    .map((r) => r.user_id as string);

  const todayP = pacificYMD(new Date());
  const out = { candidates: digestUsers.length, sent: 0, no_tasks: 0, no_outlook: 0, error: 0 };
  for (const userId of digestUsers) {
    const r = await digestForUser(supabase, userId, todayP);
    out[r]++;
  }

  return new Response(JSON.stringify({ ok: true, ...out }), {
    headers: { "Content-Type": "application/json" },
  });
});
