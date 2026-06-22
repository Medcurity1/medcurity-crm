-- ============================================================
-- Task recurrence engine (V2-A3)
-- ----------------------------------------------------------------
-- Adds a LIVE recurrence model for tasks: daily / every-N-days /
-- weekly-by-weekday / monthly-by-date. The next occurrence is spawned
-- when the current one is COMPLETED (the Todoist model) via an AFTER
-- UPDATE trigger; a thin idempotent daily pg_cron sweep is insurance for
-- any series whose successor got orphaned.
--
-- NOTE: this deliberately uses NEW columns (recur_*), NOT the inert
-- recurrence_* columns from 20260421000005/06 — those are SF-import
-- preservation metadata and are not wired to any engine.
-- ============================================================

begin;

-- 1. Recurrence frequency enum ----------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_recurrence_freq') then
    create type public.task_recurrence_freq as enum ('daily', 'weekly', 'monthly');
  end if;
end $$;

-- 2. Columns on activities --------------------------------------------
alter table public.activities
  add column if not exists recur_freq public.task_recurrence_freq,
  add column if not exists recur_interval integer not null default 1,
  add column if not exists recur_weekday integer,
  add column if not exists recur_monthday integer,
  add column if not exists recur_until date,
  add column if not exists recurrence_parent_id uuid references public.activities(id) on delete set null;

-- Guard rails (added separately so re-runs don't choke on existing constraints)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'activities_recur_interval_chk') then
    alter table public.activities
      add constraint activities_recur_interval_chk check (recur_interval >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_recur_weekday_chk') then
    alter table public.activities
      add constraint activities_recur_weekday_chk
      check (recur_weekday is null or (recur_weekday between 0 and 6));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'activities_recur_monthday_chk') then
    alter table public.activities
      add constraint activities_recur_monthday_chk
      check (recur_monthday is null or (recur_monthday between 1 and 31));
  end if;
end $$;

comment on column public.activities.recur_freq is
  'Live recurrence cadence for tasks: daily / weekly / monthly. NULL = not recurring. (Distinct from the inert SF-import recurrence_* columns.)';
comment on column public.activities.recur_interval is
  'Every N units of recur_freq. 1 = every day/week/month, 2 = every other, etc.';
comment on column public.activities.recur_weekday is
  'Weekly cadence: day of week 0=Sun … 6=Sat. The due date already lands on this day, so it is mostly for display.';
comment on column public.activities.recur_monthday is
  'Monthly cadence: day of month 1-31. Pinned each cycle (clamped to month length) so a "31st" series does not drift to the 28th after February.';
comment on column public.activities.recurrence_parent_id is
  'Root task of a recurring series. All spawned occurrences point at the original so the series can be tracked + de-duplicated.';

create index if not exists idx_activities_recurrence_parent
  on public.activities (recurrence_parent_id)
  where recurrence_parent_id is not null;

-- 3. Pure next-occurrence helper --------------------------------------
-- No now()/random — depends only on inputs (and the timezone GUC), so it
-- is safe to call from both the trigger and the daily sweep.
create or replace function public.next_task_due(
  p_due timestamptz,
  p_freq public.task_recurrence_freq,
  p_interval integer,
  p_weekday integer,
  p_monthday integer
) returns timestamptz
language plpgsql
stable
as $$
declare
  v_interval integer := greatest(coalesce(p_interval, 1), 1);
  v_target_month timestamptz;
  v_days_in_month integer;
  v_day integer;
begin
  if p_freq = 'daily' then
    return p_due + (v_interval || ' days')::interval;
  elsif p_freq = 'weekly' then
    -- The due date already falls on the chosen weekday, so N*7 days
    -- preserves it without any weekday snapping.
    return p_due + ((v_interval * 7) || ' days')::interval;
  elsif p_freq = 'monthly' then
    -- Pin to the configured day-of-month in the target month (clamped to
    -- that month's length), preserving the original time-of-day.
    v_target_month := date_trunc('month', p_due) + (v_interval || ' months')::interval;
    v_days_in_month := extract(day from (v_target_month + interval '1 month' - interval '1 day'))::int;
    v_day := least(coalesce(p_monthday, extract(day from p_due)::int), v_days_in_month);
    return v_target_month
           + ((v_day - 1) || ' days')::interval
           + (p_due - date_trunc('day', p_due));
  end if;
  return null;
end;
$$;

-- 4. Spawn-on-complete trigger ----------------------------------------
create or replace function public.fn_spawn_recurring_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_root uuid;
  v_base timestamptz;
  v_next timestamptz;
begin
  -- Only when a recurring TASK transitions open -> completed.
  if new.activity_type <> 'task' then return new; end if;
  if new.recur_freq is null then return new; end if;
  if not (old.completed_at is null and new.completed_at is not null) then
    return new;
  end if;

  v_root := coalesce(new.recurrence_parent_id, new.id);

  -- Don't spawn when this isn't the frontier of the series:
  --   (a) an open, non-archived successor already exists (idempotency —
  --       covers reopen+recomplete + double trigger fires), or
  --   (b) a strictly later-due sibling exists at all (archived included) —
  --       which means a successor was already spawned and then deleted
  --       (archived), i.e. the user STOPPED the series. Completing an older
  --       reopened instance must not resurrect it. Mirrors the daily sweep.
  if exists (
    select 1 from public.activities sib
    where sib.recurrence_parent_id = v_root
      and sib.id <> new.id
      and (
        (sib.completed_at is null and sib.archived_at is null)
        or (new.due_at is not null and sib.due_at is not null
            and sib.due_at > new.due_at)
      )
  ) then
    return new;
  end if;

  v_base := coalesce(new.due_at, new.completed_at, now());
  v_next := public.next_task_due(
    v_base, new.recur_freq, new.recur_interval, new.recur_weekday, new.recur_monthday
  );
  if v_next is null then return new; end if;

  -- Respect the series end date.
  if new.recur_until is not null and v_next::date > new.recur_until then
    return new;
  end if;

  insert into public.activities (
    account_id, contact_id, opportunity_id, lead_id, owner_user_id,
    activity_type, subject, body, due_at, priority,
    reminder_schedule, reminder_at, reminder_channels,
    recur_freq, recur_interval, recur_weekday, recur_monthday, recur_until,
    recurrence_parent_id
  ) values (
    new.account_id, new.contact_id, new.opportunity_id, new.lead_id, new.owner_user_id,
    'task', new.subject, new.body, v_next, new.priority,
    new.reminder_schedule,
    -- Preserve the user's reminder lead time (e.g. "remind a day before")
    -- by carrying the original reminder_at -> due_at offset onto the new
    -- occurrence, instead of collapsing the reminder to the due moment.
    case when new.reminder_schedule = 'none' then null
         when new.reminder_at is null or new.due_at is null then v_next
         else v_next + (new.reminder_at - new.due_at) end,
    new.reminder_channels,
    new.recur_freq, new.recur_interval, new.recur_weekday, new.recur_monthday, new.recur_until,
    v_root
  );

  return new;
end;
$$;

drop trigger if exists trg_spawn_recurring_task on public.activities;
create trigger trg_spawn_recurring_task
after update on public.activities
for each row
execute function public.fn_spawn_recurring_task();

-- 5. Daily backstop sweep (insurance only) ----------------------------
-- For each recurring series whose MOST-RECENTLY-DUE instance is a completed,
-- non-archived task with NO open successor, create the next FUTURE
-- occurrence. This fires only when spawn-on-complete failed or the
-- successor was lost.
--
-- "Delete this task" in the UI soft-archives the row. The user's way to
-- STOP a series is: complete the current occurrence, then delete (archive)
-- the spawned successor — leaving the archived successor as the latest-due
-- instance. By keying off the latest-due instance OVERALL (archived ones
-- included) and requiring it to be non-archived, an archived successor
-- marks the series stopped and the sweep leaves it alone — it never
-- resurrects a series the user deliberately ended.
create or replace function public.spawn_due_recurring_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_base timestamptz;
  v_next timestamptz;
  v_guard integer;
  v_count integer := 0;
begin
  for r in
    with series as (
      select distinct coalesce(recurrence_parent_id, id) as root
      from public.activities
      where activity_type = 'task' and recur_freq is not null
    ),
    latest as (
      -- Most-recently-due instance OVERALL (archived included), so an
      -- archived successor is recognized as the series-stop signal below.
      select s.root,
             (select a.id
                from public.activities a
               where coalesce(a.recurrence_parent_id, a.id) = s.root
                 and a.activity_type = 'task'
               order by a.due_at desc nulls last, a.created_at desc
               limit 1) as latest_id
        from series s
    )
    select a.*, l.root
      from latest l
      join public.activities a on a.id = l.latest_id
     where a.completed_at is not null
       and a.archived_at is null   -- latest-due archived => series stopped
       and a.recur_freq is not null
       and not exists (
         select 1 from public.activities o
          where coalesce(o.recurrence_parent_id, o.id) = l.root
            and o.completed_at is null
            and o.archived_at is null
       )
  loop
    v_base := coalesce(r.due_at, r.completed_at, now());
    v_next := public.next_task_due(v_base, r.recur_freq, r.recur_interval, r.recur_weekday, r.recur_monthday);
    -- Advance to the next future occurrence so a long-orphaned series
    -- doesn't backfill a pile of overdue tasks.
    v_guard := 0;
    while v_next is not null and v_next < now() and v_guard < 1200 loop
      v_next := public.next_task_due(v_next, r.recur_freq, r.recur_interval, r.recur_weekday, r.recur_monthday);
      v_guard := v_guard + 1;
    end loop;
    if v_next is null then continue; end if;
    if r.recur_until is not null and v_next::date > r.recur_until then continue; end if;

    insert into public.activities (
      account_id, contact_id, opportunity_id, lead_id, owner_user_id,
      activity_type, subject, body, due_at, priority,
      reminder_schedule, reminder_at, reminder_channels,
      recur_freq, recur_interval, recur_weekday, recur_monthday, recur_until,
      recurrence_parent_id
    ) values (
      r.account_id, r.contact_id, r.opportunity_id, r.lead_id, r.owner_user_id,
      'task', r.subject, r.body, v_next, r.priority,
      r.reminder_schedule,
      case when r.reminder_schedule = 'none' then null
           when r.reminder_at is null or r.due_at is null then v_next
           else v_next + (r.reminder_at - r.due_at) end,
      r.reminder_channels,
      r.recur_freq, r.recur_interval, r.recur_weekday, r.recur_monthday, r.recur_until,
      coalesce(r.recurrence_parent_id, r.id)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Admin-triggered manual run (for testing / catch-up from the UI later).
create or replace function public.run_recurring_task_sweep_now()
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can run the recurring task sweep';
  end if;
  return public.spawn_due_recurring_tasks();
end;
$$;

-- spawn_due_recurring_tasks writes data with no internal auth check and is
-- SECURITY DEFINER, so strip the implicit PUBLIC execute grant — only the
-- pg_cron job (runs as owner) and the admin-gated wrapper should invoke it.
revoke execute on function public.spawn_due_recurring_tasks() from public;
revoke execute on function public.run_recurring_task_sweep_now() from public;
grant execute on function public.next_task_due(timestamptz, public.task_recurrence_freq, integer, integer, integer) to authenticated;
grant execute on function public.run_recurring_task_sweep_now() to authenticated;

-- 6. Daily pg_cron sweep (resilient; degrades to a warning) ------------
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('spawn_recurring_tasks_daily');
  exception when others then
    null; -- not scheduled yet
  end;
  perform cron.schedule(
    'spawn_recurring_tasks_daily',
    '45 9 * * *',
    'select public.spawn_due_recurring_tasks();'
  );
exception when others then
  raise warning 'pg_cron setup for spawn_recurring_tasks_daily failed; spawn-on-complete still covers recurrence: %', sqlerrm;
end $$;

commit;

notify pgrst, 'reload schema';
