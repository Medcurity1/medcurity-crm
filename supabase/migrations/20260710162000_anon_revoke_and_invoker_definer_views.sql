-- ============================================================
-- Security: close the six anon-readable SECURITY-DEFINER views the June
-- anon-leak remediation missed (security-review batch 2026-07-10).
--
-- Six public views were created without security_invoker and never had
-- anon revoked, so Supabase's default privileges left them readable over
-- PostgREST with ONLY the public anon apikey — no login — bypassing RLS
-- on their base tables and the active-user read gate (20260625000005).
-- Verified live against staging 2026-07-10 (anon key, JWT role=anon):
--
--   * account_contracts       -> 1,244 rows: customer names, contract $ + dates
--   * v_accounts_status_unset -> 5,065 rows: account name, sf_id, owner
--   * pipeline_summary        -> per-stage pipeline dollar totals
--   * data_health_check       -> entity record counts
--   * v_lead_last_activity    -> lead ids + activity timestamps
--   * v_field_inventory       -> full schema metadata (had an EXPLICIT
--                                `grant ... to anon` in 20260426000005)
--
-- Same class as v_dashboard_arr_financial (fixed 20260625000004), the
-- 20260616000010 report-view batch, and renewal_queue (20260707180000);
-- these six were never in any revoke list.
--
-- Fix, matching the renewal_queue convention:
--   1) REVOKE anon + explicit GRANT authenticated on all six.
--   2) security_invoker = on for the views that read only RLS-protected
--      CRM tables (account_contracts, v_accounts_status_unset,
--      pipeline_summary, v_lead_last_activity), so the caller's RLS
--      applies and a deactivated-but-authenticated user can no longer
--      read through them either. Each of these already filters archived
--      rows itself (or reads a table whose policy hides archived rows),
--      so active users of every role see exactly the same rows as today.
--   3) data_health_check and v_field_inventory stay definer ON PURPOSE:
--      data_health_check must count archived/unassigned rows across all
--      entities for the admin Data Health page, and v_field_inventory
--      enumerates information_schema — both now authenticated-only.
--
-- Consumers (all query as the signed-in user via supabase-js; nothing
-- reads these with the anon key): accounts/api.ts (account_contracts),
-- lead-lists-api.ts (v_lead_last_activity), DataHealthDashboard.tsx
-- (data_health_check), ObjectManager/LayoutEditor/RequiredFieldsManager
-- (v_field_inventory). pipeline_summary and v_accounts_status_unset have
-- no code consumers (HomePage's PipelineSummaryWidget and ask-ai compute
-- from the opportunities table directly). No UI behavior changes.
--
-- Idempotent / fail-soft: every statement is wrapped in a to_regclass
-- existence guard (a later migration in this batch may drop the orphaned
-- v_accounts_status_unset); REVOKE/GRANT re-runs are no-ops.
-- ============================================================

begin;

do $$
declare
  v text;
begin
  -- 1) All six: never readable by anon; explicitly readable by
  --    authenticated (base-table RLS decides what invoker views return).
  foreach v in array array[
    'account_contracts',
    'v_accounts_status_unset',
    'pipeline_summary',
    'data_health_check',
    'v_lead_last_activity',
    'v_field_inventory'
  ] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke select on public.%I from anon', v);
      execute format('grant select on public.%I to authenticated', v);
    else
      raise notice 'view public.% not found, skipping revoke', v;
    end if;
  end loop;

  -- 2) Caller's RLS applies (definer -> invoker) where the view reads
  --    only RLS-protected CRM tables.
  foreach v in array array[
    'account_contracts',
    'v_accounts_status_unset',
    'pipeline_summary',
    'v_lead_last_activity'
  ] loop
    if to_regclass('public.' || v) is not null then
      execute format('alter view public.%I set (security_invoker = on)', v);
    else
      raise notice 'view public.% not found, skipping invoker', v;
    end if;
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
