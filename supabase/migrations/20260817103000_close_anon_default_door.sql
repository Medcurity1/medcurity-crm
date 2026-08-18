-- ============================================================
-- Survey T9 (2026-08-17): permanently close the recurring anon-view door.
--
-- HISTORY: public views readable by the anon role have been found and
-- remediated at least five times (20260616000001, 20260616000010,
-- 20260625000004, 20260710162000, 20260710164000), twice with confirmed
-- live data exposure. Root cause each time: Supabase's DEFAULT PRIVILEGES
-- grant anon SELECT on every new object in public, so safety depended on
-- each migration author remembering a revoke line.
--
-- THIS MIGRATION:
--   1. Removes anon from the default privileges for future tables/views
--      (for the role that runs migrations — object creator — plus
--      postgres explicitly). From now on a NEW view is born with no anon
--      grant instead of born leaking.
--   2. Revokes the anon grants still sitting on 12 live views (verified
--      by anon REST probe on staging 2026-08-17: all returned 200 —
--      grant present. All ALSO returned zero rows, because they are
--      security_invoker and RLS filters anon to nothing, so NO DATA WAS
--      EXPOSED — but the grant is one future `security_invoker = off`
--      away from being the sixth incident. Belt over the braces.)
--   3. tests/anonViewGrants.test.ts is broadened in the same commit: it
--      now enumerates EVERY view in the migration history (not a
--      hardcoded 8) and fails CI if any live view created before this
--      migration lacks a revoke, or if any later migration grants anon.
--
-- Deliberately untouched: authenticated grants (the app reads all of
-- these signed in), function EXECUTE defaults (no anon RPC exists, and
-- revoking would be scope creep beyond the incident class), and existing
-- table grants (tables are RLS-gated; anon gets zero rows by policy).
-- ============================================================

begin;

-- ── 1. The door ──────────────────────────────────────────────────────
do $$
begin
  -- The role executing migrations owns every future object it creates.
  execute format(
    'alter default privileges for role %I in schema public revoke all on tables from anon',
    current_user);
exception when others then
  raise warning 'default-privileges revoke for current role failed (non-fatal): %', sqlerrm;
end $$;

do $$
begin
  -- Explicitly cover postgres too, in case a future pipeline runs as a
  -- different role while objects stay postgres-owned.
  alter default privileges for role postgres in schema public revoke all on tables from anon;
exception when others then
  raise warning 'default-privileges revoke for postgres failed (non-fatal): %', sqlerrm;
end $$;

-- ── 2. The 12 grant-carrying views (probe-verified 2026-08-17) ───────
revoke all on public.v_account_last_activity                  from anon;
revoke all on public.v_campaigns_daily_sweep_schedule_status  from anon;
revoke all on public.v_cold_call_contacts                     from anon;
revoke all on public.v_contact_callers                        from anon;
revoke all on public.v_contact_last_activity                  from anon;
revoke all on public.v_email_sync_schedule_status             from anon;
revoke all on public.v_meddy_sweep_schedule_status            from anon;
revoke all on public.v_opportunities_with_activity            from anon;
revoke all on public.v_opportunity_last_activity              from anon;
revoke all on public.v_renewal_data_gaps                      from anon;
revoke all on public.v_task_digest_schedule_status            from anon;
revoke all on public.v_task_reminders_schedule_status         from anon;

commit;
