// Shared "stop this enrollment + archive its pending tasks (+ notify)"
// routines (Campaigns overhaul Phase 2, S6; extended Phase 3, S9). Extracted
// from campaign-webhooks/index.ts's EMAIL_REPLIED/EMAIL_BOUNCED handlers (S5)
// so the daily-sweep's per-lead reconcile (playbook-smartlead/index.ts, S6)
// reacts to a reply/bounce it discovers via Smartlead's statistics endpoint
// EXACTLY the same way the real-time webhook does — same status transition,
// same task-archive reason string, same bell notification + follow-up task
// shape for a reply, same campaign_events row, same contact-timeline
// activity for a reply. One implementation, two callers.

import { normalizeReplyText } from "./reply-text.ts";
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
export const UNSUBSCRIBE_EVENT_TYPES = ["LEAD_UNSUBSCRIBED", "EMAIL_UNSUBSCRIBED"];

export type MarketingOptoutReason = "unsubscribed" | "bounced" | "manual";

/**
 * Durable, email-keyed opt-out/bounce record (outside-review fix 2,
 * 2026-07-28) — the write half of the marketing_optouts table
 * (20260728100000), whose optout_* branch of v_marketing_suppression every
 * send path already reads. Called UNCONDITIONALLY by the unsubscribe/bounce
 * routines below, before and regardless of any status-transition guard, so
 * the opt-out survives even when the enrollment already ended (replied,
 * completed, stopped) — and it works for CSV/paste recipients with no
 * contact row, because the key is the email itself.
 *
 * Idempotent: upsert on (email, reason) with ignoreDuplicates — the FIRST
 * record wins and replays are no-ops. The full row is always supplied (this
 * is an insert-or-skip, never a partial-row update), so the
 * upsert-partial-row NOT-NULL trap from the Phase 1 build doesn't apply.
 * A missing/blank email is a silent no-op — there is nothing to key on.
 */
export async function recordMarketingOptout(
  svc: DbClient,
  opts: {
    email: string | null;
    reason: MarketingOptoutReason;
    source: string;
    campaignId?: string | null;
    enrollmentId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
  },
): Promise<void> {
  const email = (opts.email ?? "").trim().toLowerCase();
  if (!email) return;
  const { error } = await svc.from("marketing_optouts").upsert(
    {
      email,
      reason: opts.reason,
      source: opts.source,
      campaign_id: opts.campaignId ?? null,
      enrollment_id: opts.enrollmentId ?? null,
      first_name: opts.firstName ?? null,
      last_name: opts.lastName ?? null,
      company: opts.company ?? null,
    },
    { onConflict: "email,reason", ignoreDuplicates: true },
  );
  if (error) console.error("campaign-enrollment-actions: marketing_optouts write failed:", error.message);
}

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
  /** Optional — populated by callers whose select includes it, so the
   *  marketing_optouts record (and the Do-Not-Email report's Company
   *  column) isn't blank for opt-out rows. */
  company?: string | null;
  /** Optional — the enrollment's own owner (the contact's owner, stamped at
   *  launch since outside-review group 2). When present, reply
   *  notifications + follow-up tasks route HERE; the campaign owner is only
   *  the fallback. */
  owner_user_id?: string | null;
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
 * Un-archive an enrollment's campaign tasks that a PAUSE archived — the
 * missing reverse of archivePendingTasksForEnrollment (outside-review group
 * 2, docket I4: resuming a meeting-booked pause used to permanently lose
 * the person's remaining call/LinkedIn tasks, because nothing ever cleared
 * archived_at and the spawner only runs once per enrollment).
 *
 * Restores ONLY tasks whose archive_reason is in `reasons` — the caller
 * names the pause reason it is reversing (e.g. "Opportunity opened"), so
 * tasks archived by replies/bounces/unsubscribes/stops are never
 * resurrected. A restored task whose due date already passed while paused
 * is re-dated to tomorrow (same time of day) so it reappears in Up Next
 * instead of being born overdue.
 * Returns the number of tasks restored.
 */
export async function restoreArchivedTasksForEnrollment(
  svc: DbClient,
  enrollmentId: string,
  reasons: string[],
): Promise<number> {
  const { data: archived, error: findErr } = await svc
    .from("activities")
    .select("id, due_at")
    .eq("campaign_enrollment_id", enrollmentId)
    .eq("is_campaign_generated", true)
    .is("completed_at", null)
    .not("archived_at", "is", null)
    .in("archive_reason", reasons);
  if (findErr) {
    console.error("campaign-enrollment-actions: archived-task lookup failed:", findErr.message);
    return 0;
  }
  const rows = (archived ?? []) as { id: string; due_at: string | null }[];
  if (!rows.length) return 0;

  const { error: updErr } = await svc
    .from("activities")
    .update({ archived_at: null, archived_by: null, archive_reason: null })
    .in("id", rows.map((t) => t.id));
  if (updErr) {
    console.error("campaign-enrollment-actions: task restore failed:", updErr.message);
    return 0;
  }

  // Re-date any task that went overdue while paused: tomorrow, keeping the
  // original time of day (the send-window slot the step chose).
  const now = new Date();
  for (const t of rows) {
    if (!t.due_at) continue;
    const due = new Date(t.due_at);
    if (Number.isNaN(due.getTime()) || due > now) continue;
    const next = new Date(due);
    next.setUTCFullYear(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    next.setUTCDate(next.getUTCDate() + 1);
    const nextIso = next.toISOString();
    const { error: dateErr } = await svc
      .from("activities")
      .update({ due_at: nextIso, reminder_at: nextIso })
      .eq("id", t.id);
    if (dateErr) console.error("campaign-enrollment-actions: restored-task re-date failed:", dateErr.message);
  }
  return rows.length;
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
  const readableReplyBody = normalizeReplyText(replyBody);
  // Atomic transition guard: the live webhook and the daily sweep can both
  // observe the same reply and call this concurrently. A plain read-then-act
  // check against the caller's (possibly stale) `enrollment.status` snapshot
  // is a TOCTOU race — both callers could see "not terminal yet" and both
  // run the side effects below, double-firing the bell notification and the
  // "Reply from X" follow-up task (which isn't deduped by the partial unique
  // index, since its campaign_step_number is NULL and NULLs are distinct).
  // Instead, the UPDATE itself is the lock: it only matches a row that is
  // STILL non-terminal at write time, and `.select("id")` tells us whether
  // THIS call won that race. Only the winner (non-empty result) proceeds to
  // the notification/task/event/archive side effects below; the loser's
  // update matches zero rows and returns immediately, a clean no-op.
  const { data: transitioned, error } = await svc
    .from("campaign_enrollments")
    .update({ status: "replied", replied_at: new Date().toISOString(), paused_reason: "replied" })
    .eq("id", enrollment.id)
    .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`)
    .select("id");
  if (error) {
    console.error("campaign-enrollment-actions: reply status update failed:", error.message);
    return { updated: false, tasksCancelled: 0 };
  }
  if (!transitioned?.length) return { updated: false, tasksCancelled: 0 };

  await recordEventIfMissing(svc, {
    enrollmentId: enrollment.id,
    campaignId: campaign.id,
    email: enrollment.email ?? fallbackEmail,
    eventType: "EMAIL_REPLY",
    dedupeTypes: REPLY_EVENT_TYPES,
    occurredAt: eventMeta?.occurredAt,
    payload: eventMeta?.source ? { source: eventMeta.source, reply_body: replyBody } : {},
  });

  await logReplyActivity(svc, enrollment, campaign, readableReplyBody);

  const tasksCancelled = await archivePendingTasksForEnrollment(svc, enrollment.id, "Contact replied");

  // Owner routing (outside-review group 2): the reply belongs to the
  // person's own owner when the enrollment carries one; the campaign owner
  // (the launcher) is only the fallback — a marketer running a campaign on
  // a rep's book must not swallow the rep's replies.
  const notifyUserId = enrollment.owner_user_id ?? campaign.owner_user_id;
  if (notifyUserId) {
    const who = displayName(enrollment, fallbackEmail);
    // /playbook is admin-gated; contact owners who get this bell must land
    // on the person they need to follow up with. Campaigns tab is still
    // reachable for admins from the sidebar.
    const link = enrollment.contact_id
      ? `/contacts/${enrollment.contact_id}`
      : `/playbook?campaign=${campaign.id}`;

    const { error: notifErr } = await svc.from("notifications").insert({
      user_id: notifyUserId,
      type: "engagement",
      title: "Reply received",
      message: `${who} replied. Their sequence is stopped.`,
      link,
    });
    if (notifErr) console.error("campaign-enrollment-actions: reply notification insert failed:", notifErr.message);

    const nowIso = new Date().toISOString();
    const { error: taskErr } = await svc.from("activities").insert({
      activity_type: "task",
      owner_user_id: notifyUserId,
      subject: `Follow up with ${who}`,
      body: readableReplyBody,
      due_at: nowIso,
      priority: "high",
      // The dedicated "Reply received" notification above is the immediate
      // alert. The task is the durable work item; giving it its own instant
      // bell + email created three alerts for one reply in the live QA.
      reminder_schedule: "none",
      reminder_at: null,
      reminder_channels: [],
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
  // Durable suppression record FIRST, unconditionally — a bounced address is
  // a bad address for every future campaign, not just this enrollment, and
  // recording it must not depend on winning the status transition below
  // (a bounce observed after a reply/stop still marks the address). Reason
  // 'bounced' stays overridable at launch, unlike 'unsubscribed' — see
  // NON_OVERRIDABLE_SUPPRESSION_REASONS in playbook-smartlead/index.ts.
  await recordMarketingOptout(svc, {
    email: enrollment.email,
    reason: "bounced",
    source: eventMeta?.source ?? "webhook",
    campaignId: campaignId ?? null,
    enrollmentId: enrollment.id,
    firstName: enrollment.first_name,
    lastName: enrollment.last_name,
    company: enrollment.company ?? null,
  });

  // Same atomic-transition guard as stopEnrollmentForReply above — see its
  // comment for why a stale-snapshot check isn't safe against a concurrent
  // webhook + daily-sweep call for the same bounce.
  const { data: transitioned, error } = await svc
    .from("campaign_enrollments")
    .update({ status: "bounced", bounced_at: new Date().toISOString() })
    .eq("id", enrollment.id)
    .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`)
    .select("id");
  if (error) {
    console.error("campaign-enrollment-actions: bounce status update failed:", error.message);
    return { updated: false, tasksCancelled: 0 };
  }
  if (!transitioned?.length) return { updated: false, tasksCancelled: 0 };

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

/**
 * React to an unsubscribe (outside-review fix 2, 2026-07-28): record the
 * opt-out durably, flag the linked contact, log the event trail, and — only
 * if the enrollment is still live — stop it and archive its pending tasks.
 * One implementation, two callers: campaign-webhooks' LEAD_UNSUBSCRIBED
 * handler and the daily sweep's per-lead reconcile, same split as
 * reply/bounce.
 *
 * ORDER MATTERS, and it is the opposite of the old webhook-local handler:
 * every opt-out side effect runs UNCONDITIONALLY, before the status guard.
 * The old code early-returned when the enrollment was already terminal —
 * which silently discarded the most common real-world ordering ("take me
 * off your list" arrives as a REPLY first, flipping status to 'replied';
 * the LEAD_UNSUBSCRIBED webhook lands seconds later into a closed door), as
 * well as any unsubscribe after a stop/completion. Every side effect here
 * is idempotent, so webhook replays and webhook+sweep double-delivery stay
 * safe without the early return.
 *
 * The status transition itself stays guarded and atomic (same compare-and-
 * set as reply/bounce): an unsubscribe after a reply keeps the more
 * informative 'replied' status — the opt-out is already recorded above
 * either way — and can never regress a terminal status.
 */
export async function stopEnrollmentForUnsubscribe(
  svc: DbClient,
  enrollment: EnrollmentForActions,
  campaignId: string,
  eventMeta?: { occurredAt?: string | null; source?: string },
): Promise<{ updated: boolean; tasksCancelled: number }> {
  // 1. Durable, email-keyed opt-out — the fix for CSV/paste recipients
  //    (contact_id NULL) and for post-terminal unsubscribes alike. Reason
  //    'unsubscribed' is non-overridable at launch (a legal signal, not a
  //    business preference).
  await recordMarketingOptout(svc, {
    email: enrollment.email,
    reason: "unsubscribed",
    source: eventMeta?.source ?? "webhook",
    campaignId,
    enrollmentId: enrollment.id,
    firstName: enrollment.first_name,
    lastName: enrollment.last_name,
    company: enrollment.company ?? null,
  });

  // 2. First unsubscribed_at wins (idempotent — replays can't move it).
  const { error: tsErr } = await svc
    .from("campaign_enrollments")
    .update({ unsubscribed_at: eventMeta?.occurredAt ?? new Date().toISOString() })
    .eq("id", enrollment.id)
    .is("unsubscribed_at", null);
  if (tsErr) console.error("campaign-enrollment-actions: unsubscribed_at stamp failed:", tsErr.message);

  // 3. Contact-level flag, when the enrollment is linked to a contact.
  if (enrollment.contact_id) {
    const { error: contactErr } = await svc
      .from("contacts")
      .update({ do_not_contact: true })
      .eq("id", enrollment.contact_id);
    if (contactErr) console.error("campaign-enrollment-actions: do_not_contact flag failed:", contactErr.message);
  }

  // 4. Event trail — a no-op on the webhook path (its own generic event
  //    insert, logged before dispatch, dedupes this), the ONLY record on
  //    the sweep path (same pattern as reply/bounce).
  await recordEventIfMissing(svc, {
    enrollmentId: enrollment.id,
    campaignId,
    email: enrollment.email,
    eventType: "LEAD_UNSUBSCRIBED",
    dedupeTypes: UNSUBSCRIBE_EVENT_TYPES,
    occurredAt: eventMeta?.occurredAt,
    payload: eventMeta?.source ? { source: eventMeta.source } : {},
  });

  // 5. Status transition — atomic, only from a still-live status.
  const { data: transitioned, error } = await svc
    .from("campaign_enrollments")
    .update({ status: "stopped", paused_reason: "unsubscribed" })
    .eq("id", enrollment.id)
    .not("status", "in", `(${ENROLLMENT_TERMINAL_STATUSES.join(",")})`)
    .select("id");
  if (error) {
    console.error("campaign-enrollment-actions: unsubscribe status update failed:", error.message);
    return { updated: false, tasksCancelled: 0 };
  }
  const updated = !!transitioned?.length;

  // 6. Archive pending SEQUENCE tasks — only when THIS call actually ended
  //    the enrollment. Deliberately NOT unconditional (adversarial review):
  //    when a reply already ended it, stopEnrollmentForReply archived the
  //    sequence tasks and then created the high-priority "Reply from X"
  //    follow-up — which is itself is_campaign_generated and pending, so an
  //    unconditional archive here would silently delete the rep's follow-up
  //    on exactly the "reply says unsubscribe me" ordering. Every other
  //    terminal transition (bounce/stop/complete) already archived its own
  //    pending tasks, so gating on the transition loses nothing.
  const tasksCancelled = updated
    ? await archivePendingTasksForEnrollment(svc, enrollment.id, "Unsubscribed")
    : 0;
  return { updated, tasksCancelled };
}
