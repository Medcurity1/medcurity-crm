-- Renewal automation: simplify the model.
--
-- New rule:
--   * Anchor every renewal on the parent's `close_date + 12 months`.
--   * Whatever the parent's close_date is (manually pulled back by sales,
--     pulled back by the old SF flow, or the literal signature date)
--     gets inherited forward unchanged. Same calendar date forever, no
--     drift.
--   * No pullback math inside the function. The "pull back the date"
--     logic was always trying to compensate for sales reps wanting the
--     opp to appear in the pipeline 30/60 days before the customer's
--     true anniversary. That's now a sales-side concern: the rep enters
--     the close_date they want to work to (defaults to anniversary on
--     close-won; they can edit). Automation just copies it forward.
--   * 3-year contracts still walk contract_year 1→2→3→1 with cycle_count
--     increments at the wrap, purely for visibility — not for date math.
--   * 60-day signature warning task: when an account is NOT on
--     auto_renew, the function creates a `task` activity due 60 days
--     before the new opp's close_date. The opp owner is the task owner.
--     This replaces the date-pullback as the way sales gets early
--     warning that a new contract is needed.
--
-- Removed:
--   * `effective_end_date = coalesce(contract_end_date, close_date + length)`
--     math. `contract_end_date` is now display-only and never read by
--     automation.
--   * `pullback_days_*` config — still on the config table for now
--     (no DROP) but no longer used in the function. Will be cleaned up
--     in a later migration.
--   * The 3-year "-1 month for Year 2" SF-era hack.
--   * The cycle-wrap pullback branch for sig-required 3yr.
--
-- Idempotency: unchanged. Child opps still get
-- `renewal_from_opportunity_id` and the function's loop skips parents
-- that already have a live child.
--
-- Test-account scoping: unchanged. `renewal_automation_config.test_account_id`
-- still scopes the loop.
--
-- Lookahead window: unchanged. Default 120 days.

begin;

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
  v_new_close        date;
  v_new_name         text;
  v_new_year         integer;
  v_new_cycle        integer;
  v_new_length       integer;
  v_requires_sig     boolean;
  v_is_cycle_wrap    boolean;
  v_auto_renew       boolean;
  v_created          integer := 0;
  v_skipped          integer := 0;
  v_run_id           bigint;
  v_err              text;
  v_anniversary      date;
  v_task_due         timestamptz;
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
        -- Anniversary = parent.close_date + 12 months. Leap-year
        -- handling for Feb 29 below.
        (o.close_date + interval '12 months')::date as anniversary
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.stage = 'closed_won'
        and o.close_date is not null
        and (o.close_date + interval '12 months')::date
              between current_date
                  and current_date + (v_config.lookahead_days || ' days')::interval
        and coalesce(o.one_time_project, false) = false
        and coalesce(a.do_not_auto_renew, false) = false
        and (v_config.test_account_id is null or a.id = v_config.test_account_id)
        and not exists (
          select 1 from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
            and child.archived_at is null
        )
    loop
      v_anniversary := v_parent.anniversary;

      -- Leap-year guard: if parent closed Feb 29, the anniversary
      -- snaps to Mar 1 instead of an invalid Feb 29 in a non-leap year.
      -- Postgres's interval arithmetic already handles this for us
      -- (Feb 29 + 12 months = Feb 28 in non-leap years), but business
      -- preference per SF is Mar 1, so override.
      if extract(month from v_parent.close_date) = 2
         and extract(day from v_parent.close_date) = 29
      then
        v_anniversary := make_date(
          extract(year from v_parent.close_date)::int + 1,
          3, 1
        );
      end if;

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

      -- Sig required = display flag on the child opp. Mirrors the
      -- account's auto_renew (false → sig required). 3yr mid-cycle
      -- renewals technically don't need a new sig (already committed),
      -- but we still surface the flag for transparency. Refine later
      -- if needed.
      v_requires_sig := not v_auto_renew;

      -- contract_year/cycle_count walk: 1→2→3→1, increment cycle at wrap.
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
            -- At cycle wrap, an auto-renew account may have set a
            -- different contract length for the next term.
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

      v_new_close := v_anniversary;
      v_new_name  := v_parent.name || ' (Renewal ' || to_char(v_anniversary, 'YYYY') || ')';

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
        v_anniversary,
        case
          when v_parent.contract_end_date is not null
            then (v_parent.contract_end_date + interval '12 months')::date
          else null
        end,
        v_new_length, v_new_year, v_new_cycle,
        v_new_close, v_new_close, v_requires_sig,
        v_parent.id, v_auto_renew,
        v_parent.fte_range, v_parent.fte_count, v_parent.lead_source,
        true,
        format(
          'Auto-generated renewal from %s. Anchored on parent close_date + 12 months = %s. Year %s, cycle %s, length %s mo. Sig required: %s.',
          v_parent.name,
          to_char(v_anniversary, 'YYYY-MM-DD'),
          coalesce(v_new_year::text, '1'),
          coalesce(v_new_cycle::text, 'n/a'),
          v_new_length::text,
          case when v_requires_sig then 'yes' else 'no' end
        )
      )
      returning id into v_new_opp_id;

      -- Copy line items.
      insert into public.opportunity_products (
        opportunity_id, product_id, quantity, unit_price, discount_percent, total_price
      )
      select
        v_new_opp_id, product_id, quantity, unit_price, discount_percent, total_price
      from public.opportunity_products
      where opportunity_id = v_parent.id;

      -- Signature-needed task: 60 days before the anniversary, for
      -- non-auto-renew accounts. Replaces the date-pullback as the
      -- sales early-warning mechanism.
      if not v_auto_renew then
        v_task_due := (v_anniversary - interval '60 days')::timestamptz;
        insert into public.activities (
          account_id, opportunity_id, owner_user_id,
          activity_type, subject, body, due_at
        )
        values (
          v_parent.account_id,
          v_new_opp_id,
          coalesce(v_parent.owner_user_id, v_parent.assigned_assessor_id),
          'task',
          'New signature needed: ' || v_parent.name || ' renewal',
          format(
            'This renewal is on a non-auto-renew account. A new contract signature is needed before the anniversary on %s. Created by renewal automation.',
            to_char(v_anniversary, 'YYYY-MM-DD')
          ),
          v_task_due
        );
      end if;

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

-- ── Audit view ────────────────────────────────────────────────────
-- Re-create with the same close_date + 12 months anchor so the preview
-- matches what the function will do.

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
    -- New anchor: parent.close_date + 12 months. Renamed in the
    -- output column from effective_end_date for clarity; we'll keep
    -- the column name on the view though so the UI doesn't break.
    case
      when o.close_date is null then null
      else (o.close_date + interval '12 months')::date
    end                          as effective_end_date,
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
-- 1. WILL be created on the next run.
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
    'Anniversary %s — inside the %s-day lookahead. Will be created on the next run.',
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

-- 2. Past-due closed-wons whose anniversary has already passed without
-- a child renewal. Outside the automation window — needs manual
-- backfill or a lookahead extension.
select
  'past_due_no_renewal'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  format(
    'Anniversary %s — already past. Outside automation window. Backfill manually or extend lookahead_days.',
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
  'Closed-won opp has no close_date — automation cannot determine the anniversary.'::text
from closed_wons cw
where cw.close_date is null

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
  'Account has no auto_renew value (renewal_type was NULL or unmapped). Automation falls back to non-auto-renew; admin should confirm.'::text
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
  'Surfaces closed-won opps and accounts and what the renewal automation will do with them on the next run. Anchored on parent.close_date + 12 months. Honors renewal_automation_config.test_account_id. Seven audit_category values.';

commit;
