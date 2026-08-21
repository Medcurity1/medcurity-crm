-- ============================================================
-- Assessor requirement → assessor follow-up (Nathan + Rachel, 2026-08-21).
--
-- Summer's 8/20 report: Jordan staffs the assessor AFTER a service deal is
-- sold, so requiring Assigned Assessor at Closed Won (Rachel's 7/15 rule,
-- 20260715170000) forces closers to pick a placeholder — which then poisons
-- the downstream routing the rule existed to protect (renewal reminders and
-- signature tasks go assessor-first). Nathan emailed both requesters; Rachel
-- approved this replacement on 8/21 and added the daily-reminder item:
--
--   1. Assessor stops being REQUIRED at close (and on the service-deal
--      form). The field, the admin toggles, and the close-gate code all
--      stay — flipping required_field_config back on restores the old
--      behavior with zero code changes.
--   2. When a service deal is closed without an assessor, Pulse creates an
--      "Assign the assessor" task, routed to Jordan (Rachel 8/21). The
--      existing task_assigned trigger (20260817140000) bells her instantly.
--   3. Daily reminder while any of those tasks stay open (Rachel 8/21).
--   4. The task auto-completes the moment an assessor lands on the deal.
--
-- "Jordan" routing: the only Jordan with a Pulse login is Jordan Scherich
-- (renewals) — verified against staging user_profiles 2026-08-21; Jordan
-- Mayer has no account and cannot hold tasks. Resolution is by full_name
-- lookup with a fallback to the deal owner (then the closer) so the task
-- can never silently vanish if her profile is renamed or deactivated.
--
-- Machine paths stay silent ON PURPOSE: the original gate was client-side
-- only so imports and the renewal automation are never blocked, and this
-- follow-up keeps that philosophy — tasks spawn only from human actions
-- (auth.uid() present; pg_cron / service-role writers have none). The
-- INSERT path additionally requires a recent close date so a historical
-- import can never flood Jordan with tasks for long-expired contracts.
-- ============================================================

begin;

-- 1. Flip the two requirement rows OFF (rows kept — the Admin → Required
--    Fields toggles still work, and turning either back on needs no code).
--    Upsert rather than update so a fresh environment lands in the same
--    final state even though 20260715170000 always precedes this file.
insert into public.required_field_config (entity, field_key, is_required)
values
  ('opportunities', 'assigned_assessor_id', false),
  ('opportunity_close', 'assigned_assessor', false)
on conflict (entity, field_key) do update set is_required = false;

-- 2. Notification type for the daily reminder. Full re-statement of the
--    list as of 20260817140000:100 plus the new member.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'task_due', 'renewal_upcoming', 'deal_stage_change', 'mention',
    'engagement', 'system',
    'meddy_new_chat', 'meddy_human_requested', 'meddy_buying_intent',
    'meddy_missed_chat', 'meddy_contact_received',
    'support_human_requested', 'support_new_chat',
    'deal_high_five',
    'follow_up_due',
    'record_assigned', 'task_assigned',
    'assessor_needed'
  ));

-- 3. Task creation: a human closes (or creates-as-closed) a service deal
--    with no assessor → open an "Assign the assessor" task for Jordan.
create or replace function public.create_assessor_needed_task()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor     uuid := auth.uid();
  v_recipient uuid;
  v_has_services boolean;
begin
  -- Human surfaces only. Imports, the renewal generator and any pg_cron /
  -- service-role writer run with no auth.uid() and must stay silent —
  -- the same "never block (or spam from) machine paths" stance as the
  -- original client-side-only gate.
  if v_actor is null then return new; end if;

  -- INSERT path (deal created directly as closed_won): only for deals
  -- actually closing NOW — a bulk load of historical closed_won rows
  -- (in-app CSV import runs as the user, so the uid guard alone would
  -- not catch it) must not manufacture staffing work for dead contracts.
  if tg_op = 'INSERT'
     and coalesce(new.close_date, current_date) < current_date - 30 then
    return new;
  end if;

  -- Same three service signals as closeReadiness.opportunityHasServices /
  -- recalc_opportunity_amount: the flag, a service dollar, or a
  -- service-family line item.
  v_has_services :=
    coalesce(new.services_included, false)
    or coalesce(new.service_amount, 0) > 0
    or exists (
      select 1
        from public.opportunity_products op
        join public.products p on p.id = op.product_id
       where op.opportunity_id = new.id
         and p.product_family ilike 'service%'
    );
  if not v_has_services then return new; end if;

  -- One open task per deal, ever — re-closing a reopened deal or a stage
  -- bounce must not stack duplicates.
  if exists (
    select 1 from public.activities t
     where t.opportunity_id = new.id
       and t.activity_type = 'task'
       and t.subject like 'Assign the assessor%'
       and t.completed_at is null
       and t.archived_at is null
  ) then
    return new;
  end if;

  -- Everything from here is follow-up work; never abort the close.
  begin
    select up.id into v_recipient
      from public.user_profiles up
     where lower(up.full_name) = 'jordan scherich'
       and coalesce(up.is_active, true)
     limit 1;
    v_recipient := coalesce(v_recipient, new.owner_user_id, v_actor);
    if v_recipient is null then return new; end if;

    insert into public.activities (
      account_id, opportunity_id, owner_user_id,
      activity_type, subject, body, due_at
    )
    values (
      new.account_id,
      new.id,
      v_recipient,
      'task',
      'Assign the assessor: ' || coalesce(nullif(trim(new.name), ''), 'closed deal'),
      'This service deal was marked Closed Won without an Assigned Assessor. '
        || 'Once staffing is decided, set the assessor on the deal and this task '
        || 'completes itself. Renewal reminders and signature tasks route to the '
        || 'assessor, so leaving it empty sends that work to the deal owner instead. '
        || 'Created by the assessor follow-up automation.',
      now() + interval '7 days'
    );
    -- trg_notify_task_assigned (20260817140000) bells the recipient
    -- immediately; nothing more to do here.
  exception when others then
    raise warning '[assessor_followup] task for opp % failed: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.create_assessor_needed_task() is
  'Rachel-approved replacement for the hard assessor close-gate (2026-08-21): when a HUMAN closes (or creates-as-closed, within 30 days) a service deal with no assigned_assessor_id, opens one "Assign the assessor" task routed to Jordan Scherich (fallback: deal owner, then the closer). Machine writers (no auth.uid()) never fire it. Deduped on an existing open task per deal; no-fail.';

drop trigger if exists trg_assessor_task_on_close on public.opportunities;
create trigger trg_assessor_task_on_close
after update of stage on public.opportunities
for each row
when (new.stage = 'closed_won'
      and old.stage is distinct from new.stage
      and new.assigned_assessor_id is null
      and new.archived_at is null)
execute function public.create_assessor_needed_task();

drop trigger if exists trg_assessor_task_on_insert on public.opportunities;
create trigger trg_assessor_task_on_insert
after insert on public.opportunities
for each row
when (new.stage = 'closed_won'
      and new.assigned_assessor_id is null
      and new.archived_at is null)
execute function public.create_assessor_needed_task();

-- 4. Auto-complete: the assessor landing on the deal IS the task being
--    done, from any surface (form, detail page, a future admin tool).
create or replace function public.complete_assessor_needed_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.activities t
       set completed_at = now()
     where t.opportunity_id = new.id
       and t.activity_type = 'task'
       and t.subject like 'Assign the assessor%'
       and t.body like '%Created by the assessor follow-up automation.%'
       and t.completed_at is null
       and t.archived_at is null;
  exception when others then
    raise warning '[assessor_followup] auto-complete for opp % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

comment on function public.complete_assessor_needed_tasks() is
  'Marks open "Assign the assessor" automation tasks complete the moment assigned_assessor_id is set on their deal — the assignment is the task, so nobody has to remember to tick a box (and the daily reminder stops counting it).';

drop trigger if exists trg_assessor_task_autocomplete on public.opportunities;
create trigger trg_assessor_task_autocomplete
after update of assigned_assessor_id on public.opportunities
for each row
when (new.assigned_assessor_id is not null
      and old.assigned_assessor_id is null)
execute function public.complete_assessor_needed_tasks();

-- 5. Rachel's daily reminder: one bell per holder per day while any
--    "Assign the assessor" task stays open. Grouped by the task's CURRENT
--    owner (Jordan by default, but a reassigned task nags its new holder,
--    not her). Single task deep-links with ?open_task= exactly like
--    task-reminders / notify_task_assigned; several link to the owner's
--    task list. Dedup: skip anyone already reminded in the last 20 hours,
--    so a manual re-run or a cron retry never double-bells.
create or replace function public.notify_assessor_tasks_open()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, message, link)
  select
    g.owner_user_id,
    'assessor_needed',
    case when g.n = 1
         then 'Assessor needed: ' || g.one_subject
         else format('%s deals still need an assessor', g.n)
    end,
    case when g.n = 1
         then 'This service deal closed without an Assigned Assessor. Set the assessor and the task completes itself.'
         else format('%s service deals closed without an Assigned Assessor. Open your tasks to work through them.', g.n)
    end,
    case when g.n = 1 then g.one_link
         else '/activities?type=task&owner=me'
    end
  from (
    select
      t.owner_user_id,
      count(*)::int as n,
      min(replace(t.subject, 'Assign the assessor: ', '')) as one_subject,
      min(case
            when t.opportunity_id is not null
              then '/opportunities/' || t.opportunity_id::text || '?open_task=' || t.id::text
            else '/activities?type=task&owner=me&open_task=' || t.id::text
          end) as one_link
    from public.activities t
    where t.activity_type = 'task'
      and t.subject like 'Assign the assessor%'
      and t.body like '%Created by the assessor follow-up automation.%'
      and t.completed_at is null
      and t.archived_at is null
      and t.owner_user_id is not null
    group by t.owner_user_id
  ) g
  join public.user_profiles up
    on up.id = g.owner_user_id and coalesce(up.is_active, true)
  left join public.user_notification_prefs p on p.user_id = g.owner_user_id
  where coalesce((p.prefs->>'assessor_needed')::boolean, true)
    and not exists (
      select 1 from public.notifications n
      where n.user_id = g.owner_user_id
        and n.type = 'assessor_needed'
        and n.created_at > now() - interval '20 hours'
    );
end;
$$;

comment on function public.notify_assessor_tasks_open() is
  'Rachel (2026-08-21): daily assessor_needed bell to anyone holding open "Assign the assessor" automation tasks — count + list link, or a deep link when it is a single task. Respects prefs->>assessor_needed (default ON), skips inactive users, deduped per recipient inside 20 hours so re-runs are safe.';

-- Cron-only writers should not be reachable through PostgREST — same
-- posture as notify_renewals_upcoming (20260817110000).
revoke all on function public.create_assessor_needed_task() from public, anon, authenticated;
revoke all on function public.complete_assessor_needed_tasks() from public, anon, authenticated;
revoke all on function public.notify_assessor_tasks_open() from public, anon, authenticated;

-- Register the job so the admin panel and the watchdog both see it.
insert into public.scheduled_job_registry
  (jobname, kind, required, max_gap, checked_by_watchdog, notes)
values
  ('assessor_needed_daily', 'sql', true, interval '26 hours', true,
   'Daily reminder while "Assign the assessor" tasks are open (Rachel 8/21). Runs 5 min after renewal_upcoming_daily.')
on conflict (jobname) do nothing;

commit;

-- Schedule outside the txn, fail-soft — the 20260630000002 /
-- 20260715120000 pattern. A missing pg_cron must raise a notice, never
-- break the migration; the registry row above makes a silent skip
-- visible in the watchdog instead of losing it.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[assessor_followup] pg_cron not installed — daily reminder not scheduled (still callable via notify_assessor_tasks_open())';
    return;
  end if;
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'assessor_needed_daily';
  perform cron.schedule(
    'assessor_needed_daily',
    '55 9 * * *',
    $cron$ select public.notify_assessor_tasks_open(); $cron$
  );
exception when others then
  raise warning '[assessor_followup] pg_cron schedule failed (callable manually): %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
