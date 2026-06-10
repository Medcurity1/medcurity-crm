// outlook-calendar-sync Edge Function
//
// One-way sync: CRM tasks with a due_at -> events on the owner's Outlook
// calendar. Edits to the task update the event; completion or archive
// removes it. Edits made IN Outlook don't reflect back (by design).
//
// Runs:
//   - POST /tasks/:id  (body: {} or omitted)    — single-task sync
//   - POST /              (cron)                 — bulk reconcile
//
// Requires Azure App Registration to grant Calendars.ReadWrite (delegated).
// If the token lacks that scope, Graph returns 403 and we record the error
// on the activity row so the UI can surface it — but we never block the
// task itself from saving.
//
// Deploy: supabase functions deploy outlook-calendar-sync --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  owner_user_id: string | null;
  subject: string;
  body: string | null;
  due_at: string | null;
  completed_at: string | null;
  archived_at: string | null;
  outlook_event_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  opportunity_id: string | null;
  lead_id: string | null;
  // Joined display names + a per-record deep link. Populated by the
  // SELECT below so calendar attendees can see at a glance what
  // account/contact this task is for without opening the CRM first.
  account?: { id: string; name: string | null } | null;
  contact?: { id: string; first_name: string | null; last_name: string | null } | null;
  opportunity?: { id: string; name: string | null } | null;
  lead?: { id: string; first_name: string | null; last_name: string | null; company: string | null } | null;
}

interface EmailConn {
  user_id: string;
  access_token: string | null;
  email_address: string | null;
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

const GRAPH = "https://graph.microsoft.com/v1.0";

const APP_BASE = (Deno.env.get("APP_BASE_URL") ?? "https://crm.medcurity.com").replace(/\/+$/, "");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Build the "Related to:" block users will see at the top of the
// calendar event body, including deep links back to the CRM. Reps
// repeatedly asked "what account is this for?" when an event landed
// on their calendar with just a bare task subject — showing it here
// removes that friction.
function buildContextLines(task: TaskRow): string {
  const lines: string[] = [];
  if (task.account?.name) {
    lines.push(
      `<strong>Account:</strong> <a href="${APP_BASE}/accounts/${task.account.id}">${escapeHtml(task.account.name)}</a>`
    );
  }
  if (task.contact) {
    const name =
      [task.contact.first_name, task.contact.last_name].filter(Boolean).join(" ") ||
      "(unnamed)";
    lines.push(
      `<strong>Contact:</strong> <a href="${APP_BASE}/contacts/${task.contact.id}">${escapeHtml(name)}</a>`
    );
  }
  if (task.opportunity?.name) {
    lines.push(
      `<strong>Opportunity:</strong> <a href="${APP_BASE}/opportunities/${task.opportunity.id}">${escapeHtml(task.opportunity.name)}</a>`
    );
  }
  if (task.lead) {
    const name =
      [task.lead.first_name, task.lead.last_name].filter(Boolean).join(" ") || "(unnamed)";
    const co = task.lead.company ? ` — ${escapeHtml(task.lead.company)}` : "";
    lines.push(
      `<strong>Lead:</strong> <a href="${APP_BASE}/leads/${task.lead.id}">${escapeHtml(name)}${co}</a>`
    );
  }
  return lines.length ? `<p>${lines.join("<br>")}</p>` : "";
}

function taskToEventBody(task: TaskRow) {
  // Represent the task as a 30-min block starting at due_at. The rep can
  // move or extend it in Outlook without us overwriting since we only push
  // core fields (subject, body, start, end) on update.
  const start = new Date(task.due_at!);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const context = buildContextLines(task);
  const notes = task.body
    ? `<p>${task.body.replace(/\n/g, "<br>")}</p>`
    : "";
  const footer = `<p style="color:#999;font-size:12px">Synced from PulsePoint · <a href="${APP_BASE}/activities/${task.id}">Open task</a></p>`;
  return {
    subject: `[PulsePoint] ${task.subject}`,
    body: {
      contentType: "HTML",
      content: `${context}${notes}${footer}`,
    },
    start: { dateTime: start.toISOString(), timeZone: "UTC" },
    end: { dateTime: end.toISOString(), timeZone: "UTC" },
    reminderMinutesBeforeStart: 15,
    isReminderOn: true,
    // Show the rep as Free, not Busy — a CRM task on the calendar
    // shouldn't block their availability (Brayden flagged this).
    showAs: "free",
    categories: ["PulsePoint"],
  };
}

async function createEvent(
  conn: EmailConn,
  task: TaskRow
): Promise<{ id: string } | { error: string }> {
  const res = await fetch(`${GRAPH}/me/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(taskToEventBody(task)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `create ${res.status}: ${text.slice(0, 200)}` };
  }
  const data = await res.json();
  return { id: data.id as string };
}

async function updateEvent(
  conn: EmailConn,
  eventId: string,
  task: TaskRow
): Promise<{ ok: true } | { error: string }> {
  const res = await fetch(`${GRAPH}/me/events/${eventId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${conn.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(taskToEventBody(task)),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `update ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

async function deleteEvent(
  conn: EmailConn,
  eventId: string
): Promise<{ ok: true } | { error: string }> {
  const res = await fetch(`${GRAPH}/me/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${conn.access_token}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    return { error: `delete ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Per-task logic
// ---------------------------------------------------------------------------

/**
 * Bring the owner's Outlook calendar into line with the task's current
 * state. Idempotent.
 *   - no due_at OR completed OR archived → event should NOT exist
 *   - has due_at + open → event should match taskToEventBody
 */
async function syncTask(supabase: SupabaseClient, task: TaskRow): Promise<void> {
  if (!task.owner_user_id) return;

  const shouldExist =
    !!task.due_at && !task.completed_at && !task.archived_at;

  // Pull the owner's Outlook connection (may not exist yet).
  const { data: conn } = await supabase
    .from("email_sync_connections")
    .select("user_id, access_token, email_address")
    .eq("user_id", task.owner_user_id)
    .eq("provider", "outlook")
    .eq("is_active", true)
    .maybeSingle();

  if (!conn || !conn.access_token) {
    // Nothing to do until the owner connects Outlook. Leave outlook_event_id
    // alone — if they connect later we'll reconcile then.
    return;
  }

  try {
    if (!shouldExist) {
      if (task.outlook_event_id) {
        const del = await deleteEvent(conn as EmailConn, task.outlook_event_id);
        if ("error" in del) {
          await supabase
            .from("activities")
            .update({ outlook_sync_error: del.error })
            .eq("id", task.id);
          return;
        }
        await supabase
          .from("activities")
          .update({
            outlook_event_id: null,
            outlook_sync_error: null,
            outlook_synced_at: new Date().toISOString(),
          })
          .eq("id", task.id);
      }
      return;
    }

    // shouldExist == true
    if (task.outlook_event_id) {
      const up = await updateEvent(
        conn as EmailConn,
        task.outlook_event_id,
        task
      );
      if ("error" in up) {
        // 404 from Outlook means the user deleted the event manually;
        // recreate it fresh.
        if (up.error.startsWith("update 404")) {
          const created = await createEvent(conn as EmailConn, task);
          if ("error" in created) {
            await supabase
              .from("activities")
              .update({ outlook_sync_error: created.error })
              .eq("id", task.id);
            return;
          }
          await supabase
            .from("activities")
            .update({
              outlook_event_id: created.id,
              outlook_sync_error: null,
              outlook_synced_at: new Date().toISOString(),
            })
            .eq("id", task.id);
          return;
        }
        await supabase
          .from("activities")
          .update({ outlook_sync_error: up.error })
          .eq("id", task.id);
        return;
      }
      await supabase
        .from("activities")
        .update({
          outlook_sync_error: null,
          outlook_synced_at: new Date().toISOString(),
        })
        .eq("id", task.id);
    } else {
      const created = await createEvent(conn as EmailConn, task);
      if ("error" in created) {
        await supabase
          .from("activities")
          .update({ outlook_sync_error: created.error })
          .eq("id", task.id);
        return;
      }
      await supabase
        .from("activities")
        .update({
          outlook_event_id: created.id,
          outlook_sync_error: null,
          outlook_synced_at: new Date().toISOString(),
        })
        .eq("id", task.id);
    }
  } catch (e) {
    console.error(`outlook-calendar-sync task ${task.id}:`, e);
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } }
  );

  const url = new URL(req.url);
  // Single-task mode: /outlook-calendar-sync/tasks/<uuid>
  const taskMatch = url.pathname.match(/\/tasks\/([0-9a-f-]{36})$/i);

  if (taskMatch && req.method === "POST") {
    const id = taskMatch[1];
    const { data: task, error } = await supabase
      .from("activities")
      .select(
        `id, owner_user_id, subject, body, due_at, completed_at, archived_at, outlook_event_id,
         account_id, contact_id, opportunity_id, lead_id,
         account:accounts!account_id ( id, name ),
         contact:contacts!contact_id ( id, first_name, last_name ),
         opportunity:opportunities!opportunity_id ( id, name ),
         lead:leads!lead_id ( id, first_name, last_name, company )`
      )
      .eq("id", id)
      // Only genuine tasks become calendar events. Emails/calls can carry a
      // due_at but must never sync (mirrors the bulk path's filter).
      .eq("activity_type", "task")
      .maybeSingle();
    if (error || !task) {
      return new Response(JSON.stringify({ ok: false, error: "not found" }), {
        status: 404,
      });
    }
    await syncTask(supabase, task as TaskRow);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Bulk reconcile: tasks with due_at whose outlook state is stale.
  // Simple heuristic: everything with due_at in the last 90 days OR
  // the next 180 days, ordered by most-recently-updated. Caps at 200.
  const now = new Date();
  const ninetyAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data: tasks, error } = await supabase
    .from("activities")
    .select(
      `id, owner_user_id, subject, body, due_at, completed_at, archived_at, outlook_event_id,
       account_id, contact_id, opportunity_id, lead_id,
       account:accounts!account_id ( id, name ),
       contact:contacts!contact_id ( id, first_name, last_name ),
       opportunity:opportunities!opportunity_id ( id, name ),
       lead:leads!lead_id ( id, first_name, last_name, company )`
    )
    .eq("activity_type", "task")
    .gte("due_at", ninetyAgo)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
    });
  }

  let processed = 0;
  for (const t of (tasks ?? []) as TaskRow[]) {
    await syncTask(supabase, t);
    processed++;
  }
  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { "Content-Type": "application/json" },
  });
});
