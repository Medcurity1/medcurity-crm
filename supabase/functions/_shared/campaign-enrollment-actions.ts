// Shared "stop this enrollment + archive its pending tasks (+ notify)"
// routines (Campaigns overhaul Phase 2, S6). Extracted from
// campaign-webhooks/index.ts's EMAIL_REPLIED/EMAIL_BOUNCED handlers (S5) so
// the daily-sweep's per-lead reconcile (playbook-smartlead/index.ts, S6)
// reacts to a reply/bounce it discovers via Smartlead's statistics endpoint
// EXACTLY the same way the real-time webhook does — same status transition,
// same task-archive reason string, same bell notification + follow-up task
// shape for a reply. One implementation, two callers.
//
// Pure move — no behavior change versus the S5 originals beyond the
// log-message prefix (was "campaign-webhooks: ...", now
// "campaign-enrollment-actions: ..." since this file is shared).
//
// `svc` is typed loosely (same DbClient convention as
// _shared/graph-token.ts / _shared/campaign-task-shift.ts) — each edge
// function passes its own service-role client instance.

// deno-lint-ignore no-explicit-any
type DbClient = any;

// Enrollment statuses neither caller should act on again. Was duplicated
// (identically) in both playbook-smartlead/index.ts and
// campaign-webhooks/index.ts before this extraction; this is now the single
// source of truth both import.
export const ENROLLMENT_TERMINAL_STATUSES = ["completed", "stopped", "replied", "bounced"];

export interface EnrollmentForActions {
  id: string;
  contact_id: string | null;
  account_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
}
export interface CampaignForActions {
  id: string;
  name: string;
  owner_user_id: string | null;
}

function displayName(e: EnrollmentForActions, fallbackEmail: string | null): string {
  const name = `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim();
  if (name) return name;
  return e.email || fallbackEmail || "A contact";
}

/**
 * Archive every still-pending campaign-generated task tied to one enrollment
 * (never deletes — stamps archived_at/archived_by/archive_reason, same
 * convention as every other task-archive path in this app). `archivedBy`
 * defaults to null (a system-triggered archive — webhook/sweep callers don't
 * pass one); the per-person Stop action in playbook-smartlead/index.ts (S8)
 * passes the caller's user id since that archive IS a human action, mirroring
 * cancelPendingCampaignTasks' campaign-level Stop.
 * Returns the number of tasks archived.
 */
export async function archivePendingTasksForEnrollment(
  svc: DbClient,
  enrollmentId: string,
  reason: string,
  archivedBy: string | null = null,
): Promise<number> {
  const { data: pending, error: findErr } = await svc
    .from("activities")
    .select("id")
    .eq("campaign_enrollment_id", enrollmentId)
    .eq("is_campaign_generated", true)
    .is("completed_at", null)
    .is("archived_at", null);
  if (findErr) {
    console.error("campaign-enrollment-actions: pending-task lookup failed:", findErr.message);
    return 0;
  }
  const ids = (pending ?? []).map((t: { id: string }) => t.id);
  if (!ids.length) return 0;
  const { error: updErr } = await svc
    .from("activities")
    .update({ archived_at: new Date().toISOString(), archived_by: archivedBy, archive_reason: reason })
    .in("id", ids);
  if (updErr) {
    console.error("campaign-enrollment-actions: archive update failed:", updErr.message);
    return 0;
  }
  return ids.length;
}

/**
 * Stop an enrollment on a reply: status -> 'replied', archive its pending
 * tasks, and (if the campaign has an owner) a bell notification + same-day
 * high-priority follow-up task. Idempotent — a no-op if the enrollment is
 * already in a terminal status (replay-safe for the webhook; re-sweep-safe
 * for the daily sweep).
 */
export async function stopEnrollmentForReply(
  svc: DbClient,
  enrollment: EnrollmentForActions,
  campaign: CampaignForActions,
  replyBody: string | null,
  fallbackEmail: string | null,
): Promise<{ updated: boolean; tasksCancelled: number }> {
  if (ENROLLMENT_TERMINAL_STATUSES.includes(enrollment.status)) return { updated: false, tasksCancelled: 0 };

  const { error } = await svc
    .from("campaign_enrollments")
    .update({ status: "replied", replied_at: new Date().toISOString(), paused_reason: "replied" })
    .eq("id", enrollment.id);
  if (error) console.error("campaign-enrollment-actions: reply status update failed:", error.message);

  const tasksCancelled = await archivePendingTasksForEnrollment(svc, enrollment.id, "Contact replied");

  if (campaign.owner_user_id) {
    const who = displayName(enrollment, fallbackEmail);
    const link = `/playbook?campaign=${campaign.id}`;

    const { error: notifErr } = await svc.from("notifications").insert({
      user_id: campaign.owner_user_id,
      type: "engagement",
      title: "Reply received",
      message: `${who} replied in ${campaign.name} — their sequence stopped`,
      link,
    });
    if (notifErr) console.error("campaign-enrollment-actions: reply notification insert failed:", notifErr.message);

    const nowIso = new Date().toISOString();
    const { error: taskErr } = await svc.from("activities").insert({
      activity_type: "task",
      owner_user_id: campaign.owner_user_id,
      subject: `Reply from ${who} — ${campaign.name}`,
      body: replyBody ? replyBody.slice(0, 2000) : null,
      due_at: nowIso,
      priority: "high",
      reminder_schedule: "once",
      reminder_at: nowIso,
      reminder_channels: ["in_app", "email"],
      is_campaign_generated: true,
      campaign_enrollment_id: enrollment.id,
      campaign_step_number: null,
      contact_id: enrollment.contact_id,
      account_id: enrollment.account_id,
    });
    if (taskErr) console.error("campaign-enrollment-actions: reply follow-up task insert failed:", taskErr.message);
  }

  return { updated: true, tasksCancelled };
}

/**
 * Stop an enrollment on a bounce: status -> 'bounced', archive its pending
 * tasks. No notification (matches the original S5 webhook behavior — a
 * bounce is logged, not paged). Idempotent.
 */
export async function stopEnrollmentForBounce(
  svc: DbClient,
  enrollment: EnrollmentForActions,
): Promise<{ updated: boolean; tasksCancelled: number }> {
  if (ENROLLMENT_TERMINAL_STATUSES.includes(enrollment.status)) return { updated: false, tasksCancelled: 0 };
  const { error } = await svc
    .from("campaign_enrollments")
    .update({ status: "bounced", bounced_at: new Date().toISOString() })
    .eq("id", enrollment.id);
  if (error) console.error("campaign-enrollment-actions: bounce status update failed:", error.message);
  const tasksCancelled = await archivePendingTasksForEnrollment(svc, enrollment.id, "Email bounced");
  return { updated: true, tasksCancelled };
}
