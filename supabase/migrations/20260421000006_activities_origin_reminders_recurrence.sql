-- ============================================================
-- Activities: Activity origin + reminders + full recurrence detail
-- ----------------------------------------------------------------
-- Round 2 of SF Task/Event field preservation. The previous
-- migration (20260421000005) covered audit + call detail + the
-- top-level recurrence flags. This one fills in the rest:
--
--   - Activity origin metadata (was the row created by a user
--     manually, by an Outlook sync, by ListEmail send, etc.)
--   - Reminder fields (when the user wanted to be pinged + flag)
--   - Full recurrence detail (the bit-mask schedule fields needed
--     to reconstruct an SF recurring task elsewhere if ever needed)
--   - Pointer to original SF EmailMessage for traceability when
--     email-type Tasks are imported
--
-- Notes already exists for `reminder_at` etc. on activities (added
-- in 20260417000007) but those are the CRM's NEW reminder system.
-- The SF originals stamp into separate sf_* columns so we don't
-- accidentally trigger our own reminder pipeline off imported data.
-- ============================================================

alter table public.activities
  add column if not exists activity_origin_type text,
  add column if not exists sf_email_message_id text,
  add column if not exists sf_reminder_datetime timestamptz,
  add column if not exists sf_is_reminder_set boolean,
  -- Recurrence detail — only meaningful when is_recurrence = true.
  add column if not exists recurrence_start_date date,
  add column if not exists recurrence_end_date date,
  add column if not exists recurrence_timezone text,
  -- SF stores DayOfWeekMask as an integer bitmask (1=Sun, 2=Mon, …, 64=Sat)
  add column if not exists recurrence_day_of_week_mask integer
    check (recurrence_day_of_week_mask is null
           or (recurrence_day_of_week_mask >= 0 and recurrence_day_of_week_mask <= 127)),
  add column if not exists recurrence_day_of_month integer
    check (recurrence_day_of_month is null
           or (recurrence_day_of_month between 1 and 31)),
  add column if not exists recurrence_month_of_year integer
    check (recurrence_month_of_year is null
           or (recurrence_month_of_year between 1 and 12)),
  add column if not exists recurrence_instance text,
  add column if not exists sf_recurrence_activity_id text;

comment on column public.activities.activity_origin_type is
  'How the SF Task/Event was originally created (Manual, Outlook, ListEmail, etc.). From SF ActivityOriginType.';
comment on column public.activities.sf_email_message_id is
  'For SF Task.Type=Email: pointer to the SF EmailMessage record. Lets us match imported tasks back to the email if needed for audit / Outlook-sync dedup.';
comment on column public.activities.sf_reminder_datetime is
  'Timestamp the rep wanted to be reminded. Stamped from SF ReminderDateTime — kept separate from CRM reminder_at so we don''t trigger our own reminder pipeline off imported data.';
comment on column public.activities.sf_is_reminder_set is
  'Was a reminder configured in SF (independent of whether it actually fired).';
comment on column public.activities.recurrence_day_of_week_mask is
  'Bitmask of weekdays the recurrence fires (1=Sun … 64=Sat). E.g. 62 = Mon-Fri.';
comment on column public.activities.recurrence_instance is
  'For monthly-by-instance recurrences: First / Second / Third / Fourth / Last.';
comment on column public.activities.sf_recurrence_activity_id is
  'Parent SF activity id when this row is a child of a recurring series. Lets the series be reconstructed.';
