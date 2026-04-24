-- Grant SELECT on all standard-report views to authenticated + anon.
-- Supabase's PostgREST needs explicit grants on views even when the
-- underlying tables have the grants — views don't auto-inherit.
--
-- The previous migration (20260424000001) created the views but didn't
-- grant, so they appeared empty to the UI even for super_admin users.
-- RLS on the underlying tables is still enforced — this only makes
-- the view endpoints reachable.

begin;

grant select on public.v_arr_base_dataset        to authenticated, anon;
grant select on public.v_arr_rolling_365         to authenticated, anon;
grant select on public.v_new_customers_qtd       to authenticated, anon;
grant select on public.v_lost_customers_qtd      to authenticated, anon;
grant select on public.v_active_pipeline         to authenticated, anon;
grant select on public.v_renewals_qtd            to authenticated, anon;
grant select on public.v_sql_accounts            to authenticated, anon;
grant select on public.v_mql_contacts            to authenticated, anon;
grant select on public.v_mql_leads_qtd           to authenticated, anon;
grant select on public.v_mql_dedup               to authenticated, anon;
grant select on public.v_dashboard_metrics       to authenticated, anon;

commit;
