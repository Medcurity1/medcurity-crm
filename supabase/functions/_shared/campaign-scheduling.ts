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
 * Snap a "YYYY-MM-DD" date FORWARD to the next allowed send day (inclusive —
 * a date that's already allowed comes back unchanged). Used by taskDueAt so
 * a non-email step's due date never lands outside the campaign's send days
 * (default Mon-Fri) — e.g. a Day-12 LinkedIn task computed from a Tuesday
 * launch used to land on a Sunday; it now rolls forward to the following
 * Monday. Guarded at 14 days out (two full weeks) so a pathological empty
 * `sendDays` can't loop forever; falls back to the unsnapped date if the
 * guard trips (should never happen with a real, non-empty sendDays set).
 */
export function snapToWeekday(dateISO: string, sendDays: number[] = DEFAULT_SEND_DAYS): string {
  const allowed = new Set(sendDays && sendDays.length ? sendDays : DEFAULT_SEND_DAYS);
  let d = parseDateOnlyUTC(dateISO);
  let guard = 0;
  while (!allowed.has(d.getUTCDay()) && guard < 14) {
    d = addUTCDays(d, 1);
    guard++;
  }
  return toDateOnlyISO(d);
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

// Exact America/Los_Angeles UTC offset (docket E5 — replaces a month-bucket
// approximation that used to live here). US DST flips at 2am local on the
// SECOND SUNDAY of March (spring forward, PST -> PDT) and the FIRST SUNDAY
// of November (fall back, PDT -> PST) — not on a calendar-month boundary.
// The old `monthIndex0 >= 2 && monthIndex0 <= 10 ? 7 : 8` rule treated all
// of March as PDT and all of November as PDT-until-the-30th, so a task's
// due TIME (never the due DATE — this never shifted a task by a whole
// calendar day) was off by an hour for the ~1-week gap between the true
// transition and the nearest month boundary, twice a year.
//
// Returns the conventional signed UTC offset in hours (-7 for PDT, -8 for
// PST — how people actually say "Pacific is UTC-7/-8") as of the given
// instant. Technique: format the instant's wall-clock reading in the
// target zone, reinterpret those same numbers as if they were UTC, and diff
// against the real instant — the gap IS the offset. This only touches
// Intl.DateTimeFormat, an ICU-backed JS engine built-in (not a Deno-only
// API), so it behaves identically under Deno (the edge function) and Node
// (vitest) — same reasoning as the rest of this file's "no environment-
// specific APIs" rule.
export function ptUtcOffsetHours(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const wallClockReadAsUtcMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((wallClockReadAsUtcMs - instant.getTime()) / 3_600_000);
}

/**
 * The ISO timestamp for a task due on `relativeOffsetDays` days after
 * `firstSendISO`'s calendar date, at `sendWindowStart` (default "09:00")
 * America/Los_Angeles clock time (exact DST-aware conversion — see
 * ptUtcOffsetHours above). The resulting calendar date is then snapped
 * FORWARD to the next allowed
 * `sendDays` weekday (default Mon-Fri) — a non-email step (CALL/LINKEDIN/
 * EMAIL_HYBRID) must never get a task due on a day nobody's expected to be
 * working the campaign (e.g. a Day-12 LinkedIn task from a Tuesday launch
 * landing on a Sunday).
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
  sendDays: number[] = DEFAULT_SEND_DAYS,
): string {
  const base = parseDateOnlyUTC(firstSendISO);
  const unsnapped = addUTCDays(base, relativeOffsetDays);
  const target = parseDateOnlyUTC(snapToWeekday(toDateOnlyISO(unsnapped), sendDays));

  const [hhRaw, mmRaw] = (sendWindowStart || "09:00").split(":");
  const hh = parseInt(hhRaw, 10);
  const mm = parseInt(mmRaw, 10);
  const hours = Number.isFinite(hh) ? hh : 9;
  const minutes = Number.isFinite(mm) ? mm : 0;

  // Resolve "target's calendar date at hours:minutes America/Los_Angeles
  // clock time" to a UTC instant. The exact offset to use depends on the
  // instant itself (chicken-and-egg right around a DST transition), so this
  // is the standard guess-then-refine: treat the wall-clock numbers as if
  // they were already UTC to get a same-day proxy instant, look up the
  // exact PT offset AS OF that proxy, apply it, then re-check the offset at
  // the corrected instant in case the proxy landed on the wrong side of a
  // transition (only possible on the literal transition day itself — e.g.
  // a 9am request on spring-forward day naively proxies to a PRE-transition
  // instant, which would resolve PST, when 9am local that day is actually
  // already PDT). A third pass is never needed: this zone only has two
  // possible offsets, so the second check either confirms the first guess
  // or flips it once, and re-deriving with that confirmed offset is final.
  const naiveMs = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
    hours,
    minutes,
    0,
    0,
  );
  const offsetGuess = ptUtcOffsetHours(new Date(naiveMs));
  let utcMs = naiveMs - offsetGuess * 3_600_000;
  const offsetConfirmed = ptUtcOffsetHours(new Date(utcMs));
  if (offsetConfirmed !== offsetGuess) {
    utcMs = naiveMs - offsetConfirmed * 3_600_000;
  }
  // Date.UTC (inside the two computations above) correctly rolls over into
  // the next UTC calendar day when hours-offset lands outside 0-23 (e.g. a
  // 9pm PT window in winter is 05:00 UTC the next day) — that rollover is
  // exactly right, not a bug to guard against.
  return new Date(utcMs).toISOString();
}
