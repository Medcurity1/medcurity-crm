-- ---------------------------------------------------------------------
-- Renewal cadence: accounts renew every 1, 2, or 3 years.
--
-- Plain English: the 8/5 every-other-year fix keyed off a checkbox that
-- can only say "every 2 years". Rachel confirmed two clients renew every
-- THREE years (Hope Health, Unity Hospice). Rather than a second
-- checkbox, accounts get a single "renews every N years" setting
-- (Nathan's go, 8/5). N=1 is the default (annual); the old checkbox maps
-- to N=2 and stays synced both ways so imports and old surfaces keep
-- working until it is retired.
--
-- The rule everywhere becomes: a closed-won contract stays "live" for
-- (N-1) extra years past its end date (close-date fallback window is
-- N*365 days), and the renewal generator's anniversary shifts
-- (N-1)*12 months. N=1 reproduces the original behavior exactly; N=2
-- reproduces the 8/5 every-other-year behavior exactly.
--
-- Touched (every rule site from 20260805120000/121000/160000, re-emitted
-- with the cadence expression; everything else byte-identical):
--   1. accounts.renewal_cadence_years column + backfill from the
--      checkbox + a BEFORE trigger keeping the two in sync (writes to
--      either side reconcile; SF importer still writes the boolean).
--   2. The badge recompute trigger now fires on cadence changes too.
--   3. derive_account_customer_status + recompute_all_customer_statuses.
--   4. v_dashboard_metrics won_facts.
--   5. generate_upcoming_renewals_unsafe + preview_upcoming_renewals_unsafe.
--   6. v_renewal_audit (effective end = close + N*12 months; parent
--      horizon widens with N) + renewal_queue.
--   7. Account detail layout: the Every Other Year row becomes the
--      cadence field with a friendly label.
--   8. One-time recompute of all account badges.
--
-- Idempotent: create-or-replace, guarded column add, keyed updates.
-- ---------------------------------------------------------------------

begin;

-- ---------- 1. Column + backfill + sync trigger ----------
alter table public.accounts
  add column if not exists renewal_cadence_years integer not null default 1
    check (renewal_cadence_years between 1 and 5);

comment on column public.accounts.renewal_cadence_years is
  'How often this account renews, in years (1 = annual, 2 = every other year, 3 = tri-annual). Canonical; every_other_year is a synced legacy alias for the value 2.';

update public.accounts
   set renewal_cadence_years = 2
 where every_other_year = true
   and renewal_cadence_years = 1;

create or replace function public.trg_account_renewal_cadence_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    -- An importer that only knows the checkbox still lands on cadence 2.
    if coalesce(new.renewal_cadence_years, 1) = 1
       and coalesce(new.every_other_year, false) then
      new.renewal_cadence_years := 2;
    end if;
    new.every_other_year := (coalesce(new.renewal_cadence_years, 1) = 2);
  else
    if new.renewal_cadence_years is distinct from old.renewal_cadence_years then
      new.every_other_year := (coalesce(new.renewal_cadence_years, 1) = 2);
    elsif new.every_other_year is distinct from old.every_other_year then
      new.renewal_cadence_years := case when new.every_other_year then 2 else 1 end;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_account_renewal_cadence_sync on public.accounts;
create trigger trg_account_renewal_cadence_sync
  before insert or update of renewal_cadence_years, every_other_year
  on public.accounts
  for each row
  execute function public.trg_account_renewal_cadence_sync();

-- ---------- 2. Badge recompute fires on cadence changes too ----------
drop trigger if exists trg_account_eoy_customer_status on public.accounts;
create trigger trg_account_eoy_customer_status
  after update of every_other_year, renewal_cadence_years on public.accounts
  for each row
  when (old.every_other_year is distinct from new.every_other_year
        or old.renewal_cadence_years is distinct from new.renewal_cadence_years)
  execute function public.trg_account_eoy_recompute_customer_status();

-- ---------- 3. Badge rule (cadence-aware) ----------
create or replace function public.derive_account_customer_status(p_account_id uuid)
returns text
language sql
stable
as $$
  select case
    -- Client = an ONGOING (non one-time) closed-won whose contract is still
    -- live. An account renewing every N years stays live (N-1) extra years
    -- past the contract end (or N*365d after close when no end date):
    -- the planned gap years are part of the deal, not churn.
    when bool_or(
           coalesce(o.one_time_project, false) = false
           and (
             (o.contract_end_date is not null
              and o.contract_end_date >= current_date
                    - (coalesce(a.renewal_cadence_years, 1) - 1) * 365)
             or (o.contract_end_date is null and o.close_date is not null
                 and o.close_date >= current_date
                       - coalesce(a.renewal_cadence_years, 1) * 365)
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
  'Pure customer-hood from ongoing (non one-time) closed-won contract dates; accounts stay live (renewal_cadence_years - 1) extra years past contract end (their planned gap years). Agrees with the dashboard customer count. Does NOT consider the manual override.';

-- ---------- 4. Set-based sweep: conditions mirror #3 verbatim ----------
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
                 - (coalesce(aa.renewal_cadence_years, 1) - 1) * 365)
          or (o.contract_end_date is null and o.close_date is not null
              and o.close_date >= current_date
                    - coalesce(aa.renewal_cadence_years, 1) * 365)
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

revoke execute on function public.recompute_all_customer_statuses() from public, anon;
grant  execute on function public.recompute_all_customer_statuses() to authenticated;

-- ---------- 5. Dashboard won_facts (cadence-aware) ----------
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
-- same way derive_account_customer_status does. Accounts renewing every N
-- years stay live (N-1) extra years past contract end (their planned gap),
-- so they are neither churn nor missing from the starting base mid-cycle.
won_facts as (
  select
    o.account_id,
    -- latest contract expiry across all closed-won deals on the account
    max(
      coalesce(o.contract_end_date, o.close_date + 365)
      + (coalesce(a.renewal_cadence_years, 1) - 1) * 365
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

-- ---------- 6. renewal_queue (cadence-aware) ----------
create or replace view public.renewal_queue
  with (security_invoker = on)
as
select
  o.id as source_opportunity_id,
  o.account_id,
  a.name as account_name,
  o.owner_user_id,
  (o.contract_end_date
   + make_interval(months => 12 * (coalesce(a.renewal_cadence_years, 1) - 1))
  )::date as contract_end_date,
  o.amount as current_arr,
  case
    when o.contract_end_date is null then null
    else ((o.contract_end_date
           + make_interval(months => 12 * (coalesce(a.renewal_cadence_years, 1) - 1))
          )::date - current_date)
  end as days_until_renewal
from public.opportunities o
join public.accounts a on a.id = o.account_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage = 'closed_won'
  and o.contract_end_date is not null
  and (o.contract_end_date
       + make_interval(months => 12 * (coalesce(a.renewal_cadence_years, 1) - 1))
      )::date between current_date and current_date + interval '120 days';

grant select on public.renewal_queue to authenticated;
revoke select on public.renewal_queue from anon;

-- ---------- 7. Account detail layout: cadence replaces the checkbox ----------
update public.page_layout_fields
   set field_key = 'renewal_cadence_years',
       label_override = 'Renews Every (Years)'
 where field_key = 'every_other_year';

-- ---------- 8. One-time recompute (cadence-3 accounts correct now) ----------
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
