-- ============================================================
-- Close the last anon-readable financial view.
--
-- 20260616000010 revoked `anon` SELECT across the report/dashboard surface
-- (v_dashboard_metrics, v_arr_base_dataset, v_new/lost_customers_qtd, ...)
-- but MISSED v_dashboard_arr_financial — which exposes company ARR / NRR /
-- churn / lost-revenue with no login, over PostgREST. The app only ever
-- reads it from the authenticated Team Dashboard (TeamDashboard.tsx), so
-- removing the anon grant changes nothing for logged-in users.
--
-- Idempotent: REVOKE on an already-revoked grant is a no-op.
-- ============================================================

begin;

revoke select on public.v_dashboard_arr_financial from anon;

commit;

notify pgrst, 'reload schema';
