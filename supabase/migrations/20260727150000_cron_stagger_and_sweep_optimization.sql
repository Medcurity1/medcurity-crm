-- ============================================================
-- Crash prevention: stagger the daily cron cluster + set-based status sweep.
--
-- Prod OOM-crashed 2026-07-22 (2GB tier chronically swapping; upgraded to
-- Medium). The standing follow-ups (docket 7/22): the daily jobs all fire
-- inside 09:00-10:30 UTC — 09:00 renewal_automation, 09:15 customer-status
-- sweep, 09:30 import retention, 09:45 follow_up_due AND spawn_recurring
-- (same minute!), 10:30 watchdog — and the sweep itself was the single
-- heaviest standing job (verified on prod 2026-07-27 via Nathan's read-only
-- cron.job paste).
--
--  1. STAGGER. Every daily job gets its own slot, minutes chosen off the
--     :00/:05 grid so they never stack on the every-5/10-min jobs
--     (task_reminders, meddy_sweep, email_sync, meddy-stale-agents):
--         renewal_automation_daily       09:00 -> 09:07
--         spawn_recurring_tasks_daily    09:45 -> 09:23
--         follow_up_due_daily            09:45 -> 09:38
--         import_runs_retention_daily    09:30 -> 09:53
--         customer-status-daily-sweep    09:15 -> 10:13  (heaviest, own quiet slot)
--         scheduled_job_watchdog_daily   10:30 -> 10:47  (still after every daily)
--     task_digest_weekday_morning stays at 15:00 (already isolated).
--     The watchdog judges staleness in intervals (26h for dailies), not
--     wall-clock times, so nothing breaks; day-one gaps are 24h+minutes.
--     cron.alter_job preserves each job's command — nothing is re-emitted.
--     Fail-soft per job (staging and prod carry different subsets; a missing
--     job logs a notice, never fails the deploy).
--
--  2. SWEEP REWRITE. recompute_all_customer_statuses() looped 5,642 accounts
--     through recompute_account_customer_status() — 11k+ point queries, each
--     with a correlated aggregate over opportunities. Rewritten as ONE
--     grouped scan over closed-won opportunities + one update touching only
--     rows that actually change. Semantics preserved EXACTLY:
--       * derive: 'client' if any ongoing (non one-time) closed-won with a
--         live contract (end_date >= today, or no end_date and close_date
--         within 365d); else 'former_client' if any closed-won ever; else
--         'prospect'  (verbatim conditions from derive_account_customer_status,
--         20260630000004).
--       * the former_client override auto-clear: override becomes obsolete
--         when a NEW non-one-time closed-won (created_at > override_at)
--         makes the account derive 'client' again.
--       * customer_status_derived_at only moves when the status actually
--         changes (it means "last change", not "last sweep").
--       * the admin/service auth guard from 20260701000004 is kept.
--     recompute_account_customer_status(uuid) is untouched — the per-account
--     triggers still use it.
--
--  3. v_cron_jobs_admin — tiny definer view over cron.job (jobname,
--     schedule, active) so schedule state is checkable from the app without
--     a dashboard SQL paste. Read-only, authenticated-only (same posture as
--     the existing v_*_schedule_status cron views); anon revoked.
--
-- Idempotent: alter_job to fixed values + create-or-replace + guarded grants.
-- ============================================================

begin;

-- ---------- 1. Stagger ----------

do $$
declare
  v_pair record;
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[cron-stagger] pg_cron not installed - skipping';
    return;
  end if;

  for v_pair in
    select * from (values
      ('renewal_automation_daily',     '7 9 * * *'),
      ('spawn_recurring_tasks_daily',  '23 9 * * *'),
      ('follow_up_due_daily',          '38 9 * * *'),
      ('import_runs_retention_daily',  '53 9 * * *'),
      ('customer-status-daily-sweep',  '13 10 * * *'),
      ('scheduled_job_watchdog_daily', '47 10 * * *')
    ) as t(jobname, new_schedule)
  loop
    begin
      select jobid into v_jobid from cron.job where jobname = v_pair.jobname;
      if v_jobid is null then
        raise notice '[cron-stagger] % not installed here - skipped', v_pair.jobname;
        continue;
      end if;
      perform cron.alter_job(job_id := v_jobid, schedule := v_pair.new_schedule);
      raise notice '[cron-stagger] % -> %', v_pair.jobname, v_pair.new_schedule;
    exception when others then
      raise warning '[cron-stagger] % failed: %', v_pair.jobname, sqlerrm;
    end;
  end loop;
end $$;

-- ---------- 2. Set-based sweep ----------

create or replace function public.recompute_all_customer_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_admin() then
    raise exception 'insufficient privileges';
  end if;

  with agg as (
    select
      o.account_id,
      count(*) as won_count,
      bool_or(
        coalesce(o.one_time_project, false) = false
        and (
          (o.contract_end_date is not null and o.contract_end_date >= current_date)
          or (o.contract_end_date is null and o.close_date is not null
              and o.close_date >= current_date - 365)
        )
      ) as has_live_ongoing,
      max(o.created_at) filter (
        where coalesce(o.one_time_project, false) = false
      ) as last_ongoing_won_created_at
    from public.opportunities o
    where o.stage = 'closed_won'
      and o.archived_at is null
    group by o.account_id
  ),
  calc as (
    select
      a.id,
      case
        when coalesce(g.has_live_ongoing, false) then 'client'
        when coalesce(g.won_count, 0) > 0        then 'former_client'
        else                                          'prospect'
      end as derived,
      (
        a.customer_status_override = 'former_client'
        and a.customer_status_override_at is not null
        and coalesce(g.has_live_ongoing, false)
        and g.last_ongoing_won_created_at > a.customer_status_override_at
      ) as clear_override
    from public.accounts a
    left join agg g on g.account_id = a.id
  )
  update public.accounts a
  set
    customer_status = coalesce(
      case when c.clear_override then null else a.customer_status_override end,
      c.derived
    ),
    customer_status_derived_at = case
      when a.customer_status is distinct from coalesce(
             case when c.clear_override then null else a.customer_status_override end,
             c.derived
           )
      then now()
      else a.customer_status_derived_at
    end,
    customer_status_override        = case when c.clear_override then null else a.customer_status_override end,
    customer_status_override_reason = case when c.clear_override then null else a.customer_status_override_reason end,
    customer_status_override_at     = case when c.clear_override then null else a.customer_status_override_at end,
    customer_status_override_by     = case when c.clear_override then null else a.customer_status_override_by end
  from calc c
  where c.id = a.id
    and (
      c.clear_override
      or a.customer_status is distinct from coalesce(
           case when c.clear_override then null else a.customer_status_override end,
           c.derived
         )
    );
end;
$$;

revoke execute on function public.recompute_all_customer_statuses() from public, anon;
grant  execute on function public.recompute_all_customer_statuses() to authenticated;

-- ---------- 3. Cron visibility view ----------

create or replace view public.v_cron_jobs_admin as
select j.jobname, j.schedule, j.active
from cron.job j;

alter view public.v_cron_jobs_admin set (security_invoker = false);
revoke all on public.v_cron_jobs_admin from public, anon;
revoke select on public.v_cron_jobs_admin from anon;
grant select on public.v_cron_jobs_admin to authenticated;

commit;

notify pgrst, 'reload schema';
