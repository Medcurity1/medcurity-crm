-- ============================================================
-- Survey T9 part 2 (2026-08-17): close the anon door on FUNCTIONS.
--
-- PROBE (staging, 2026-08-17): POST /rest/v1/rpc/notify_follow_ups_due
-- with only the public anon key returned 204 — anon EXECUTED a
-- SECURITY DEFINER producer. Supabase's default ACL grants EXECUTE on
-- new public functions to PUBLIC (which anon inherits), so every
-- migration-created function has been born anon-callable unless its
-- author explicitly revoked (only 4 of 94 definer functions had:
-- _merge_accounts_core, daily_deal_ensure_puzzle,
-- notify_renewals_upcoming, scheduled_job_watchdog).
--
-- DESIGN (preserve effective access for every legitimate caller):
--   * anon calls nothing — the app has no pre-login surface.
--   * authenticated keeps exactly what it effectively has today
--     (blanket re-grant), because RLS-policy helper predicates
--     (is_admin, current_app_role, has_crm_write_role, ...), functions
--     referenced inside security_invoker views
--     (current_fiscal_quarter_end, ...), and every frontend .rpc() call
--     all execute as authenticated. EXCEPT the maintenance/cron surface
--     below, which no frontend code calls (verified by grepping every
--     .rpc() literal + the two dynamic call sites) and which reps were
--     never meant to fire by hand.
--   * service_role granted everywhere (edge functions).
--   * pg_cron jobs run as the function owner — grants irrelevant.
--   * trigger functions: EXECUTE is checked at CREATE TRIGGER, not at
--     fire time — the blanket change cannot break DML.
--   * Extension-owned and non-postgres-owned functions are excluded
--     (pg_trgm & friends keep their stock ACLs).
--
-- Future functions: default privileges below make them born with
-- authenticated + service_role and WITHOUT public/anon. A future
-- cron-producer should still self-revoke authenticated the way
-- 20260817110000 does — the default is tuned for the common case
-- (frontend-called RPCs), not the producer case.
-- ============================================================

begin;

do $$
declare
  r record;
  -- Cron/maintenance surface: no frontend caller (verified 2026-08-17),
  -- runs via pg_cron (owner) or service_role only. authenticated is
  -- removed here — signed-in reps could previously fire these by hand.
  v_lock_full text[] := array[
    '_merge_accounts_core',
    'daily_deal_ensure_puzzle',
    'notify_renewals_upcoming',
    'scheduled_job_watchdog',
    'notify_follow_ups_due',
    'sweep_stale_bug_reviews',
    'generate_upcoming_renewals_unsafe',
    'preview_upcoming_renewals_unsafe',
    'meddy_sweep_stale_agents',
    'spawn_due_recurring_tasks',
    'fn_spawn_recurring_task',
    'queue_email_backfill',
    'recompute_all_account_statuses',
    'recompute_all_customer_statuses'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proowner = to_regrole('postgres')
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if r.name = any(v_lock_full) then
      execute format('revoke all on function %s from authenticated', r.sig);
    else
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

-- The door for future functions (mirrors 20260817103000's table door).
do $$
begin
  execute format(
    'alter default privileges for role %I in schema public revoke execute on functions from public',
    current_user);
  execute format(
    'alter default privileges for role %I in schema public revoke execute on functions from anon',
    current_user);
  execute format(
    'alter default privileges for role %I in schema public grant execute on functions to authenticated, service_role',
    current_user);
exception when others then
  raise warning 'default function privileges (current role) failed (non-fatal): %', sqlerrm;
end $$;

do $$
begin
  alter default privileges for role postgres in schema public revoke execute on functions from public;
  alter default privileges for role postgres in schema public revoke execute on functions from anon;
  alter default privileges for role postgres in schema public grant execute on functions to authenticated, service_role;
exception when others then
  raise warning 'default function privileges (postgres) failed (non-fatal): %', sqlerrm;
end $$;

commit;
