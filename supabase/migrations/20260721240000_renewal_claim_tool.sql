-- Renewal claim tool (Summer/Molly via Nathan, 2026-07-21).
--
-- The generated-renewal backlog (~105 open auto-created opps) inherited
-- assessor-first-else-owner ownership, which parked many on sales reps who
-- aren't the right assessor. Rather than a manual re-owning slog, the
-- Renewals page gets a temporary claim panel: each row shows who assessed /
-- owned the PREVIOUS deal, and one click claims it — assessor = me,
-- owner = me, and the automation's 60-day signature reminder task MOVES to
-- me (reassigned, not deleted: the standup decision restoring those tasks
-- stands — they just need to nag the right person).
--
-- claimed markers make the panel self-retiring: rows disappear as they're
-- claimed (or marked already-handled), and the panel hides when none remain.
-- All three updates happen in ONE security-definer function so a claim can
-- never half-apply. Role-checked inside; not callable by anon.

begin;

alter table public.opportunities
  add column if not exists renewal_claimed_by uuid references public.user_profiles (id) on delete set null,
  add column if not exists renewal_claimed_at timestamptz;

comment on column public.opportunities.renewal_claimed_by is
  'Claim-tool marker: who took ownership of this auto-generated renewal (or marked it already-handled). NULL = still shows in the claim panel.';

create or replace function public.claim_renewal_opportunity(
  p_opp_id uuid,
  -- reassign_only=true: "Mark handled" — stamp the claim markers without
  -- touching owner/assessor/task (the row was already sorted out manually).
  p_mark_handled_only boolean default false
)
returns table (claimed_id uuid, task_reassigned boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_opp   record;
  v_tasks integer := 0;
begin
  if v_uid is null or not public.has_crm_write_role() then
    raise exception 'Not allowed';
  end if;

  select id, stage, created_by_automation, renewal_claimed_by, renewal_from_opportunity_id
    into v_opp
    from public.opportunities
   where id = p_opp_id
     and archived_at is null
   for update;

  if not found then
    raise exception 'Renewal not found';
  end if;
  -- Pulse-generated only (parent link present): SF-imported renewals also
  -- carry created_by_automation but came over with correct ownership.
  if coalesce(v_opp.created_by_automation, false) = false
     or v_opp.renewal_from_opportunity_id is null then
    raise exception 'Only auto-generated renewals can be claimed';
  end if;
  if v_opp.stage in ('closed_won', 'closed_lost') then
    raise exception 'This renewal is already closed';
  end if;
  if v_opp.renewal_claimed_by is not null then
    raise exception 'Already claimed';
  end if;

  if p_mark_handled_only then
    update public.opportunities
       set renewal_claimed_by = v_uid,
           renewal_claimed_at = timezone('utc', now())
     where id = p_opp_id;
  else
    update public.opportunities
       set assigned_assessor_id = v_uid,
           owner_user_id        = v_uid,
           renewal_claimed_by   = v_uid,
           renewal_claimed_at   = timezone('utc', now())
     where id = p_opp_id;

    -- Move the automation's still-open signature reminder to the claimer.
    update public.activities
       set owner_user_id = v_uid
     where opportunity_id = p_opp_id
       and activity_type = 'task'
       and subject like 'New signature needed%'
       and body like '%Created by renewal automation.%'
       and completed_at is null
       and archived_at is null;
    get diagnostics v_tasks = row_count;
  end if;

  return query select p_opp_id, v_tasks > 0;
end;
$$;

revoke execute on function public.claim_renewal_opportunity(uuid, boolean) from public, anon;
grant execute on function public.claim_renewal_opportunity(uuid, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
