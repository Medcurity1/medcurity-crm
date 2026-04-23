-- Task reminders + one-way Outlook calendar sync.
--
-- Tasks get a reminder schedule so the system automatically nudges the
-- owner (in-app notification + optional email) before the due time.
-- Tasks with a due_at also sync to the owner's Outlook calendar as an
-- event so reps see CRM work alongside their normal calendar. The sync
-- is one-way (CRM -> Outlook); edits in Outlook don't reflect back.
--
-- The Edge Functions that drive this are in supabase/functions/
-- (task-reminders, outlook-calendar-sync). They stay dormant until the
-- Azure App Registration grants Mail.Send + Calendars.ReadWrite. See
-- docs/migration/azure-permissions-handoff.md.

begin;

-- ---------------------------------------------------------------------
-- Reminder scheduling on activities (all reminder-capable rows are tasks,
-- but keeping it on the activities table keeps the data model simple).
-- ---------------------------------------------------------------------

-- Schedule variants we support initially. Easy to extend later.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'reminder_schedule') then
    create type public.reminder_schedule as enum (
      'none',
      'once',          -- fire exactly at reminder_at (single shot)
      'daily',         -- fire daily at reminder_at's time-of-day until due
      'weekdays',      -- Mon-Fri at reminder_at's time-of-day until due
      'weekly'         -- same day-of-week as reminder_at, weekly until due
    );
  end if;
end $$;

-- Channels a reminder can fire on.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'reminder_channel') then
    create type public.reminder_channel as enum ('in_app', 'email');
  end if;
end $$;

alter table public.activities
  add column if not exists reminder_schedule public.reminder_schedule
    not null default 'none',
  add column if not exists reminder_at timestamptz,
  add column if not exists reminder_channels public.reminder_channel[]
    not null default array['in_app']::public.reminder_channel[],
  add column if not exists last_reminder_sent_at timestamptz,
  -- Outlook event id stamped by outlook-calendar-sync after it pushes a
  -- task to the user's calendar. Lets the function re-find the event on
  -- updates + deletes without storing ACLs server-side.
  add column if not exists outlook_event_id text,
  add column if not exists outlook_sync_error text,
  add column if not exists outlook_synced_at timestamptz;

comment on column public.activities.reminder_schedule is
  'none / once / daily / weekdays / weekly. Tasks with reminder_schedule != none fire notifications + optional email via the task-reminders Edge Function.';
comment on column public.activities.reminder_at is
  'Next time a reminder should fire. For non-once schedules, the function bumps this after sending. Null when reminder_schedule = none.';
comment on column public.activities.reminder_channels is
  'Which channels to deliver the reminder on. in_app is always available; email requires the user has an Outlook connection + Mail.Send permission.';
comment on column public.activities.last_reminder_sent_at is
  'When the most recent reminder was sent (any channel). Used by the scheduler to detect completed / skipped runs.';
comment on column public.activities.outlook_event_id is
  'Microsoft Graph event id for the Outlook-calendar copy of this task. Null until outlook-calendar-sync has pushed it (or when the user has no connection).';
comment on column public.activities.outlook_sync_error is
  'Last error message from outlook-calendar-sync for this row. Null on success.';
comment on column public.activities.outlook_synced_at is
  'Last time outlook-calendar-sync successfully pushed this task to the user''s calendar.';

-- Indexes the schedulers need. Partial so we only pay storage on active
-- rows.
create index if not exists idx_activities_reminder_due
  on public.activities (reminder_at)
  where reminder_schedule <> 'none' and completed_at is null and archived_at is null;

create index if not exists idx_activities_needs_outlook_sync
  on public.activities (owner_user_id, due_at)
  where due_at is not null and completed_at is null and archived_at is null;

-- ---------------------------------------------------------------------
-- In-app notifications already live in public.notifications (created in
-- an earlier migration). We don't need any schema change there — the
-- task-reminders function just inserts rows.
-- ---------------------------------------------------------------------

commit;
