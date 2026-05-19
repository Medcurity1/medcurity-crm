-- preview_upcoming_renewals()
--
-- Why this exists:
--   The "0 will create" surprise. Users see a count and have no way
--   to ask the system "which opps did you check, and why was each
--   one in or out?" The existing v_renewal_audit uses
--   effective_end_date = coalesce(contract_end_date, close_date + length)
--   which is DIFFERENT from what generate_upcoming_renewals actually
--   checks: (o.close_date + interval '12 months')::date. So an opp
--   whose contract_end_date is 120 days out but close_date is null
--   (or far in the past/future) will show up under "missing_renewal"
--   in the audit view but NOT get acted on by the function.
--
--   This RPC mirrors the function's WHERE clause exactly, then
--   classifies every closed-won opp on the (test_account_id when
--   set, else any) account into one of:
--
--     'will_create'                — passes every filter; function
--                                    will create a renewal next run.
--     'anniversary_outside_window' — anniversary is before today or
--                                    beyond today + lookahead.
--     'has_live_renewal'           — child renewal already exists.
--     'account_not_active'         — a.status != 'active'.
--     'account_do_not_auto_renew'  — account flagged.
--     'one_time_project'           — opp flagged one_time_project.
--     'no_close_date'              — close_date is null; function
--                                    requires it.
--     'archived'                   — opp or account archived.
--     'not_test_account'           — test_account_id is set and this
--                                    opp's account doesn't match.
--                                    (Only emitted when test mode is
--                                    on; hidden otherwise.)
--
--   Plus the computed anniversary date and days-until-anniversary
--   so you can see WHY the window check failed.
--
-- Read-only. Inherits RLS via security_invoker. Same shape as the
-- function so the admin UI can show "what will run" without running.

begin;

drop function if exists public.preview_upcoming_renewals();

create or replace function public.preview_upcoming_renewals()
returns table (
  status                  text,
  parent_opportunity_id   uuid,
  parent_opportunity_name text,
  account_id              uuid,
  account_name            text,
  account_status          text,
  close_date              date,
  contract_end_date       date,
  contract_length_months  integer,
  contract_year           integer,
  cycle_count             integer,
  one_time_project        boolean,
  do_not_auto_renew       boolean,
  archived                boolean,
  computed_anniversary    date,
  days_until_anniversary  integer,
  lookahead_days          integer,
  test_account_id         uuid,
  reason                  text
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select
      coalesce(c.lookahead_days, 120) as lookahead_days,
      c.test_account_id
    from public.renewal_automation_config c
    where c.id = 1
  ),
  -- Every closed-won opp + the precomputed anniversary using the
  -- SAME formula the live function uses.
  candidates as (
    select
      o.id                             as opportunity_id,
      o.name                           as opportunity_name,
      o.account_id,
      o.close_date,
      o.contract_end_date,
      o.contract_length_months,
      o.contract_year,
      o.cycle_count,
      o.one_time_project,
      o.archived_at,
      a.name                           as account_name,
      a.status::text                   as account_status,
      a.do_not_auto_renew,
      a.archived_at                    as account_archived_at,
      case
        when o.close_date is null then null
        when extract(month from o.close_date) = 2
         and extract(day   from o.close_date) = 29
        then make_date(
          extract(year from o.close_date)::int + 1,
          3, 1
        )
        else (o.close_date + interval '12 months')::date
      end                              as anniversary,
      exists (
        select 1
        from public.opportunities child
        where child.renewal_from_opportunity_id = o.id
          and child.archived_at is null
      )                                as has_live_renewal
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
    where o.stage = 'closed_won'
  )
  select
    -- Status: pick the FIRST disqualifying reason in order of how
    -- the function would short-circuit. 'will_create' only if all
    -- filters pass.
    case
      when c.archived_at is not null or c.account_archived_at is not null
                                                                then 'archived'
      when (select test_account_id from cfg) is not null
       and c.account_id <> (select test_account_id from cfg)    then 'not_test_account'
      when c.close_date is null                                 then 'no_close_date'
      when c.account_status <> 'active'                         then 'account_not_active'
      when coalesce(c.do_not_auto_renew, false)                 then 'account_do_not_auto_renew'
      when coalesce(c.one_time_project, false)                  then 'one_time_project'
      when c.has_live_renewal                                   then 'has_live_renewal'
      when c.anniversary <  current_date                        then 'anniversary_outside_window'
      when c.anniversary >  current_date
                          + ((select lookahead_days from cfg) || ' days')::interval
                                                                then 'anniversary_outside_window'
      else 'will_create'
    end                                                          as status,
    c.opportunity_id,
    c.opportunity_name,
    c.account_id,
    c.account_name,
    c.account_status,
    c.close_date,
    c.contract_end_date,
    c.contract_length_months,
    c.contract_year,
    c.cycle_count,
    coalesce(c.one_time_project, false)                          as one_time_project,
    coalesce(c.do_not_auto_renew, false)                         as do_not_auto_renew,
    (c.archived_at is not null or c.account_archived_at is not null) as archived,
    c.anniversary                                                as computed_anniversary,
    case when c.anniversary is null then null
         else (c.anniversary - current_date)::integer end        as days_until_anniversary,
    (select lookahead_days from cfg)                             as lookahead_days,
    (select test_account_id from cfg)                            as test_account_id,
    case
      when c.archived_at is not null
        then 'Parent opportunity is archived.'
      when c.account_archived_at is not null
        then 'Account is archived.'
      when (select test_account_id from cfg) is not null
       and c.account_id <> (select test_account_id from cfg)
        then 'Test mode is on and this opp''s account is not the configured test_account_id.'
      when c.close_date is null
        then 'Parent opportunity has no close_date. Anniversary cannot be computed.'
      when c.account_status <> 'active'
        then format('Account status is "%s", not "active".', c.account_status)
      when coalesce(c.do_not_auto_renew, false)
        then 'Account has do_not_auto_renew = true.'
      when coalesce(c.one_time_project, false)
        then 'Parent opportunity is flagged one_time_project = true.'
      when c.has_live_renewal
        then 'A live child renewal already exists (renewal_from_opportunity_id = this opp).'
      when c.anniversary < current_date
        then format(
          'Anniversary %s is in the past (%s days ago). The function only acts on anniversaries between today and today + lookahead_days.',
          to_char(c.anniversary, 'YYYY-MM-DD'),
          (current_date - c.anniversary)::text
        )
      when c.anniversary > current_date + ((select lookahead_days from cfg) || ' days')::interval
        then format(
          'Anniversary %s is %s days away — beyond the %s-day lookahead. Move close_date earlier or raise lookahead_days.',
          to_char(c.anniversary, 'YYYY-MM-DD'),
          (c.anniversary - current_date)::text,
          (select lookahead_days from cfg)::text
        )
      else format(
        'Will create a renewal on the next run. Anniversary %s is %s days away.',
        to_char(c.anniversary, 'YYYY-MM-DD'),
        (c.anniversary - current_date)::text
      )
    end                                                          as reason
  from candidates c
  -- Hide 'not_test_account' rows when test mode is on — they would
  -- swamp the preview with every other account's closed-won.
  where not (
    (select test_account_id from cfg) is not null
    and c.account_id <> (select test_account_id from cfg)
  )
  order by
    case
      when c.archived_at is not null or c.account_archived_at is not null then 9
      when c.close_date is null                                           then 8
      when c.account_status <> 'active'                                   then 7
      when coalesce(c.do_not_auto_renew, false)                           then 6
      when coalesce(c.one_time_project, false)                            then 5
      when c.has_live_renewal                                             then 4
      when c.anniversary < current_date                                   then 3
      when c.anniversary > current_date
                         + ((select lookahead_days from cfg) || ' days')::interval
                                                                          then 2
      else 1  -- 'will_create' first
    end,
    c.anniversary nulls last,
    c.opportunity_name;
$$;

grant execute on function public.preview_upcoming_renewals() to authenticated;

notify pgrst, 'reload schema';

commit;
