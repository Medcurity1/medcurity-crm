-- Phase: Test-account scoping for renewal automation.
--
-- Why:
--   Brayden wants to test the new automation against ONE account (his
--   personal test account) before turning the cron loose on real
--   customers. Without scoping, "Run Now" would attempt to generate
--   renewals for every closed-won across the org.
--
-- Mechanism:
--   * New column `renewal_automation_config.test_account_id uuid`
--     (nullable). When NULL → automation runs against all accounts
--     (production behavior). When NOT NULL → automation only generates
--     renewals for that single account.
--   * `generate_upcoming_renewals` honors the filter via an additional
--     `where a.id = v_config.test_account_id` clause when the column
--     is set.
--   * `v_renewal_audit` view also honors the filter so the preview UI
--     matches what the automation would actually do.
--
-- Data preservation:
--   * Additive only. Function signature unchanged. No DROPs.
--   * If test_account_id is NULL (the default), behavior matches the
--     previous migration exactly.

begin;

-- 1. Add the column.
alter table public.renewal_automation_config
  add column if not exists test_account_id uuid
    references public.accounts (id) on delete set null;

comment on column public.renewal_automation_config.test_account_id is
  'When set, the renewal automation only processes this single account. Used to dry-run the new logic against a designated test account before flipping cron live for the whole org. Set to NULL to resume processing all accounts.';

-- 2. Re-create generate_upcoming_renewals with the test_account_id filter.
-- Logic is identical to migration 20260508000003 except for the new
-- where clause inside the candidate-opps loop.

create or replace function public.generate_upcoming_renewals(
  triggered_by text default 'cron'
)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config           public.renewal_automation_config%rowtype;
  v_parent           record;
  v_new_opp_id       uuid;
  v_new_start        date;
  v_new_end          date;
  v_new_close        date;
  v_new_expected     date;
  v_new_name         text;
  v_new_year         integer;
  v_new_cycle        integer;
  v_new_length       integer;
  v_pullback_days    integer;
  v_requires_sig     boolean;
  v_is_cycle_wrap    boolean;
  v_auto_renew       boolean;
  v_created          integer := 0;
  v_skipped          integer := 0;
  v_run_id           bigint;
  v_err              text;
  v_effective_end    date;
  v_pull_reason      text;
begin
  select * into v_config from public.renewal_automation_config where id = 1;

  if not found or not v_config.enabled then
    return query select 0, 0;
    return;
  end if;

  insert into public.renewal_automation_runs (triggered_by)
  values (coalesce(triggered_by, 'cron'))
  returning id into v_run_id;

  begin
    for v_parent in
      select
        o.*,
        a.renewal_type            as account_renewal_type,
        a.auto_renew              as account_auto_renew,
        a.auto_renew_term_months  as account_auto_renew_term_months,
        a.every_other_year        as account_every_other_year,
        coalesce(
          o.contract_end_date,
          (o.close_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
        ) as effective_end_date
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.stage = 'closed_won'
        and coalesce(
              o.contract_end_date,
              (o.close_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
            ) between current_date
                  and current_date + (v_config.lookahead_days || ' days')::interval
        and (o.contract_end_date is not null or o.close_date is not null)
        and coalesce(o.one_time_project, false) = false
        -- Test-account scoping (NEW). When set, only that account is
        -- processed. NULL → process all accounts.
        and (v_config.test_account_id is null or a.id = v_config.test_account_id)
        and not exists (
          select 1 from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
            and child.archived_at is null
        )
    loop
      v_effective_end := v_parent.effective_end_date;

      -- ── Every-other-year: skip on odd cycles ───────────────────
      if v_parent.account_every_other_year then
        if coalesce(v_parent.cycle_count, 0) % 2 = 1 then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;

      -- ── Resolve auto_renew with renewal_type fallback ──────────
      v_auto_renew := coalesce(
        v_parent.account_auto_renew,
        case v_parent.account_renewal_type::text
          when 'full_auto_renew' then true
          when 'auto_renew'      then true
          when 'platform_only_auto_renew' then false
          when 'manual_renew'    then false
          when 'no_auto_renew'   then false
          else null
        end,
        false
      );

      v_is_cycle_wrap := (
        coalesce(v_parent.contract_length_months, 12) = 36
        and coalesce(v_parent.contract_year, 1) = 3
      );

      if v_auto_renew then
        v_pullback_days := v_config.pullback_days_auto_renew;
        v_requires_sig := false;
        v_pull_reason := 'auto-renew';
      elsif coalesce(v_parent.contract_length_months, 12) = 12 then
        v_pullback_days := v_config.pullback_days_signature_required;
        v_requires_sig := true;
        v_pull_reason := 'no auto-renew, 1-year contract — new signature required';
      elsif v_is_cycle_wrap then
        v_pullback_days := v_config.pullback_days_signature_required;
        v_requires_sig := true;
        v_pull_reason := 'no auto-renew, 3-year cycle wrap — new signature required';
      else
        v_pullback_days := v_config.pullback_days_auto_renew;
        v_requires_sig := false;
        v_pull_reason := 'no auto-renew, but inside existing 3-year commitment';
      end if;

      v_new_year   := 1;
      v_new_cycle  := null;
      v_new_length := coalesce(v_parent.contract_length_months, 12);

      if coalesce(v_parent.contract_length_months, 12) = 36 then
        v_new_cycle := coalesce(v_parent.cycle_count, 1);
        case coalesce(v_parent.contract_year, 1)
          when 1 then v_new_year := 2;
          when 2 then v_new_year := 3;
          when 3 then
            v_new_year := 1;
            v_new_cycle := coalesce(v_parent.cycle_count, 1) + 1;
            if v_auto_renew = true
               and v_parent.account_auto_renew_term_months is not null
            then
              v_new_length := v_parent.account_auto_renew_term_months;
            end if;
          else v_new_year := 1;
        end case;
      else
        v_new_year := 1;
        v_new_cycle := null;
      end if;

      v_new_start    := v_effective_end + interval '1 day';
      v_new_end      := (v_effective_end + interval '12 months')::date;

      if extract(month from v_effective_end) = 2
         and extract(day from v_effective_end) = 29
      then
        v_new_end := make_date(extract(year from v_new_end)::int, 3, 1);
      end if;

      v_new_expected := v_effective_end - v_pullback_days;
      v_new_close    := v_new_expected;

      if v_parent.contract_end_date is null then
        update public.opportunities
        set contract_end_date = v_effective_end
        where id = v_parent.id;
      end if;

      v_new_name := v_parent.name || ' (Renewal ' || to_char(v_new_start, 'YYYY') || ')';

      insert into public.opportunities (
        name, account_id, primary_contact_id, owner_user_id,
        original_sales_rep_id, assigned_assessor_id,
        team, kind, stage, amount, service_amount, product_amount,
        services_included, service_description, discount,
        payment_frequency, promo_code,
        contract_start_date, contract_end_date,
        contract_length_months, contract_year, cycle_count,
        expected_close_date, close_date, requires_new_signature,
        renewal_from_opportunity_id, auto_renewal,
        fte_range, fte_count, lead_source, created_by_automation, notes
      )
      values (
        v_new_name, v_parent.account_id, v_parent.primary_contact_id,
        coalesce(v_parent.assigned_assessor_id, v_parent.owner_user_id),
        v_parent.owner_user_id, v_parent.assigned_assessor_id,
        'renewals', 'renewal', 'lead',
        v_parent.amount, coalesce(v_parent.service_amount, 0),
        coalesce(v_parent.product_amount, 0),
        coalesce(v_parent.services_included, true),
        v_parent.service_description, v_parent.discount,
        v_parent.payment_frequency, v_parent.promo_code,
        v_new_start, v_new_end,
        v_new_length, v_new_year, v_new_cycle,
        v_new_expected, v_new_close, v_requires_sig,
        v_parent.id, v_auto_renew,
        v_parent.fte_range, v_parent.fte_count, v_parent.lead_source,
        true,
        format(
          'Auto-generated renewal from %s. Anchor: %s. Pull-back: %s days (%s). Year %s, cycle %s, length %s mo.',
          v_parent.name,
          to_char(v_effective_end, 'YYYY-MM-DD'),
          v_pullback_days::text,
          v_pull_reason,
          coalesce(v_new_year::text, '1'),
          coalesce(v_new_cycle::text, 'n/a'),
          v_new_length::text
        )
      )
      returning id into v_new_opp_id;

      insert into public.opportunity_products (
        opportunity_id, product_id, quantity, unit_price, discount_percent, total_price
      )
      select
        v_new_opp_id, product_id, quantity, unit_price, discount_percent, total_price
      from public.opportunity_products
      where opportunity_id = v_parent.id;

      v_created := v_created + 1;
    end loop;

    update public.renewal_automation_runs
    set finished_at = timezone('utc', now()),
        created_count = v_created,
        skipped_count = v_skipped
    where id = v_run_id;

    update public.renewal_automation_config
    set last_run_at = timezone('utc', now()),
        last_run_created_count = v_created,
        last_run_error = null,
        updated_at = timezone('utc', now())
    where id = 1;

  exception when others then
    v_err := sqlerrm;
    update public.renewal_automation_runs
    set finished_at = timezone('utc', now()),
        created_count = v_created,
        skipped_count = v_skipped,
        error_message = v_err
    where id = v_run_id;

    update public.renewal_automation_config
    set last_run_at = timezone('utc', now()),
        last_run_created_count = v_created,
        last_run_error = v_err,
        updated_at = timezone('utc', now())
    where id = 1;
    raise;
  end;

  return query select v_created, v_skipped;
end;
$$;

-- 3. Re-create v_renewal_audit so the preview also honors test_account_id.

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
  'Surfaces closed-won opps and accounts that the renewal automation cannot or will not act on. Honors renewal_automation_config.test_account_id when set. Six audit_category values: missing_renewal, missing_dates, missing_contract_year, every_other_year_skip, auto_renew_null, do_not_auto_renew.';

commit;
