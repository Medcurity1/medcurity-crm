-- ============================================================
-- Recurring tasks: persist the reminder TEMPLATE across occurrences
-- ----------------------------------------------------------------
-- Bug (review): when a reminder fires with no "next" (a "once" reminder,
-- or a daily/weekly one past its due date), the task-reminders function
-- sets reminder_schedule='none', reminder_at=null on that task. Recurring
-- tasks are usually completed at/after their due date — i.e. AFTER the
-- reminder was consumed — so the spawn copied the now-'none' schedule to
-- every future occurrence, and repeating tasks silently lost their
-- reminder from the 2nd occurrence on (and the lead time degraded).
--
-- Fix: store the series' reminder intent in columns that task-reminders
-- never touches (recur_reminder + recur_reminder_offset), captured on
-- insert by a BEFORE trigger (so the create forms need no changes), and
-- have both the spawn trigger and the daily sweep rebuild each new
-- occurrence's reminder from that template. Also: the spawn trigger now
-- ignores archived source rows (review LOW).
-- ============================================================

begin;

-- 1. Template columns (untouched by the reminder pipeline) --------------
alter table public.activities
  add column if not exists recur_reminder public.reminder_schedule,
  add column if not exists recur_reminder_offset interval;
comment on column public.activities.recur_reminder is
  'Reminder schedule to apply to EACH spawned occurrence of a recurring task. Set once on insert; never consumed by task-reminders (which mutates reminder_schedule). null/none = no per-occurrence reminder.';
comment on column public.activities.recur_reminder_offset is
  'Lead time (due_at - reminder_at) to apply to each occurrence''s reminder, so "remind a day before" survives across occurrences.';

-- 2. Capture the template on insert for recurring tasks ----------------
create or replace function public.capture_recur_reminder_template()
returns trigger
language plpgsql
as $$
begin
  if new.activity_type = 'task'
     and new.recur_freq is not null
     and new.recur_reminder is null then
    new.recur_reminder := new.reminder_schedule;
    if new.reminder_schedule is not null
       and new.reminder_schedule <> 'none'
       and new.due_at is not null
       and new.reminder_at is not null then
      new.recur_reminder_offset := new.due_at - new.reminder_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_capture_recur_reminder on public.activities;
create trigger trg_capture_recur_reminder
  before insert on public.activities
  for each row execute function public.capture_recur_reminder_template();

-- 3. Backfill existing recurring tasks from their current state --------
update public.activities
   set recur_reminder = reminder_schedule,
       recur_reminder_offset = case
         when reminder_schedule <> 'none' and due_at is not null and reminder_at is not null
         then due_at - reminder_at else null end
 where activity_type = 'task'
   and recur_freq is not null
   and recur_reminder is null;

-- 4. Spawn-on-complete trigger: use the template + skip archived source -
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
  if new.activity_type <> 'task' then return new; end if;
  if new.recur_freq is null then return new; end if;
  -- Don't act on completion of an archived (deleted) recurring task.
  if new.archived_at is not null then return new; end if;
  if not (old.completed_at is null and new.completed_at is not null) then
    return new;
  end if;

  v_root := coalesce(new.recurrence_parent_id, new.id);

  -- Frontier guard (unchanged): skip if an open non-archived successor
  -- exists, or any strictly-later-due sibling exists (series was stopped).
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
  if new.recur_until is not null and v_next::date > new.recur_until then
    return new;
  end if;

  insert into public.activities (
    account_id, contact_id, opportunity_id, lead_id, owner_user_id,
    activity_type, subject, body, due_at, priority,
    reminder_schedule, reminder_at, reminder_channels,
    recur_freq, recur_interval, recur_weekday, recur_monthday, recur_until,
    recur_reminder, recur_reminder_offset,
    recurrence_parent_id
  ) values (
    new.account_id, new.contact_id, new.opportunity_id, new.lead_id, new.owner_user_id,
    'task', new.subject, new.body, v_next, new.priority,
    -- Rebuild the reminder from the SERIES template, not the consumed
    -- live schedule (which task-reminders may have reset to 'none').
    coalesce(new.recur_reminder, 'none'),
    case when coalesce(new.recur_reminder, 'none') = 'none' then null
         when new.recur_reminder_offset is not null then v_next - new.recur_reminder_offset
         else v_next end,
    new.reminder_channels,
    new.recur_freq, new.recur_interval, new.recur_weekday, new.recur_monthday, new.recur_until,
    new.recur_reminder, new.recur_reminder_offset,
    v_root
  );

  return new;
end;
$$;

-- 5. Daily backstop sweep: same template-based reminder rebuild --------
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
       and a.archived_at is null
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
      recur_reminder, recur_reminder_offset,
      recurrence_parent_id
    ) values (
      r.account_id, r.contact_id, r.opportunity_id, r.lead_id, r.owner_user_id,
      'task', r.subject, r.body, v_next, r.priority,
      coalesce(r.recur_reminder, 'none'),
      case when coalesce(r.recur_reminder, 'none') = 'none' then null
           when r.recur_reminder_offset is not null then v_next - r.recur_reminder_offset
           else v_next end,
      r.reminder_channels,
      r.recur_freq, r.recur_interval, r.recur_weekday, r.recur_monthday, r.recur_until,
      r.recur_reminder, r.recur_reminder_offset,
      coalesce(r.recurrence_parent_id, r.id)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

commit;

notify pgrst, 'reload schema';
