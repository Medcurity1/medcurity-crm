-- Phase: Renewal-automation audit view.
--
-- Purpose:
--   Surface closed-won opportunities and accounts that the new renewal
--   automation can't (or won't) act on, so an admin can fix the data
--   without us having to grep logs or write ad-hoc queries each time.
--
--   The new automation is more aggressive than the SF version (it no
--   longer silently skips no_auto_renew accounts), but it still has
--   prerequisites: the parent opp needs enough date/length info to
--   compute a renewal, accounts must not be in an every-other-year
--   skip year, and the auto_renew flag drives the pull-back length.
--   Anything that fails those checks belongs in this audit.
--
-- Categories (column `audit_category`):
--   1. 'missing_renewal'        — closed-won opp from the last 18 months
--                                 whose contract_end_date is in the past
--                                 or near-future window AND has no live
--                                 child renewal yet AND isn't a
--                                 one-time-project. The automation
--                                 should have caught these on its next
--                                 run; if they keep showing up the
--                                 input data is the problem.
--   2. 'missing_dates'          — closed-won opp with NULL
--                                 contract_end_date AND NULL close_date,
--                                 so the automation can't compute when
--                                 to renew. Usually a SF import gap.
--   3. 'missing_contract_year'  — closed-won opp with
--                                 contract_length_months = 36 but
--                                 contract_year IS NULL. The cycle
--                                 walk needs the starting position.
--   4. 'every_other_year_skip'  — closed-won opp on an account flagged
--                                 every_other_year=true that the
--                                 automation will skip on the next run
--                                 because cycle_count is odd. Listed
--                                 so admins know it's intentional.
--   5. 'auto_renew_null'        — account with auto_renew IS NULL
--                                 (renewal_type backfill couldn't
--                                 determine yes/no). The automation
--                                 falls back to "no signature required"
--                                 (30-day pull-back); admin should
--                                 confirm.
--   6. 'do_not_auto_renew'      — account flagged do_not_auto_renew=true.
--                                 The automation skips these. Listed
--                                 for visibility, not because it's a
--                                 bug.
--
-- Read patterns:
--   * Admin renewal-automation page: SELECT * FROM v_renewal_audit
--     ORDER BY audit_category, account_name. Counts per category go
--     in a card row at the top of the page.
--   * Manual investigation: filter by audit_category, account_id, or
--     parent_opportunity_id.
--
-- Performance:
--   * View is uncached and recomputed each query. Acceptable: the
--     row counts are small (closed-wons in a recent window) and this
--     page is admin-only / rarely loaded.
--   * RLS is inherited from the underlying tables (opportunities,
--     accounts). We keep `security_invoker = on` so the caller's
--     permissions decide which rows they see — no privilege bump.

begin;

drop view if exists public.v_renewal_audit;

create view public.v_renewal_audit
  with (security_invoker = on)
as
with cfg as (
  select coalesce(lookahead_days, 120) as lookahead_days
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
  where o.archived_at is null
    and a.archived_at is null
    and o.stage = 'closed_won'
    and (o.close_date is null or o.close_date >= current_date - interval '18 months')
)
-- Category 1: should have a renewal generated, doesn't.
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
    'Closed-won opp ending %s has no renewal yet. Automation should pick it up; if not, check effective_end_date and one_time_project.',
    to_char(cw.effective_end_date, 'YYYY-MM-DD')
  )::text                                              as note
from closed_wons cw, cfg
where cw.has_live_renewal = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date <= current_date + (cfg.lookahead_days || ' days')::interval

union all

-- Category 2: closed-won with no usable date.
select
  'missing_dates'::text,
  cw.opportunity_id,
  cw.account_id,
  cw.account_name,
  cw.opportunity_name,
  cw.close_date,
  cw.contract_end_date,
  cw.effective_end_date,
  cw.contract_length_months,
  cw.contract_year,
  cw.cycle_count,
  cw.lifecycle_status::text,
  cw.renewal_type::text,
  cw.auto_renew,
  cw.every_other_year,
  cw.do_not_auto_renew,
  'Closed-won opp has neither contract_end_date nor close_date — automation cannot determine when to renew.'::text
from closed_wons cw
where cw.contract_end_date is null
  and cw.close_date is null

union all

-- Category 3: 36-month opp without a contract_year anchor.
select
  'missing_contract_year'::text,
  cw.opportunity_id,
  cw.account_id,
  cw.account_name,
  cw.opportunity_name,
  cw.close_date,
  cw.contract_end_date,
  cw.effective_end_date,
  cw.contract_length_months,
  cw.contract_year,
  cw.cycle_count,
  cw.lifecycle_status::text,
  cw.renewal_type::text,
  cw.auto_renew,
  cw.every_other_year,
  cw.do_not_auto_renew,
  '36-month contract without contract_year set — cycle walk (1→2→3→1) cannot start. Set contract_year on the parent opp.'::text
from closed_wons cw
where cw.contract_length_months = 36
  and cw.contract_year is null

union all

-- Category 4: every-other-year skip year (informational).
select
  'every_other_year_skip'::text,
  cw.opportunity_id,
  cw.account_id,
  cw.account_name,
  cw.opportunity_name,
  cw.close_date,
  cw.contract_end_date,
  cw.effective_end_date,
  cw.contract_length_months,
  cw.contract_year,
  cw.cycle_count,
  cw.lifecycle_status::text,
  cw.renewal_type::text,
  cw.auto_renew,
  cw.every_other_year,
  cw.do_not_auto_renew,
  'Account is every_other_year and current cycle_count is odd — automation will skip this year by design.'::text
from closed_wons cw
where cw.every_other_year = true
  and coalesce(cw.cycle_count, 0) % 2 = 1
  and cw.has_live_renewal = false

union all

-- Category 5: account-level auto_renew unknown.
select
  'auto_renew_null'::text,
  null::uuid                                           as parent_opportunity_id,
  a.id                                                 as account_id,
  a.name                                               as account_name,
  null::text                                           as opportunity_name,
  null::date                                           as close_date,
  null::date                                           as contract_end_date,
  null::date                                           as effective_end_date,
  null::integer                                        as contract_length_months,
  null::integer                                        as contract_year,
  null::integer                                        as cycle_count,
  a.lifecycle_status::text,
  a.renewal_type::text,
  a.auto_renew,
  a.every_other_year,
  a.do_not_auto_renew,
  'Account has no auto_renew value (renewal_type was NULL or unmapped). Automation falls back to 30-day pull-back; admin should confirm.'::text
from public.accounts a
where a.archived_at is null
  and a.auto_renew is null
  and a.lifecycle_status = 'active'

union all

-- Category 6: do_not_auto_renew override (informational).
select
  'do_not_auto_renew'::text,
  null::uuid,
  a.id,
  a.name,
  null::text,
  null::date,
  null::date,
  null::date,
  null::integer,
  null::integer,
  null::integer,
  a.lifecycle_status::text,
  a.renewal_type::text,
  a.auto_renew,
  a.every_other_year,
  a.do_not_auto_renew,
  'Account flagged do_not_auto_renew — automation will skip all renewals on this account regardless of auto_renew.'::text
from public.accounts a
where a.archived_at is null
  and a.do_not_auto_renew = true
  and a.lifecycle_status = 'active';

comment on view public.v_renewal_audit is
  'Surfaces closed-won opps and accounts that the renewal automation cannot or will not act on. Six audit_category values: missing_renewal, missing_dates, missing_contract_year, every_other_year_skip, auto_renew_null, do_not_auto_renew. Used by the admin renewal-automation page.';

commit;
