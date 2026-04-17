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

async function sendEmailReminder(
  conn: EmailSyncConnection,
  toAddress: string,
  task: ActivityRow
): Promise<{ ok: boolean; error?: string }> {
  if (!conn.access_token) return { ok: false, error: "no access token" };

  const dueStr = task.due_at
    ? new Date(task.due_at).toLocaleString()
    : "no due date";

  const body = [
    `<p><strong>Reminder:</strong> ${escapeHtml(task.subject)}</p>`,
    task.body ? `<p>${escapeHtml(task.body).replace(/\n/g, "<br>")}</p>` : "",
    `<p style="color:#666"><em>Due: ${escapeHtml(dueStr)}</em></p>`,
    `<p style="color:#999;font-size:12px">From Medcurity CRM</p>`,
  ].join("");

  const res = await fetch(
    "https://graph.microsoft.com/v1.0/me/sendMail",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: `Reminder: ${task.subject}`,
          body: { contentType: "HTML", content: body },
          toRecipients: [{ emailAddress: { address: toAddress } }],
        },
        saveToSentItems: true,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
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
          : `/activities?type=task&owner=me`;
  const link = task.opportunity_id || task.contact_id || task.account_id
    ? `${base}?open_task=${task.id}`
    : `${base}&open_task=${task.id}`;

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

  if (wantEmail) {
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

    if (conn?.access_token && conn.email_address) {
      const result = await sendEmailReminder(
        conn as EmailSyncConnection,
        conn.email_address,
        task
      );
      if (!result.ok) {
        console.warn(
          `task-reminders: email failed for task ${task.id}: ${result.error}`
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
      "id, owner_user_id, subject, body, due_at, reminder_schedule, reminder_at, reminder_channels, account_id, contact_id, opportunity_id"
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
