-- ============================================================
-- Close the remaining anon-readable definer views (db-health sweep 2026-07-10).
--
-- Five plain (security-definer) views were still reachable over PostgREST
-- with ONLY the public anon apikey — no login — bypassing RLS on their base
-- tables. Verified by live staging probes (apikey only, no bearer):
--
--   * public.account_contracts      -> 1,244 rows: account/opportunity names,
--                                      contract dates, total/service/product amounts
--   * public.active_pipeline        -> 156 rows: every open deal w/ amount,
--                                      account name, owner
--   * public.v_lead_last_activity   -> 9,673 rows: lead ids + activity recency
--                                      (enumeration oracle over the leads table)
--   * public.pipeline_summary       -> revenue-by-stage aggregates
--   * public.data_health_check      -> table-level record counts
--
-- Same class as v_dashboard_arr_financial (fixed 20260625000004) and
-- renewal_queue (20260707180000); these were simply never in any revoke list.
-- Every consumer queries as the signed-in user (supabase-js with a session:
-- accounts/api.ts account_contracts, opportunities/api.ts active_pipeline,
-- lead-lists-api.ts v_lead_last_activity, DataHealthDashboard.tsx
-- data_health_check, HomePage PipelineSummaryWidget; ask-ai's
-- pipeline_summary tool reads the opportunities TABLE via userClient, not
-- the view). The `authenticated` grants are untouched, so nothing changes
-- for logged-in users. Only anon loses access.
--
-- public.v_accounts_status_unset is both anon-readable (5,065 account rows:
-- name, sf_id, owner) AND orphaned — its only UI consumer was removed in
-- 16b7909 ("drop lifecycle_status UI") and grep finds zero references in
-- src/, scripts/ or edge functions. Drop it outright.
--
-- Idempotent / fail-soft: each statement is guarded by an existence check;
-- REVOKE on an already-revoked grant is a no-op; DROP VIEW IF EXISTS.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.account_contracts') is not null then
    revoke select on public.account_contracts from anon;
  end if;

  if to_regclass('public.active_pipeline') is not null then
    revoke select on public.active_pipeline from anon;
  end if;

  if to_regclass('public.v_lead_last_activity') is not null then
    revoke select on public.v_lead_last_activity from anon;
  end if;

  if to_regclass('public.pipeline_summary') is not null then
    revoke select on public.pipeline_summary from anon;
  end if;

  if to_regclass('public.data_health_check') is not null then
    revoke select on public.data_health_check from anon;
  end if;
end $$;

-- Orphaned diagnostic view (no consumers since 16b7909) that also leaked
-- 5,065 account rows to anon. Nothing reads it — remove the surface entirely.
drop view if exists public.v_accounts_status_unset;

commit;

notify pgrst, 'reload schema';
