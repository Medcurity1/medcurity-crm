-- Tighten v_renewal_audit so its 'missing_renewal' rows match what the
-- automation will actually create on the next run.
--
-- Bug: the previous version only required
--   effective_end_date <= current_date + lookahead_days
-- with no lower bound. That made past-due closed-won opps show up under
-- "Renewals to be created" in the preview, even though
-- generate_upcoming_renewals filters
--   effective_end_date BETWEEN current_date AND current_date + lookahead_days
-- and would skip them.
--
-- Fix:
--   * missing_renewal now requires effective_end_date >= current_date
--   * New category 'past_due_no_renewal' surfaces closed-won opps that
--     have already passed their end date without a child renewal. They
--     are NOT actionable by the automation in its current shape — the
--     admin needs to either backfill the renewal manually or extend
--     lookahead / fix end dates.
--
-- No DROPs; column list is unchanged.

begin;

drop view if exists public.v_renewal_audit;

create view public.v_renewal_audit
  with (security_invoker = on)
as
with cfg as (
  select
    coalesce(lookahead_days, 120) as lookahead_days,
    test_account_id
  from public.renewal_automation_config
  where id = 1
),
closed_wons as (
  select
    o.id                         as opportunity_id,
    o.account_id,
    o.name                       as opportunity_name,
    o.stage,
    o.close_date,
    o.expected_close_date,
    o.contract_start_date,
    o.contract_end_date,
    o.contract_length_months,
    o.contract_year,
    o.cycle_count,
    o.one_time_project,
    a.name                       as account_name,
    a.lifecycle_status,
    a.renewal_type,
    a.auto_renew,
    a.every_other_year,
    a.do_not_auto_renew,
    coalesce(
      o.contract_end_date,
      (o.close_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
    ) as effective_end_date,
    exists (
      select 1
      from public.opportunities child
      where child.renewal_from_opportunity_id = o.id
        and child.archived_at is null
    ) as has_live_renewal
  from public.opportunities o
  join public.accounts a on a.id = o.account_id
  cross join cfg
  where o.archived_at is null
    and a.archived_at is null
    and o.stage = 'closed_won'
    and (o.close_date is null or o.close_date >= current_date - interval '18 months')
    and (cfg.test_account_id is null or a.id = cfg.test_account_id)
)
-- 1. WILL be created on the next run — matches the function's filter.
select
  'missing_renewal'::text                              as audit_category,
  cw.opportunity_id                                    as parent_opportunity_id,
  cw.account_id,
  cw.account_name,
  cw.opportunity_name,
  cw.close_date,
  cw.contract_end_date,
  cw.effective_end_date,
  cw.contract_length_months,
  cw.contract_year,
  cw.cycle_count,
  cw.lifecycle_status::text                            as lifecycle_status,
  cw.renewal_type::text                                as renewal_type,
  cw.auto_renew,
  cw.every_other_year,
  cw.do_not_auto_renew,
  format(
    'Ends %s — inside the %s-day lookahead. Will be created on the next run.',
    to_char(cw.effective_end_date, 'YYYY-MM-DD'),
    (select lookahead_days from cfg)::text
  )::text                                              as note
from closed_wons cw, cfg
where cw.has_live_renewal = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date >= current_date
  and cw.effective_end_date <= current_date + (cfg.lookahead_days || ' days')::interval

union all

-- 2. Past-due closed-won with no renewal — NOT actionable by the
-- automation (out of window). Listed so an admin can backfill manually
-- or extend lookahead.
select
  'past_due_no_renewal'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  format(
    'Ends %s — already past due. Outside automation window. Backfill manually or extend lookahead_days.',
    to_char(cw.effective_end_date, 'YYYY-MM-DD')
  )::text
from closed_wons cw
where cw.has_live_renewal = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date < current_date

union all

select
  'missing_dates'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  'Closed-won opp has neither contract_end_date nor close_date — automation cannot determine when to renew.'::text
from closed_wons cw
where cw.contract_end_date is null
  and cw.close_date is null

union all

select
  'missing_contract_year'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  '36-month contract without contract_year set — cycle walk (1→2→3→1) cannot start. Set contract_year on the parent opp.'::text
from closed_wons cw
where cw.contract_length_months = 36
  and cw.contract_year is null

union all

select
  'every_other_year_skip'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  'Account is every_other_year and current cycle_count is odd — automation will skip this year by design.'::text
from closed_wons cw
where cw.every_other_year = true
  and coalesce(cw.cycle_count, 0) % 2 = 1
  and cw.has_live_renewal = false

union all

select
  'auto_renew_null'::text,
  null::uuid, a.id, a.name, null::text,
  null::date, null::date, null::date,
  null::integer, null::integer, null::integer,
  a.lifecycle_status::text, a.renewal_type::text,
  a.auto_renew, a.every_other_year, a.do_not_auto_renew,
  'Account has no auto_renew value (renewal_type was NULL or unmapped). Automation falls back to 30-day pull-back; admin should confirm.'::text
from public.accounts a
cross join cfg
where a.archived_at is null
  and a.auto_renew is null
  and a.lifecycle_status = 'customer'
  and (cfg.test_account_id is null or a.id = cfg.test_account_id)

union all

select
  'do_not_auto_renew'::text,
  null::uuid, a.id, a.name, null::text,
  null::date, null::date, null::date,
  null::integer, null::integer, null::integer,
  a.lifecycle_status::text, a.renewal_type::text,
  a.auto_renew, a.every_other_year, a.do_not_auto_renew,
  'Account flagged do_not_auto_renew — automation will skip all renewals on this account regardless of auto_renew.'::text
from public.accounts a
cross join cfg
where a.archived_at is null
  and a.do_not_auto_renew = true
  and a.lifecycle_status = 'customer'
  and (cfg.test_account_id is null or a.id = cfg.test_account_id);

comment on view public.v_renewal_audit is
  'Surfaces closed-won opps and accounts and what the renewal automation will do with them on the next run. Honors renewal_automation_config.test_account_id when set. Seven audit_category values: missing_renewal (will be created), past_due_no_renewal (out of window, needs admin action), missing_dates, missing_contract_year, every_other_year_skip, auto_renew_null, do_not_auto_renew.';

commit;
