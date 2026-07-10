-- Create public.v_task_reminders_schedule_status for real (2026-07-10).
--
-- The view was added on 2026-05-26 (commit 1c19c87) by EDITING
-- 20260522000003_task_reminders_schedule.sql AFTER that migration had
-- already been applied to staging/prod. Edited migrations never re-run,
-- so the view exists in NO environment (staging GET
-- /rest/v1/v_task_reminders_schedule_status returns 404 PGRST205) even
-- though the task_reminders_every_5_min pg_cron job itself is live.
--
-- This migration re-creates the view exactly as defined at the bottom of
-- 20260522000003, wrapped in the same fail-soft pg_cron guard as
-- 20260710130000_email_sync_reliability.sql section 4: the view references
-- cron.* tables, so on an environment without pg_cron it raises a notice
-- and skips instead of failing the deploy. Idempotent (create or replace).

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[task-reminders] pg_cron not installed — diagnostic view NOT created (references cron.* tables)';
    return;
  end if;

  execute $view$
    create or replace view public.v_task_reminders_schedule_status as
    select
      j.jobid,
      j.jobname,
      j.schedule,
      j.active,
      (
        select max(start_time) from cron.job_run_details d
        where d.jobid = j.jobid
      ) as last_run_at,
      (
        select status from cron.job_run_details d
        where d.jobid = j.jobid
        order by start_time desc
        limit 1
      ) as last_run_status,
      (
        select return_message from cron.job_run_details d
        where d.jobid = j.jobid
        order by start_time desc
        limit 1
      ) as last_run_message
    from cron.job j
    where j.jobname = 'task_reminders_every_5_min'
  $view$;

  execute $c$comment on view public.v_task_reminders_schedule_status is
    'Health check for task-reminders pg_cron schedule. Returns 0 rows if not installed (check GUCs app.task_reminders_url / app.task_reminders_key, or fallback app.email_sync_url / app.email_sync_key).'$c$;

  -- Run the view with the privileges of its creator (postgres) so the
  -- underlying cron.* tables — which are restricted to the postgres role
  -- by default — are still readable through this admin diagnostic.
  execute 'alter view public.v_task_reminders_schedule_status set (security_invoker = false)';

  -- Read access for any authenticated user is fine — it returns
  -- non-sensitive scheduling metadata (no service-role key, no email
  -- bodies).
  execute 'grant select on public.v_task_reminders_schedule_status to authenticated';
end $$;
