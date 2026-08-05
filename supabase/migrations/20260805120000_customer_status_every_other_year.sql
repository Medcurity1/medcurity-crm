-- ---------------------------------------------------------------------
-- Every-other-year clients stay "Customer" through their off year.
--
-- Plain English: some clients (bi-annual SRAs) buy every OTHER year on
-- purpose. The Account Status rule only counted a client as current while
-- a contract was inside its dates, so these clients flipped to "Former
-- Customer" for the entire gap year even though they are current clients
-- with their next engagement already planned. Rachel flagged it 2026-08-05
-- (live example: North Sound Behavioral Health: SRA won Dec 2024,
-- contract ended Dec 2025, next SRA proposed for Dec 2026, badge said
-- Former Customer). The accounts.every_other_year flag already exists;
-- the status rule just never looked at it.
--
-- The rule change (one sentence): when an account is flagged
-- every_other_year, its closed-won contracts count as "live" for 12 extra
-- months past their end date (or 730 days after close when no end date is
-- set), covering the planned gap year.
--
-- Touched here (every copy of the live-contract test that feeds status):
--   1. derive_account_customer_status(uuid) : the badge rule itself
--      (last defined 20260630000004; now joins accounts for the flag).
--   2. recompute_all_customer_statuses()    : the set-based daily sweep
--      (last defined 20260727150000; conditions must mirror #1 verbatim).
--      Guard, override auto-clear, and derived_at semantics unchanged.
--   3. v_dashboard_metrics won_facts         : dashboard starting/churn
--      tiles (last defined 20260625000016) so NRR/churn agree with the
--      badge: a gap-year EOY client is not churn.
--   4. NEW trigger: recompute the badge immediately when someone flips
--      accounts.every_other_year (today it would wait for the daily sweep).
--   5. One-time re-backfill through recompute so existing accounts correct
--      themselves now, honoring overrides, writing derived_at on change.
--
-- Deliberately NOT touched:
--   - recompute_account_customer_status(uuid): calls derive(), no copy of
--     the rule inside it: inherits the fix.
--   - v_marketing_suppression: its customer bucket is
--     (active_won OR customer_status = 'client'), so the corrected column
--     flows through without rebuilding the view.
--   - kpi-registry "Active Customers", v_lost_customers_qtd, renewal
--     gates: all read accounts.customer_status: inherit the fix.
--
-- Idempotent: create-or-replace + a re-runnable backfill loop.
-- ---------------------------------------------------------------------

begin;

-- 1. The badge rule, now every-other-year aware ------------------------
create or replace function public.derive_account_customer_status(p_account_id uuid)
returns text
language sql
stable
as $$
  select case
    -- Client = an ONGOING (non one-time) closed-won whose contract is still
    -- live. every_other_year accounts get 12 extra months of "live" past the
    -- contract end (or 730d instead of 365d after close when no end date):
    -- their gap year is part of the deal, not churn.
    when bool_or(
           coalesce(o.one_time_project, false) = false
           and (
             (o.contract_end_date is not null
              and o.contract_end_date >= current_date
                    - case when a.every_other_year then 365 else 0 end)
             or (o.contract_end_date is null and o.close_date is not null
                 and o.close_date >= current_date
                       - case when a.every_other_year then 730 else 365 end)
           )
         ) then 'client'
    -- Bought before (including one-time projects), nothing ongoing-live now.
    when count(*) > 0 then 'former_client'
    else 'prospect'
  end
  from public.opportunities o
  join public.accounts a on a.id = o.account_id
  where o.account_id = p_account_id
    and o.stage = 'closed_won'
    and o.archived_at is null;
$$;

comment on function public.derive_account_customer_status(uuid) is
  'Pure customer-hood from ongoing (non one-time) closed-won contract dates; every_other_year accounts stay live 12 months past contract end (their gap year). Agrees with the dashboard customer count. Does NOT consider the manual override.';

-- 2. Set-based sweep: conditions mirror #1 verbatim --------------------
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
          (o.contract_end_date is not null
           and o.contract_end_date >= current_date
                 - case when aa.every_other_year then 365 else 0 end)
          or (o.contract_end_date is null and o.close_date is not null
              and o.close_date >= current_date
                    - case when aa.every_other_year then 730 else 365 end)
        )
      ) as has_live_ongoing,
      max(o.created_at) filter (
        where coalesce(o.one_time_project, false) = false
      ) as last_ongoing_won_created_at
    from public.opportunities o
    join public.accounts aa on aa.id = o.account_id
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

-- create-or-replace keeps ACLs, but re-assert the 20260727150000 posture.
revoke execute on function public.recompute_all_customer_statuses() from public, anon;
grant  execute on function public.recompute_all_customer_statuses() to authenticated;

-- 3. Dashboard won_facts: gap-year EOY clients are not churn -----------
create or replace view public.v_dashboard_metrics as
with arr as (
  -- True rolling-365 (today-anchored). Mirrors the formula in
  -- v_dashboard_arr_financial so both dashboards agree.
  select coalesce(sum(o.amount), 0)::numeric(14,2) as current_arr
  from public.opportunities o
  where o.archived_at is null
    and o.close_date is not null
    and o.close_date > (current_date - interval '365 days')::date
    and coalesce(o.one_time_project, false) = false
    and o.stage = 'closed_won'
),
new_cust as (
  select count(*)::int as new_customers_qtd,
         coalesce(sum(amount), 0) as new_customer_amount_qtd
  from public.v_new_customers_qtd
),
renewals as (
  select count(*)::int as renewals_qtd,
         coalesce(sum(amount), 0) as renewals_amount_qtd
  from public.v_renewals_qtd
),
pipeline as (
  select count(*)::int as pipeline_count,
         coalesce(sum(amount), 0) as pipeline_amount,
         coalesce(sum(weighted_amount), 0) as pipeline_weighted_amount
  from public.v_active_pipeline
),
lost as (
  select count(*)::int as lost_customers_qtd,
         coalesce(sum(amount), 0) as lost_customer_amount_qtd
  from public.v_lost_customers_qtd
),
sql_counts as (
  select count(*)::int as sql_qtd
  from public.v_sql_accounts
  where sql_date between public.current_fiscal_quarter_start()
                     and public.current_fiscal_quarter_end()
),
mql_totals as (
  select
    (select count(*)::int from public.v_mql_leads_qtd)                                  as mql_leads_qtd,
    (select count(*)::int from public.v_mql_contacts
       where mql_date between public.current_fiscal_quarter_start()
                          and public.current_fiscal_quarter_end())                      as mql_contacts_qtd,
    (select count(distinct email)::int from (
        select email from public.v_mql_leads_qtd where email is not null
        union
        select email from public.v_mql_contacts
        where mql_date between public.current_fiscal_quarter_start()
                           and public.current_fiscal_quarter_end()
        and email is not null
    ) u)                                                                                as mql_unique_qtd
),
-- Per-account closed-won contract facts, used to derive customer-hood the
-- same way derive_account_customer_status does. every_other_year accounts
-- stay live 12 extra months past contract end (their planned gap year), so
-- they are neither churn nor missing from the starting base in an off year.
won_facts as (
  select
    o.account_id,
    -- latest contract expiry across all closed-won deals on the account
    max(
      coalesce(o.contract_end_date, o.close_date + 365)
      + case when a.every_other_year then 365 else 0 end
    ) as latest_contract_end
  from public.opportunities o
  join public.accounts a on a.id = o.account_id
  where o.stage = 'closed_won'
    and o.archived_at is null
    and o.account_id is not null
    and coalesce(o.one_time_project, false) = false
  group by o.account_id
),
-- The customer base AT THE START of the current fiscal quarter: accounts
-- that had a closed-won BEFORE the quarter (valued at that most-recent
-- pre-quarter amount) AND whose latest contract still reached the quarter
-- start (live at quarter start). `starting` and `churn` both read off this
-- one set so churn is, by construction, a subset of starting.
q_start_base as (
  select
    a.id              as account_id,
    snap.amount       as snapshot_amount,
    wf.latest_contract_end
  from public.accounts a
  join won_facts wf on wf.account_id = a.id
  -- CROSS JOIN LATERAL (not LEFT): an account with no closed-won BEFORE the
  -- quarter produces zero rows and is dropped — i.e. it was not a customer at
  -- quarter start, so it belongs in neither starting nor churn.
  cross join lateral (
    select o.amount
    from public.opportunities o
    where o.account_id = a.id
      and o.stage = 'closed_won'
      and o.archived_at is null
      and coalesce(o.one_time_project, false) = false
      and o.close_date < public.current_fiscal_quarter_start()
    order by o.close_date desc, o.id desc
    limit 1
  ) snap
  where a.archived_at is null
    and wf.latest_contract_end >= public.current_fiscal_quarter_start()  -- still live at quarter start
),
starting as (
  select
    coalesce(count(*), 0)::int            as starting_customers,
    coalesce(sum(snapshot_amount), 0)     as starting_arr
  from q_start_base
),
churn as (
  -- A starting customer whose latest subscription LAPSED during the quarter
  -- (and is not live now). Strict subset of q_start_base, valued at the same
  -- pre-quarter snapshot, so churn never exceeds starting on count or dollars.
  select
    coalesce(count(*), 0)::int            as churn_customers_qtd,
    coalesce(sum(snapshot_amount), 0)     as churn_amount_qtd
  from q_start_base
  where latest_contract_end < current_date
    and latest_contract_end between public.current_fiscal_quarter_start()
                                and public.current_fiscal_quarter_end()
)
select
  now()                             as computed_at,
  public.current_fiscal_quarter_start() as fiscal_quarter_start,
  public.current_fiscal_quarter_end()   as fiscal_quarter_end,
  public.fiscal_period_label(public.current_fiscal_quarter_start()) as fiscal_period,
  coalesce((select current_arr from arr), 0)                as current_arr,
  (select new_customers_qtd from new_cust)                  as new_customers_qtd,
  (select new_customer_amount_qtd from new_cust)            as new_customer_amount_qtd,
  (select renewals_qtd from renewals)                       as renewals_qtd,
  (select renewals_amount_qtd from renewals)                as renewals_amount_qtd,
  (select pipeline_count from pipeline)                     as pipeline_count,
  (select pipeline_amount from pipeline)                    as pipeline_amount,
  (select pipeline_weighted_amount from pipeline)           as pipeline_weighted_amount,
  (select lost_customers_qtd from lost)                     as lost_customers_qtd,
  (select lost_customer_amount_qtd from lost)               as lost_customer_amount_qtd,
  (select starting_customers from starting)                 as starting_customers,
  (select starting_arr from starting)                       as starting_arr,
  (select churn_customers_qtd from churn)                   as churn_customers_qtd,
  (select churn_amount_qtd from churn)                      as churn_amount_qtd,
  case
    when (select starting_customers from starting) > 0
      then (1 - (select churn_customers_qtd from churn)::numeric
                / (select starting_customers from starting)::numeric) * 100
    else null
  end                                                        as nrr_by_customer_legacy_pct,
  case
    when (select starting_arr from starting) > 0
      then (1 - (select churn_amount_qtd from churn)
                / nullif((select starting_arr from starting), 0)) * 100
    else null
  end                                                        as nrr_by_dollar_legacy_pct,
  case
    when (select starting_customers from starting) > 0
      then ((select starting_customers from starting) - (select churn_customers_qtd from churn))::numeric
           / (select starting_customers from starting)::numeric * 100
    else null
  end                                                        as nrr_by_customer_true_pct,
  case
    when (select starting_arr from starting) > 0
      then ((select starting_arr from starting) - (select churn_amount_qtd from churn))::numeric
           / nullif((select starting_arr from starting), 0) * 100
    else null
  end                                                        as nrr_by_dollar_true_pct,
  (select sql_qtd from sql_counts)                           as sql_qtd,
  (select mql_leads_qtd from mql_totals)                     as mql_leads_qtd,
  (select mql_contacts_qtd from mql_totals)                  as mql_contacts_qtd,
  (select mql_unique_qtd from mql_totals)                    as mql_unique_qtd;

comment on view public.v_dashboard_metrics is
  'Single-row scalar metrics powering the Team Dashboard KPI tiles. current_arr is true today-anchored rolling-365 (matches v_dashboard_arr_financial.arr).';

-- NOTE: do NOT re-grant anon. 20260616000010 deliberately revoked anon SELECT
-- on this KPI view (it carries company financials); CREATE OR REPLACE preserves
-- existing grants, so we grant only to authenticated and re-assert the revoke
-- to undo any anon grant the base view's history may have left.
grant select on public.v_dashboard_metrics to authenticated;
revoke select on public.v_dashboard_metrics from anon;

-- 4. Flip the flag, fix the badge now (not tomorrow's sweep) -----------
create or replace function public.trg_account_eoy_recompute_customer_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.recompute_account_customer_status(new.id);
  exception when others then
    raise warning 'customer_status recompute failed for account %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_account_eoy_customer_status on public.accounts;
create trigger trg_account_eoy_customer_status
  after update of every_other_year on public.accounts
  for each row
  when (old.every_other_year is distinct from new.every_other_year)
  execute function public.trg_account_eoy_recompute_customer_status();

-- 5. One-time re-backfill so existing accounts correct themselves now --
do $$
declare
  r record;
begin
  for r in select id from public.accounts loop
    perform public.recompute_account_customer_status(r.id);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
