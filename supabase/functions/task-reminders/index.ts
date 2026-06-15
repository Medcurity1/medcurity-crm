// task-reminders Edge Function
//
// Runs every N minutes (pg_cron). Finds activities where:
//   - reminder_schedule != 'none'
//   - reminder_at <= now()
//   - completed_at is null
//   - archived_at is null
//
// For each match:
//   1. Insert a row in public.notifications (the in-app bell).
//   2. Optionally send an email to the task owner via Microsoft Graph
//      using their connected Outlook token, IF the user's connection
//      has Mail.Send granted (silently skipped if the Graph call
//      returns 403 — the Azure permission is added separately).
//   3. Advance reminder_at to the next occurrence for recurring
//      schedules, or turn it off for 'once'.
//
// Deploy: supabase functions deploy task-reminders --no-verify-jwt
// Trigger: pg_cron every 5 min, same pattern as sync-emails.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ensureValidOutlookToken } from "../_shared/graph-token.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActivityRow {
  id: string;
  owner_user_id: string | null;
  subject: string;
  body: string | null;
  due_at: string | null;
  reminder_schedule: "none" | "once" | "daily" | "weekdays" | "weekly";
  reminder_at: string | null;
  reminder_channels: Array<"in_app" | "email">;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  // Joined display names so the reminder email can say WHAT the task is
  // about and link straight to it (Molly 2026-06-11: "not super
  // convenient to have to check back in the CRM and find what task this
  // is"). Same join shape outlook-calendar-sync uses.
  account?: { id: string; name: string | null } | null;
  contact?: { id: string; first_name: string | null; last_name: string | null } | null;
  opportunity?: { id: string; name: string | null } | null;
  lead?: { id: string; first_name: string | null; last_name: string | null; company: string | null } | null;
}

interface EmailSyncConnection {
  id: string;
  user_id: string;
  provider: "gmail" | "outlook";
  email_address: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
}

// ---------------------------------------------------------------------------
// Schedule advancement
// ---------------------------------------------------------------------------

/**
 * Compute the next reminder_at after a fire. Null means "don't re-fire"
 * (once schedule) so we set reminder_schedule back to 'none' upstream.
 *
 * For recurring schedules we advance by the corresponding interval, but
 * never schedule past the task's due_at — after the due date, the
 * reminder stops firing (the task should've been completed or bumped).
 */
function nextReminderAt(
  schedule: ActivityRow["reminder_schedule"],
  current: Date,
  dueAt: Date | null
): Date | null {
  if (schedule === "once" || schedule === "none") return null;
  let next = new Date(current);
  if (schedule === "daily") {
    next.setDate(next.getDate() + 1);
  } else if (schedule === "weekly") {
    next.setDate(next.getDate() + 7);
  } else if (schedule === "weekdays") {
    // skip Saturday (6) and Sunday (0)
    do {
      next.setDate(next.getDate() + 1);
    } while (next.getDay() === 0 || next.getDay() === 6);
  }
  if (dueAt && next > dueAt) return null;
  return next;
}

// ---------------------------------------------------------------------------
// Graph email (best-effort; silently skipped on 403 / no connection)
// ---------------------------------------------------------------------------

const APP_BASE = (Deno.env.get("APP_BASE_URL") ?? "https://crm.medcurity.com")
  .replace(/\/+$/, "");

/** Medcurity works Pacific time; raw toLocaleString() renders UTC and
 * showed times hours off (Molly's "3:36 PM" reminder). */
function formatDuePacific(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The records this task is about, with display names + CRM links. */
function relatedRecords(task: ActivityRow): Array<{ label: string; name: string; url: string }> {
  const out: Array<{ label: string; name: string; url: string }> = [];
  if (task.account?.name) {
    out.push({ label: "Account", name: task.account.name, url: `${APP_BASE}/accounts/${task.account.id}` });
  }
  if (task.contact) {
    const name = [task.contact.first_name, task.contact.last_name].filter(Boolean).join(" ");
    if (name) out.push({ label: "Contact", name, url: `${APP_BASE}/contacts/${task.contact.id}` });
  }
  if (task.opportunity?.name) {
    out.push({ label: "Opportunity", name: task.opportunity.name, url: `${APP_BASE}/opportunities/${task.opportunity.id}` });
  }
  if (task.lead) {
    const person = [task.lead.first_name, task.lead.last_name].filter(Boolean).join(" ");
    const name = person && task.lead.company ? `${person} (${task.lead.company})` : person || task.lead.company || "";
    if (name) out.push({ label: "Lead", name, url: `${APP_BASE}/leads/${task.lead.id}` });
  }
  return out;
}

async function sendEmailReminder(
  accessToken: string,
  toAddress: string,
  task: ActivityRow,
  taskLink: string
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const due = formatDuePacific(task.due_at);
  const related = relatedRecords(task);
  const primary = related[0]?.name;

  const relatedRows = related
    .map(
      (r) =>
        `<tr><td style="padding:3px 14px 3px 0;color:#777;font-size:13px;vertical-align:top">${r.label}</td>` +
        `<td style="padding:3px 0;font-size:13px"><a href="${r.url}" style="color:#127ebf;text-decoration:none;font-weight:bold">${escapeHtml(r.name)}</a></td></tr>`,
    )
    .join("");

  const html = [
    `<div style="margin:0 auto;max-width:560px;font-family:Arial,Helvetica,sans-serif">`,
    `<div style="background:#14181f;border-radius:10px 10px 0 0;padding:13px 24px">`,
    `<span style="font-size:19px;font-weight:bold;color:#dfe6ef;letter-spacing:1px">Pulse</span>`,
    `<span style="float:right;color:#8d99ad;font-size:12px;line-height:23px">Task reminder</span>`,
    `</div>`,
    `<div style="border:1px solid #e2e6ec;border-top:0;border-radius:0 0 10px 10px;padding:22px 24px;background:#ffffff">`,
    `<h2 style="margin:0 0 4px;font-size:18px;color:#121212">${escapeHtml(task.subject)}</h2>`,
    due
      ? `<p style="margin:0 0 14px;font-size:13px;color:#888">Due ${escapeHtml(due)} (Pacific)</p>`
      : `<p style="margin:0 0 14px;font-size:13px;color:#888">No due date</p>`,
    task.body
      ? `<p style="margin:0 0 14px;font-size:14px;color:#444;white-space:pre-wrap">${escapeHtml(task.body)}</p>`
      : "",
    relatedRows
      ? `<table style="border-collapse:collapse;margin:0 0 4px">${relatedRows}</table>`
      : "",
    `<a href="${taskLink}" style="display:inline-block;margin-top:14px;background:#1d4ed8;color:#ffffff;padding:10px 26px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:bold">Open task in Pulse</a>`,
    `<p style="margin:18px 0 0;font-size:11px;color:#9aa3af">Sent automatically by Pulse task reminders.</p>`,
    `</div></div>`,
  ].join("");

  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/sendMail",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: primary
            ? `Reminder: ${task.subject} · ${primary}`
            : `Reminder: ${task.subject}`,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: toAddress } }],
        },
        saveToSentItems: true,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Process one due reminder
// ---------------------------------------------------------------------------

async function processReminder(
  supabase: SupabaseClient,
  task: ActivityRow
): Promise<void> {
  if (!task.owner_user_id) return;

  // Link points at the record the task is attached to, with an open_task
  // query param so the frontend can pop the EditTaskDialog on arrival.
  // Falls back to the "my tasks" list view when the task has no record.
  const base =
    task.opportunity_id
      ? `/opportunities/${task.opportunity_id}`
      : task.contact_id
        ? `/contacts/${task.contact_id}`
        : task.account_id
          ? `/accounts/${task.account_id}`
          : task.lead_id
            ? `/leads/${task.lead_id}`
            : `/activities?type=task&owner=me`;
  const hasRecord =
    task.opportunity_id || task.contact_id || task.account_id || task.lead_id;
  const link = hasRecord
    ? `${base}?open_task=${task.id}`
    : `${base}&open_task=${task.id}`;
  // Absolute version for the email button (in-app uses the relative link).
  const fullLink = `${APP_BASE}${link}`;

  const wantInApp = task.reminder_channels.includes("in_app");
  const wantEmail = task.reminder_channels.includes("email");

  if (wantInApp) {
    await supabase.from("notifications").insert({
      user_id: task.owner_user_id,
      type: "task_due",
      title: `Reminder: ${task.subject}`,
      message: task.body ?? null,
      link,
    });
  }

  // Respect the per-user "individual task reminders" switch (default on):
  // when a rep turns it off in My Settings, suppress the email but keep
  // the in-app reminder above. The daily digest is the alternative.
  let perTaskEmailOff = false;
  if (wantEmail) {
    const { data: pref } = await supabase
      .from("user_notification_prefs")
      .select("prefs")
      .eq("user_id", task.owner_user_id)
      .maybeSingle();
    const p = (pref?.prefs ?? {}) as Record<string, unknown>;
    perTaskEmailOff =
      p.email_task_per_task === false || p.email_task_per_task === "false";
  }

  if (wantEmail && !perTaskEmailOff) {
    // Look up the owner's Outlook connection + email to send from/to.
    const { data: conn } = await supabase
      .from("email_sync_connections")
      .select(
        "id, user_id, provider, email_address, access_token, refresh_token, token_expires_at"
      )
      .eq("user_id", task.owner_user_id)
      .eq("provider", "outlook")
      .eq("is_active", true)
      .maybeSingle();

    if (conn?.email_address && (conn.access_token || conn.refresh_token)) {
      try {
        // Refresh if the stored token is stale — without this, cron-time
        // sends 401 because the access token expired ~1h after connect.
        const token = await ensureValidOutlookToken(
          supabase,
          conn as EmailSyncConnection,
        );
        let result = await sendEmailReminder(token, conn.email_address, task, fullLink);
        if (!result.ok && result.status === 401) {
          // Token looked valid but Graph rejected it (e.g. revoked and
          // reissued). Force one refresh and retry once.
          const fresh = await ensureValidOutlookToken(
            supabase,
            conn as EmailSyncConnection,
            true,
          );
          result = await sendEmailReminder(fresh, conn.email_address, task, fullLink);
        }
        if (!result.ok) {
          console.warn(
            `task-reminders: email failed for task ${task.id}: ${result.error}`
          );
        }
      } catch (e) {
        console.warn(
          `task-reminders: token refresh/email failed for task ${task.id}: ${(e as Error).message}`
        );
      }
    }
  }

  // Advance the schedule.
  const dueAt = task.due_at ? new Date(task.due_at) : null;
  const nextAt = nextReminderAt(
    task.reminder_schedule,
    new Date(task.reminder_at ?? new Date().toISOString()),
    dueAt
  );

  if (nextAt) {
    await supabase
      .from("activities")
      .update({
        reminder_at: nextAt.toISOString(),
        last_reminder_sent_at: new Date().toISOString(),
      })
      .eq("id", task.id);
  } else {
    // once schedule OR past due — stop firing
    await supabase
      .from("activities")
      .update({
        reminder_schedule: "none",
        reminder_at: null,
        last_reminder_sent_at: new Date().toISOString(),
      })
      .eq("id", task.id);
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const { data: due, error } = await supabase
    .from("activities")
    .select(
      `id, owner_user_id, subject, body, due_at, reminder_schedule, reminder_at, reminder_channels,
       account_id, contact_id, opportunity_id, lead_id,
       account:accounts!account_id ( id, name ),
       contact:contacts!contact_id ( id, first_name, last_name ),
       opportunity:opportunities!opportunity_id ( id, name ),
       lead:leads!lead_id ( id, first_name, last_name, company )`
    )
    .neq("reminder_schedule", "none")
    .is("completed_at", null)
    .is("archived_at", null)
    .lte("reminder_at", new Date().toISOString())
    .limit(100);

  if (error) {
    console.error("task-reminders fetch failed:", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
    });
  }

  let processed = 0;
  for (const task of (due ?? []) as ActivityRow[]) {
    try {
      await processReminder(supabase, task);
      processed++;
    } catch (e) {
      console.error(`task-reminders: task ${task.id} failed:`, e);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, processed, considered: due?.length ?? 0 }),
    { headers: { "Content-Type": "application/json" } }
  );
});
