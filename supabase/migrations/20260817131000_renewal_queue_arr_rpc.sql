-- ============================================================
-- Survey T1 follow-up (2026-08-17): "Total ARR at Risk" was truncating
-- at 1,000 rows like the rest of the dashboard.
--
-- THE BUG: kpi-registry.ts's `arr_at_risk` KPI called fetchRenewalQueue(),
-- which does a bare `select days_until_renewal, current_arr from
-- renewal_queue` with no .range() paging, then summed `current_arr` in
-- the browser. PostgREST caps every response at 1,000 rows, so once the
-- renewal queue passes 1,000 entries the tile silently reports the ARR of
-- an ARBITRARY 1,000-row subset — the view has no ORDER BY, so it is not
-- even a stable subset between loads. Same wrong-number class as the
-- widgets fixed in 20260817130000; this is the last one in the KPI set.
--
-- THE FIX: one server-side SUM over the same view.
--
-- SEMANTICS PRESERVED EXACTLY. `arr_at_risk` applies NO client-side
-- filter — it reduces over every row fetchRenewalQueue returns:
--     rows.reduce((sum, r) => sum + Number(r.current_arr), 0)
-- so the RPC with both arguments left null sums the whole view and
-- nothing else. The window is already baked into renewal_queue itself
-- (20260805200000_renewal_cadence_years.sql: closed_won, non-archived
-- opp AND account, contract_end_date not null, and the cadence-shifted
-- end date BETWEEN current_date AND current_date + 120 days), and that
-- is deliberately left where it is rather than duplicated here.
--
-- Null handling matches too: JS `Number(null)` is 0 and SQL `sum()`
-- skips nulls, so a null current_arr contributes 0 either way; and
-- coalesce(...,0) reproduces `[].reduce(..., 0)` = 0 on an empty queue.
-- (In practice opportunities.amount is NOT NULL DEFAULT 0, so no row can
-- carry a null current_arr today.)
--
-- The two day-window arguments are NO-OPS for the current caller (it
-- passes neither). They exist because the two sibling KPIs — renewals_30
-- and renewals_60 — filter the SAME truncated fetch client-side with
-- `days_until_renewal !== null && >= 0 && <= N` and are therefore
-- exposed to the same truncation on their COUNTS. Those two are
-- deliberately NOT changed in this migration's commit (one thing at a
-- time), but the predicate below is shaped to match theirs exactly so
-- the follow-up is a pure call-site swap.
--
-- SECURITY INVOKER — the LANGUAGE SQL default, and load-bearing here:
-- renewal_queue is itself `security_invoker = on`
-- (20260707180000_renewal_queue_security_invoker.sql), so the caller's
-- RLS on opportunities + accounts still scopes the sum to exactly the
-- rows the client-side version could see. A DEFINER function would
-- silently widen this tile to the whole company.
--
-- EXECUTE is revoked from public + anon and granted to authenticated.
-- 20260817115000_function_grants_lockdown.sql now sets default
-- privileges that would do this automatically (and additionally grant
-- service_role), but the explicit statements stay for self-documentation
-- and so this file is correct read on its own.
--
-- Idempotent: create-or-replace + guarded grants.
-- ============================================================

begin;

create or replace function public.renewal_queue_arr_stats(
  p_days_until_from integer default null,
  p_days_until_to   integer default null
)
returns table (
  total     numeric,
  row_count bigint
)
language sql
stable
set search_path = public
as $$
  select
    coalesce(sum(rq.current_arr), 0)::numeric as total,
    count(*)::bigint                          as row_count
  from public.renewal_queue rq
  where (
      p_days_until_from is null
      or (rq.days_until_renewal is not null
          and rq.days_until_renewal >= p_days_until_from)
    )
    and (
      p_days_until_to is null
      or (rq.days_until_renewal is not null
          and rq.days_until_renewal <= p_days_until_to)
    );
$$;

comment on function public.renewal_queue_arr_stats(integer, integer) is
  'Server-side SUM(current_arr) + COUNT(*) over renewal_queue, optionally narrowed to a days_until_renewal window. Powers the "Total ARR at Risk" KPI, which previously fetched the whole view (PostgREST-capped at 1000 rows, no ORDER BY) and summed it in the browser. Both arguments null = the whole view, which is what that KPI does. SECURITY INVOKER so the caller RLS behind renewal_queue still applies.';

revoke execute on function public.renewal_queue_arr_stats(integer, integer) from public, anon;
grant  execute on function public.renewal_queue_arr_stats(integer, integer) to authenticated;

commit;

notify pgrst, 'reload schema';
