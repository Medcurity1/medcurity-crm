// Shared campaign-task date-shift helpers (Campaigns overhaul Phase 2, S6).
//
// Extracted from campaign-webhooks/index.ts's EMAIL_SENT handler (S5) so the
// daily-sweep per-lead reconcile (playbook-smartlead/index.ts, S6) applies
// the EXACT same "actual send date differs from what we scheduled around ->
// shift this enrollment's still-pending CALL/LINKEDIN/EMAIL_HYBRID tasks by
// the day delta" behavior, instead of a third hand-kept copy drifting out of
// sync with the original. Pure move — no behavior change versus the S5
// original beyond the log-message prefix (was "campaign-webhooks: ...", now
// "campaign-task-shift: ..." since this file is shared by two functions).
//
// `svc` is typed loosely (same DbClient convention as _shared/graph-token.ts)
// so this works with either edge function's own service-role client
// instance — each Deno function creates its own `svc = createClient(...)`;
// nothing here creates a client of its own.

import { snapToWeekday } from "./campaign-scheduling.ts";

// deno-lint-ignore no-explicit-any
type DbClient = any;

// Mirrors campaign-scheduling.ts's own DEFAULT_SEND_DAYS (Mon-Fri, not
// exported from there) — the send-day set taskDueAt snaps a freshly-computed
// due date to when a caller doesn't pass a per-campaign schedule. Threading
// the real per-campaign `settings.schedule.days_of_week` through both
// shiftEnrollmentTasks callers (campaign-webhooks/index.ts's EMAIL_SENT
// handler and playbook-smartlead/index.ts's daily-sweep reconcile) would
// mean loading the campaign row at both call sites just for this; Mon-Fri is
// the system default AND what taskDueAt itself falls back to when
// unspecified, so re-snapping a shift against the same default is correct
// for the common case and no worse than the original schedule for the rare
// custom-send-days campaign.
const DEFAULT_SEND_DAYS = [1, 2, 3, 4, 5];

/** First 10 chars ("YYYY-MM-DD") of an ISO timestamp or bare date string. */
export function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Whole-day delta between two "YYYY-MM-DD"-prefixed strings (b - a). */
export function daysBetweenDateOnly(aISO: string, bISO: string): number {
  const a = Date.parse(`${dateOnly(aISO)}T00:00:00Z`);
  const b = Date.parse(`${dateOnly(bISO)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function addDaysToIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/**
 * Add `days` whole days to an ISO timestamp, then snap the resulting DATE
 * forward to the next allowed send weekday (default Mon-Fri — see
 * DEFAULT_SEND_DAYS above), preserving the original time-of-day exactly.
 *
 * A raw day-delta shift (addDaysToIso alone) can land a task on a Saturday
 * or Sunday — e.g. a task originally due Thursday, shifted +3 days because
 * the actual send landed 3 days late, lands on Sunday with no re-snap. That
 * reintroduces the exact weekend-landing bug taskDueAt's own snapToWeekday
 * call (campaign-scheduling.ts) already prevents for the INITIAL schedule;
 * this re-applies the same snap after a shift so the guarantee holds for the
 * task's full lifetime, not just its first computation.
 */
export function shiftAndSnapIso(iso: string, days: number): string {
  const shifted = addDaysToIso(iso, days);
  const datePart = shifted.slice(0, 10); // "YYYY-MM-DD"
  const timePart = shifted.slice(10); // "THH:MM:SS.sssZ" — time-of-day, untouched
  const snappedDate = snapToWeekday(datePart, DEFAULT_SEND_DAYS);
  return `${snappedDate}${timePart}`;
}

/**
 * Shift every still-pending campaign-generated task's due_at/reminder_at for
 * one enrollment by `days` whole days — used when the actual send date
 * (learned from a Smartlead webhook OR the daily sweep's per-lead reconcile
 * against Smartlead's statistics endpoint) differs from the date originally
 * scheduled around. A small per-enrollment task set (a handful of
 * CALL/LINKEDIN/EMAIL_HYBRID rows at most), so sequential per-row updates are
 * fine — no batching needed. Each shifted date is re-snapped forward to the
 * next allowed send weekday (shiftAndSnapIso above) so a shift can never
 * land a task on a weekend.
 */
export async function shiftEnrollmentTasks(svc: DbClient, enrollmentId: string, days: number): Promise<void> {
  if (!days) return;
  const { data: tasks, error } = await svc
    .from("activities")
    .select("id, due_at, reminder_at")
    .eq("campaign_enrollment_id", enrollmentId)
    .eq("is_campaign_generated", true)
    .is("completed_at", null)
    .is("archived_at", null);
  if (error) {
    console.error("campaign-task-shift: task lookup for re-date failed:", error.message);
    return;
  }
  for (const t of (tasks ?? []) as { id: string; due_at: string | null; reminder_at: string | null }[]) {
    const updates: Record<string, unknown> = {};
    if (t.due_at) updates.due_at = shiftAndSnapIso(t.due_at, days);
    if (t.reminder_at) updates.reminder_at = shiftAndSnapIso(t.reminder_at, days);
    if (Object.keys(updates).length) {
      const { error: updErr } = await svc.from("activities").update(updates).eq("id", t.id);
      if (updErr) console.error("campaign-task-shift: task re-date failed for", t.id, updErr.message);
    }
  }
}
