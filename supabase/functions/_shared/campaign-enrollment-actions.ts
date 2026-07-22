// Shared "stop this enrollment + archive its pending tasks (+ notify)"
// routines (Campaigns overhaul Phase 2, S6; extended Phase 3, S9). Extracted
// from campaign-webhooks/index.ts's EMAIL_REPLIED/EMAIL_BOUNCED handlers (S5)
// so the daily-sweep's per-lead reconcile (playbook-smartlead/index.ts, S6)
// reacts to a reply/bounce it discovers via Smartlead's statistics endpoint
// EXACTLY the same way the real-time webhook does — same status transition,
// same task-archive reason string, same bell notification + follow-up task
// shape for a reply, same campaign_events row, same contact-timeline
// activity for a reply. One implementation, two callers.
//
// S9 addition: previously only the real-time webhook (campaign-webhooks/
// index.ts) logged a campaign_events row — the daily sweep's reconcile
// called these same routines but left no event trail, so a reply the sweep
// caught (rather than a live webhook) was invisible in the Replies feed
// (CampaignReplies.tsx) even though the enrollment itself correctly stopped.
// recordEventIfMissing/logReplyActivity below close that gap for BOTH
// callers, guarded so the common webhook path (which already logs its own
// generic event row for every call, before dispatching here) never ends up
// with two rows for one reply.
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

// campaign_events.event_type values that represent a reply/bounce. Two
// variants each because the webhook path stores Smartlead's RAW event name
// (campaign-webhooks/index.ts inserts `normalized.rawType ?? normalized.type`,
// preferring the raw value — verified live 2026-07-22 as EMAIL_REPLY /
// EMAIL_BOUNCE, not the canonical EMAIL_REPLIED / EMAIL_BOUNCED — see
// playbook-smartlead/index.ts's SMARTLEAD_WEBHOOK_EVENT_TYPES comment), while
// older/future rows might carry the canonical name. Used both for the
// idempotency check below and (kept in sync manually) by
// src/features/playbook/api.ts's useCampaignReplies filter, since a browser
// bundle can't import this Deno-side file.
export const REPLY_EVENT_TYPES = ["EMAIL_REPLIED", "EMAIL_REPLY"];
export const BOUNCE_EVENT_TYPES = ["EMAIL_BOUNCED", "EMAIL_BOUNCE"];

/** Does a campaign_events row already exist for this enrollment with one of
 *  `types`? On a lookup failure, returns false (log and proceed to insert
 *  rather than silently drop the event — a rare duplicate is far better than
 *  a reply that never shows up anywhere). */
async function hasExistingEvent(svc: DbClient, enrollmentId: string, types: string[]): Promise<boolean> {
  const { data, error } = await svc
    .from("campaign_events")
    .select("id")
    .eq("enrollment_id", enrollmentId)
    .in("event_type", types)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("campaign-enrollment-actions: existing-event check failed (inserting anyway):", error.message);
    return false;
  }
  return !!data;
}

/**
 * Insert a campaign_events row for this enrollment UNLESS one of `dedupeTypes`
 * already exists for it. On the real-time webhook path this is normally a
 * no-op: campaign-webhooks/index.ts already inserts its own (richer, real
 * Smartlead payload) event row for every call before ever reaching here, so
 * this check finds it and skips. On the daily-sweep path (which never logs a
 * generic event row) this is the ONLY place the event gets recorded.
 */
async function recordEventIfMissing(
  svc: DbClient,
  opts: {
    enrollmentId: string;
    campaignId: string;
    email: string | null;
    eventType: string;
    dedupeTypes: string[];
    occurredAt?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  if (await hasExistingEvent(svc, opts.enrollmentId, opts.dedupeTypes)) return;
  const { error } = await svc.from("campaign_events").insert({
    campaign_id: opts.campaignId,
    enrollment_id: opts.enrollmentId,
    event_type: opts.eventType,
    email: opts.email,
    payload: opts.payload ?? {},
    occurred_at: opts.occurredAt ?? new Date().toISOString(),
  });
  if (error) console.error("campaign-enrollment-actions: event insert failed:", error.message);
}

/**
 * Log a "Replied: <campaign name>" activity on the enrollment's linked
 * contact, so a reply shows up on the contact's own timeline (not just the
 * Replies feed / campaign detail sheet). Mirrors the shape of launch()'s
 * step-9 email-activity insert (playbook-smartlead/index.ts) — same
 * activity_type/contact_id/account_id/owner_user_id/activity_date fields,
 * `email_direction: "received"` since this is inbound. Deliberately does NOT
 * set is_campaign_generated (stays at its default `false`) — that flag marks
 * a task as a still-pending, archivable campaign step
 * (archivePendingTasksForEnrollment matches on it), and this is a completed
 * historical record, not a pending task; leaving it false keeps this row out
 * of every "cancel pending campaign tasks" sweep.
 *
 * Idempotent via an exact-match query (campaign_enrollment_id + activity_type
 * + subject) rather than reusing the campaign_step_number-null convention —
 * that convention is the reply FOLLOW-UP TASK's idempotency key (a different
 * row, activity_type 'task', inserted separately above in
 * stopEnrollmentForReply), not this one.
 */
async function logReplyActivity(
  svc: DbClient,
  enrollment: EnrollmentForActions,
  campaign: CampaignForActions,
  replyBody: string | null,
): Promise<void> {
  if (!enrollment.contact_id) return;
  const subject = `Replied: ${campaign.name}`;
  const { data: existing, error: findErr } = await svc
    .from("activities")
    .select("id")
    .eq("campaign_enrollment_id", enrollment.id)
    .eq("activity_type", "email")
    .eq("subject", subject)
    .limit(1)
    .maybeSingle();
  if (findErr) {
    console.error("campaign-enrollment-actions: reply-activity lookup failed (skipping to avoid a dupe):", findErr.message);
    return;
  }
  if (existing) return;
  const { error: insErr } = await svc.from("activities").insert({
    activity_type: "email",
    subject,
    body: replyBody ? replyBody.slice(0, 2000) : null,
    email_direction: "received",
    contact_id: enrollment.contact_id,
    account_id: enrollment.account_id,
    owner_user_id: campaign.owner_user_id,
    campaign_enrollment_id: enrollment.id,
    activity_date: new Date().toISOString(),
  });
  if (insErr) console.error("campaign-enrollment-actions: reply-activity insert failed:", insErr.message);
}

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
 * tasks, log a campaign_events row + a "Replied: <campaign>" activity on the
 * linked contact (S9 — see recordEventIfMissing/logReplyActivity above), and
 * (if the campaign has an owner) a bell notification + same-day high-priority
 * follow-up task. Idempotent — a no-op if the enrollment is already in a
 * terminal status (replay-safe for the webhook; re-sweep-safe for the daily
 * sweep).
 *
 * `eventMeta` lets a caller that already knows a more precise event time
 * (the daily sweep reads one off Smartlead's per-lead statistics) and/or
 * wants the event tagged with its source pass those through; the real-time
 * webhook caller omits it (its own generic event insert, logged separately
 * before this runs, already carries the real payload/timestamp — this
 * function's own insert will find that row and no-op).
 */
export async function stopEnrollmentForReply(
  svc: DbClient,
  enrollment: EnrollmentForActions,
  campaign: CampaignForActions,
  replyBody: string | null,
  fallbackEmail: string | null,
  eventMeta?: { occurredAt?: string | null; source?: string },
): Promise<{ updated: boolean; tasksCancelled: number }> {
  if (ENROLLMENT_TERMINAL_STATUSES.includes(enrollment.status)) return { updated: false, tasksCancelled: 0 };

  const { error } = await svc
    .from("campaign_enrollments")
    .update({ status: "replied", replied_at: new Date().toISOString(), paused_reason: "replied" })
    .eq("id", enrollment.id);
  if (error) console.error("campaign-enrollment-actions: reply status update failed:", error.message);

  await recordEventIfMissing(svc, {
    enrollmentId: enrollment.id,
    campaignId: campaign.id,
    email: enrollment.email ?? fallbackEmail,
    eventType: "EMAIL_REPLY",
    dedupeTypes: REPLY_EVENT_TYPES,
    occurredAt: eventMeta?.occurredAt,
    payload: eventMeta?.source ? { source: eventMeta.source, reply_body: replyBody } : {},
  });

  await logReplyActivity(svc, enrollment, campaign, replyBody);

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
 * tasks, log a campaign_events row (S9 — see recordEventIfMissing above). No
 * notification (matches the original S5 webhook behavior — a bounce is
 * logged, not paged), no contact-timeline activity (that's a reply-only
 * signal). Idempotent. `eventMeta` — see stopEnrollmentForReply's doc
 * comment.
 */
export async function stopEnrollmentForBounce(
  svc: DbClient,
  enrollment: EnrollmentForActions,
  campaignId?: string,
  eventMeta?: { occurredAt?: string | null; source?: string },
): Promise<{ updated: boolean; tasksCancelled: number }> {
  if (ENROLLMENT_TERMINAL_STATUSES.includes(enrollment.status)) return { updated: false, tasksCancelled: 0 };
  const { error } = await svc
    .from("campaign_enrollments")
    .update({ status: "bounced", bounced_at: new Date().toISOString() })
    .eq("id", enrollment.id);
  if (error) console.error("campaign-enrollment-actions: bounce status update failed:", error.message);

  if (campaignId) {
    await recordEventIfMissing(svc, {
      enrollmentId: enrollment.id,
      campaignId,
      email: enrollment.email,
      eventType: "EMAIL_BOUNCE",
      dedupeTypes: BOUNCE_EVENT_TYPES,
      occurredAt: eventMeta?.occurredAt,
      payload: eventMeta?.source ? { source: eventMeta.source } : {},
    });
  }

  const tasksCancelled = await archivePendingTasksForEnrollment(svc, enrollment.id, "Email bounced");
  return { updated: true, tasksCancelled };
}
