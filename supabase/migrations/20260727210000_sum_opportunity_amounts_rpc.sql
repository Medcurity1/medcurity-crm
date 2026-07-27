-- ============================================================
-- Home KPIs: server-side opportunity-amount sum (docket 2026-07-22 item (d),
-- the last unstarted piece of the prod RAM/performance follow-ups).
--
-- kpi-registry.ts's fetchAllOppAmounts() paged EVERY matching opportunity's
-- amount to the browser (1,000 rows/request, up to 50,000) purely to add
-- them up client-side. Three KPI tiles use it — My Open Pipeline, Revenue
-- Starting This Quarter, Team Total Pipeline — and Home renders them on
-- every load, for every user. That is the whole opportunities table crossing
-- the wire several times a day per rep, and it grows with the pipeline.
--
-- One parameterized SUM covers all three filter shapes:
--   my_open_pipeline          → owner + open_only
--   revenue_starting_quarter  → owner + stage='closed_won' + contract-start window
--   team_pipeline             → open_only (no owner)
--
-- SECURITY INVOKER (the default — deliberately NOT definer): the caller's
-- RLS on opportunities still applies, so each user sums exactly the rows the
-- paged client-side version let them see. Behaviour is identical; only the
-- transport changes.
--
-- Idempotent: create-or-replace + guarded grants.
-- ============================================================

begin;

create or replace function public.sum_opportunity_amounts(
  p_owner_user_id        uuid    default null,
  p_open_only            boolean default false,
  p_stage                text    default null,
  p_contract_start_from  date    default null,
  p_contract_start_to    date    default null
)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(o.amount), 0)::numeric
  from public.opportunities o
  where o.archived_at is null
    and (p_owner_user_id is null or o.owner_user_id = p_owner_user_id)
    and (not p_open_only or o.stage not in ('closed_won', 'closed_lost'))
    and (p_stage is null or o.stage::text = p_stage)
    and (p_contract_start_from is null or o.contract_start_date >= p_contract_start_from)
    and (p_contract_start_to   is null or o.contract_start_date <  p_contract_start_to);
$$;

comment on function public.sum_opportunity_amounts(uuid, boolean, text, date, date) is
  'Server-side SUM(amount) for the Home KPI tiles — replaces paging every opportunity row to the browser. SECURITY INVOKER so caller RLS applies.';

revoke execute on function public.sum_opportunity_amounts(uuid, boolean, text, date, date) from public, anon;
grant  execute on function public.sum_opportunity_amounts(uuid, boolean, text, date, date) to authenticated;

commit;

notify pgrst, 'reload schema';
