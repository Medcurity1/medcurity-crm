// Campaign scheduling math (Campaigns overhaul, slice S3) — PURE,
// dependency-free date/throttle arithmetic shared by the launch action
// (playbook-smartlead/index.ts) and its test suite
// (tests/campaignScheduling.test.ts imports this file directly).
//
// Deliberately has NO Deno imports, NO supabase imports, and no `new
// Date()`/`Date.now()` — every function's output depends only on its
// arguments, so it runs identically under Deno (the edge function) and
// Node/vitest (the test suite), and is trivial to unit test. Callers that
// need "today" compute it themselves and pass it in.
//
// All date-only arithmetic is done via Date.UTC(...)/getUTC*() rather than
// the local Date constructor/getters — that keeps "add N days to a calendar
// date" immune to both the host's local timezone AND local-timezone DST
// jumps (which can silently skip or repeat a calendar day if you increment
// via setDate() in local time). We only ever care about calendar dates here,
// never a specific instant, until taskDueAt's final step.

/** The subset of a SequenceStep (src/features/playbook/types.ts) this module
 *  needs. Deno can't import across the "@/" alias into src/, so this is a
 *  structurally-compatible local mirror — pass a real SequenceStep straight
 *  through, no cast needed, as long as it's a superset of this shape. */
export interface SchedulingStep {
  order: number;
  day_offset: number;
  channel: "EMAIL_AUTO" | "EMAIL_HYBRID" | "CALL" | "LINKEDIN";
  send_window_start?: string;
  subject_template?: string;
  body_template?: string;
}

export interface SmartleadSequenceEmail {
  seq_number: number;
  delay_days: number;
  subject: string;
  body_html: string;
}

// Smartlead's `days_of_the_week` schedule field uses the same convention as
// JS's Date#getUTCDay()/getDay(): 0=Sun, 1=Mon, ..., 6=Sat. The existing
// launch() default of [1,2,3,4,5] is Mon-Fri under that convention (see
// docs/campaigns/buildout-plan.md:105) — we reuse it verbatim as our default
// too, so a caller that doesn't pass `sendDays` gets the same weekdays
// Smartlead itself is configured to send on by default.
const DEFAULT_SEND_DAYS = [1, 2, 3, 4, 5];

function parseDateOnlyUTC(dateISO: string): Date {
  // Accepts a bare "YYYY-MM-DD" or the date-prefix of a full ISO timestamp
  // (e.g. what Postgres returns for a timestamptz column) — only the first
  // 10 characters are ever read.
  const [y, m, d] = dateISO.slice(0, 10).split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

function addUTCDays(d: Date, days: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + days));
}

function toDateOnlyISO(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Per-lead throttle math: cohort k (0-based; positions k*leadsPerDay+1
 * through (k+1)*leadsPerDay) starts on the (k+1)-th SEND day counting from
 * the anchor (the anchor itself counts when it's an allowed day). This
 * mirrors how Smartlead actually consumes the throttle — it pulls up to
 * max_new_leads_per_day NEW leads per send day, and a weekend between
 * cohorts consumes no send capacity. (Counting calendar days and snapping
 * forward would collapse two weekend cohorts onto the same Monday — a
 * 75-person Friday launch at 25/day is Fri/Mon/Tue, NOT Fri/Mon/Mon.)
 *
 * Returns one "YYYY-MM-DD" string per position, in position order (index 0
 * = enroll_position 1).
 */
export function computeFirstSendDates(
  n: number,
  anchorDateISO: string,
  leadsPerDay: number,
  sendDays: number[] = DEFAULT_SEND_DAYS,
): string[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  const perDay = Math.max(1, Math.floor(leadsPerDay) || 1);
  const allowed = new Set(sendDays && sendDays.length ? sendDays : DEFAULT_SEND_DAYS);

  // The first ceil(n/perDay) send days on/after the anchor. Guarded against
  // a pathological `sendDays` (e.g. empty effective set) — real callers
  // always pass at least one weekday; if the guard ever trips, fall back to
  // plain consecutive calendar days rather than looping forever.
  const cohorts = Math.ceil(n / perDay);
  const sendDayList: string[] = [];
  let d = parseDateOnlyUTC(anchorDateISO);
  let guard = 0;
  while (sendDayList.length < cohorts && guard < cohorts * 7 + 14) {
    if (allowed.has(d.getUTCDay())) sendDayList.push(toDateOnlyISO(d));
    d = addUTCDays(d, 1);
    guard++;
  }
  while (sendDayList.length < cohorts) {
    const anchor = parseDateOnlyUTC(anchorDateISO);
    sendDayList.push(toDateOnlyISO(addUTCDays(anchor, sendDayList.length)));
  }

  const out: string[] = [];
  for (let pos = 1; pos <= n; pos++) {
    out.push(sendDayList[Math.floor((pos - 1) / perDay)]);
  }
  return out;
}

/**
 * Every step's offset relative to "this person's day zero" — the day their
 * first automated email goes out. Baseline = the smallest day_offset among
 * EMAIL_AUTO steps; if a template has no EMAIL_AUTO steps at all (unusual
 * but not disallowed — e.g. a call-only sequence), baseline falls back to
 * the smallest day_offset overall so every step still gets a non-negative
 * relative offset for whichever step ends up "first".
 *
 * Keyed by step.order (steps are expected to have unique order values, as
 * campaign_templates.steps and campaigns.steps always do — see
 * useSaveTemplate in src/features/playbook/api.ts, which renumbers on save).
 */
export function relativeStepOffsets(steps: SchedulingStep[]): Map<number, number> {
  const out = new Map<number, number>();
  if (!steps.length) return out;
  const emailAutoOffsets = steps.filter((s) => s.channel === "EMAIL_AUTO").map((s) => s.day_offset);
  const baseline = emailAutoOffsets.length
    ? Math.min(...emailAutoOffsets)
    : Math.min(...steps.map((s) => s.day_offset));
  for (const s of steps) out.set(s.order, s.day_offset - baseline);
  return out;
}

/**
 * EMAIL_AUTO steps (only), sorted by day_offset, converted into the flat
 * seq_number/delay_days shape Smartlead's /sequences endpoint expects.
 * delay_days is the gap from the PREVIOUS email in this list (0 for the
 * first). Non-EMAIL_AUTO steps (CALL/LINKEDIN/EMAIL_HYBRID) never appear
 * here — those become tasks, not Smartlead sequence entries.
 */
export function emailStepsToSmartleadSequence(steps: SchedulingStep[]): SmartleadSequenceEmail[] {
  const emailSteps = [...steps]
    .filter((s) => s.channel === "EMAIL_AUTO")
    .sort((a, b) => a.day_offset - b.day_offset);
  let prevOffset: number | null = null;
  return emailSteps.map((s, i) => {
    const delay = prevOffset === null ? 0 : Math.max(0, s.day_offset - prevOffset);
    prevOffset = s.day_offset;
    return {
      seq_number: i + 1,
      delay_days: delay,
      subject: s.subject_template ?? "",
      body_html: s.body_template ?? "",
    };
  });
}

// Very small, dependency-free Pacific-time offset approximation: US DST
// (PDT, UTC-7) runs roughly early March -> early November; PST (UTC-8)
// covers the rest. This is only used to place a TASK's due time (not a
// legal deadline or an actual send time — Smartlead handles real email send
// timing itself), so a month-based approximation is adequate: worst case a
// task's due time is off by an hour during the ~1-2 week window around a
// DST transition, and it is NEVER off by a whole calendar day.
function ptUtcOffsetHours(monthIndex0: number): number {
  return monthIndex0 >= 2 && monthIndex0 <= 10 ? 7 : 8; // Mar(2)..Nov(10) => PDT, else PST
}

/**
 * The ISO timestamp for a task due on `relativeOffsetDays` days after
 * `firstSendISO`'s calendar date, at `sendWindowStart` (default "09:00")
 * America/Los_Angeles clock time (see the DST-approximation note above).
 *
 * `firstSendISO` accepts either a bare "YYYY-MM-DD" (what
 * computeFirstSendDates returns) or a full ISO timestamp (what reading
 * campaign_enrollments.first_send_at back from Postgres returns) — only the
 * date portion is used.
 */
export function taskDueAt(
  firstSendISO: string,
  relativeOffsetDays: number,
  sendWindowStart = "09:00",
): string {
  const base = parseDateOnlyUTC(firstSendISO);
  const target = addUTCDays(base, relativeOffsetDays);

  const [hhRaw, mmRaw] = (sendWindowStart || "09:00").split(":");
  const hh = parseInt(hhRaw, 10);
  const mm = parseInt(mmRaw, 10);
  const hours = Number.isFinite(hh) ? hh : 9;
  const minutes = Number.isFinite(mm) ? mm : 0;

  const offset = ptUtcOffsetHours(target.getUTCMonth());
  // Date.UTC correctly rolls over into the next UTC calendar day when
  // hours+offset >= 24 (e.g. a 9pm PT window in winter is 05:00 UTC the
  // next day) — that rollover is exactly right, not a bug to guard against.
  const utcMs = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
    hours + offset,
    minutes,
    0,
    0,
  );
  return new Date(utcMs).toISOString();
}
