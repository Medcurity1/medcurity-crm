-- ============================================================
-- One-time sweep: retire the "Training" placeholder assessor
-- (Nathan 2026-08-21, "go ahead with everything" — Summer confirmed,
-- Rachel approved; companion to 20260821190000).
--
-- Since the 7/15 assessor requirement, Summer got past the gate by
-- picking the literal "Training" user as the Assigned Assessor
-- (her 8/19 bug report says so; confirmed live on prod deals
-- f592bed2 Salma Clinic and 798a09cd Hurone AI on 8/21). Those deals
-- LOOK staffed, so the new follow-up automation would never touch
-- them — and renewal reminders / signature tasks would route to a
-- login nobody works from. This sweep moves them into the new flow:
--
--   * Every deal whose assigned assessor is a "Training" user gets
--     the placeholder cleared.
--   * CLOSED-WON ones also get the same "Assign the assessor" task
--     the close trigger would have created (7-day due, Jordan
--     Scherich first, deal owner as fallback) — a closed deal never
--     re-fires the close trigger, so the sweep must create these
--     itself. The task body carries the SAME automation marker, so
--     the auto-complete trigger and the daily reminder treat them
--     exactly like trigger-born tasks, and it also records which
--     placeholder was removed (the audit trail for this change).
--   * Open / lost deals just get the placeholder cleared — if an
--     open service deal later closes without a real assessor, the
--     close trigger makes its task naturally; lost deals need none.
--
-- The batch of task INSERTs lands inside notify_task_assigned's
-- 2-minute collapse window, so Jordan gets ONE "N tasks assigned to
-- you" bell, not N bells (20260817140000's bulk rule).
--
-- Deliberately NOT done here: deactivating the Training user — it
-- may be a shared demo/training login with other uses; flagged to
-- Nathan instead.
--
-- Idempotent: after the first run no deal points at a Training user,
-- so re-runs match nothing; the task insert is additionally guarded
-- by an existing-open-task check. On environments with no Training
-- user (staging, verified 2026-08-21) the whole sweep is a no-op.
-- ============================================================

begin;

do $$
declare
  v_training_ids uuid[];
  v_jordan       uuid;
  v_deal         record;
  v_recipient    uuid;
  v_cleared      integer := 0;
  v_tasks        integer := 0;
begin
  select array_agg(id) into v_training_ids
    from public.user_profiles
   where lower(trim(full_name)) = 'training';

  if v_training_ids is null then
    raise notice '[assessor_sweep] no "Training" user on this environment — nothing to sweep';
    return;
  end if;

  select up.id into v_jordan
    from public.user_profiles up
   where lower(up.full_name) = 'jordan scherich'
     and coalesce(up.is_active, true)
   limit 1;

  -- Closed-won deals: clear the placeholder AND open the follow-up task.
  for v_deal in
    select o.id, o.account_id, o.owner_user_id, o.name
      from public.opportunities o
     where o.assigned_assessor_id = any (v_training_ids)
       and o.stage = 'closed_won'
       and o.archived_at is null
  loop
    update public.opportunities
       set assigned_assessor_id = null
     where id = v_deal.id;
    v_cleared := v_cleared + 1;

    v_recipient := coalesce(v_jordan, v_deal.owner_user_id);
    if v_recipient is not null and not exists (
      select 1 from public.activities t
       where t.opportunity_id = v_deal.id
         and t.activity_type = 'task'
         and t.subject like 'Assign the assessor%'
         and t.completed_at is null
         and t.archived_at is null
    ) then
      insert into public.activities (
        account_id, opportunity_id, owner_user_id,
        activity_type, subject, body, due_at
      )
      values (
        v_deal.account_id,
        v_deal.id,
        v_recipient,
        'task',
        'Assign the assessor: ' || coalesce(nullif(trim(v_deal.name), ''), 'closed deal'),
        'This service deal was closed with the "Training" placeholder as its assessor '
          || '(cleared by the 2026-08-21 cleanup). Once staffing is decided, set the '
          || 'assessor on the deal and this task completes itself. Renewal reminders '
          || 'and signature tasks route to the assessor, so leaving it empty sends that '
          || 'work to the deal owner instead. '
          || 'Created by the assessor follow-up automation.',
        now() + interval '7 days'
      );
      v_tasks := v_tasks + 1;
    end if;
  end loop;

  -- Everything else (open pipeline, closed-lost, archived): clear only.
  -- An archived deal keeps its history clean too — no task, no bell.
  with cleared as (
    update public.opportunities
       set assigned_assessor_id = null
     where assigned_assessor_id = any (v_training_ids)
       and not (stage = 'closed_won' and archived_at is null)
    returning 1
  )
  select v_cleared + count(*) into v_cleared from cleared;

  raise notice '[assessor_sweep] cleared % deal(s), created % follow-up task(s), routed to %',
    v_cleared, v_tasks,
    case when v_jordan is not null then 'Jordan Scherich' else 'deal owners (Jordan not found)' end;
end $$;

commit;
