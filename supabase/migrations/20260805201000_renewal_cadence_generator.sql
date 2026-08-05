-- ---------------------------------------------------------------------
-- Renewal cadence, part 2 (companion to 20260805200000): the generator,
-- its admin preview, and the audit view move from the every-other-year
-- boolean to accounts.renewal_cadence_years. The anniversary shift is
-- (N-1)*12 months; N=1 is the original behavior, N=2 the 8/5
-- every-other-year behavior, N=3 the new tri-annual clients (Hope
-- Health, Unity Hospice per Rachel). All dedup rails unchanged. The
-- audit view keeps its every_other_year display column (synced legacy
-- alias) so the admin UI needs no change; its effective end and parent
-- horizon now scale with cadence.
-- Re-emits of 20260805160000 (generator) and 20260805121000 (preview,
-- audit) with only the cadence expressions changed.
-- ---------------------------------------------------------------------

begin;

create or replace function public.generate_upcoming_renewals_unsafe(
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
  v_first_err        text := null;
  v_anniversary      date;
  v_anchor_base      date;
  v_task_due         timestamptz;
  v_covering         uuid;
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
        a.renewal_cadence_years   as account_renewal_cadence_years,
        -- An account renewing every N years renews (N-1)*12 months later
        -- than the contract math says.
        (coalesce(
           o.contract_end_date,
           (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
           (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
         )
         + make_interval(months => 12 * (coalesce(a.renewal_cadence_years, 1) - 1))
        )::date as anniversary
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.stage = 'closed_won'
        and (
          o.contract_end_date is not null
          or o.contract_signed_date is not null
          or o.close_date is not null
        )
        and a.customer_status = 'client'
        and (coalesce(
               o.contract_end_date,
               (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
               (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
             )
             + make_interval(months => 12 * (coalesce(a.renewal_cadence_years, 1) - 1))
            )::date
              between current_date - (coalesce(v_config.lookback_days, 30) || ' days')::interval
                  and current_date + (v_config.lookahead_days || ' days')::interval
        -- BASELINE ("start fresh", 2026-07-11): contracts already inside
        -- the renewal window when the automation went live on this env are
        -- the team's manual backlog — never auto-create them. Only
        -- anniversaries that ENTER the window after baseline are automated.
        and (
          v_config.baseline_date is null
          or (coalesce(
                o.contract_end_date,
                (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
                (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
              )
              + make_interval(months => 12 * (coalesce(a.renewal_cadence_years, 1) - 1))
             )::date > v_config.baseline_date + (v_config.lookahead_days || ' days')::interval
        )
        and coalesce(o.one_time_project, false) = false
        and coalesce(a.do_not_auto_renew, false) = false
        and (v_config.test_account_id is null or a.id = v_config.test_account_id)
        and not exists (
          select 1 from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
        )
        and not exists (
          select 1 from public.renewal_suppressions s
          where s.source_opportunity_id = o.id
        )
    loop
      begin
        v_anniversary := v_parent.anniversary;

        if v_parent.contract_end_date is null then
          v_anchor_base := coalesce(v_parent.contract_signed_date, v_parent.close_date);
          if v_anchor_base is not null then
            v_anniversary := (v_anchor_base
              + (coalesce(v_parent.contract_length_months, 12) || ' months')::interval)::date;
            if extract(month from v_anchor_base) = 2
               and extract(day   from v_anchor_base) = 29
               and not (extract(month from v_anniversary) = 2
                        and extract(day from v_anniversary) = 29)
            then
              v_anniversary := make_date(
                extract(year from v_anniversary)::int, 3, 1
              );
            end if;
            -- keep the cadence shift the query applied
            if coalesce(v_parent.account_renewal_cadence_years, 1) > 1 then
              v_anniversary := (v_anniversary + make_interval(
                months => 12 * (v_parent.account_renewal_cadence_years - 1)))::date;
            end if;
          end if;
        end if;

        -- NEW (2026-07-27): covering-deal dedup. A renewal made by hand or
        -- imported from SF has no renewal_from_opportunity_id, so the child-
        -- exists check above can't see it. If ANY qualifying deal already
        -- covers this anniversary, log the skip and move on.
        v_covering := public.find_covering_renewal_deal(
          v_parent.account_id, v_parent.id, v_parent.name,
          v_anniversary, v_parent.amount
        );
        if v_covering is not null then
          insert into public.renewal_generation_skips as k
            (source_opportunity_id, covering_opportunity_id, last_seen_run_id)
          values (v_parent.id, v_covering, v_run_id)
          on conflict (source_opportunity_id) do update
            set covering_opportunity_id = excluded.covering_opportunity_id,
                last_seen_run_id        = excluded.last_seen_run_id,
                last_seen_at            = timezone('utc', now()),
                times_skipped           = k.times_skipped + 1;
          v_skipped := v_skipped + 1;
          continue;
        end if;

        -- (2026-08-05) The old odd-cycle_count skip for every_other_year
        -- accounts lived here. Removed: the anniversary itself now carries
        -- the 24-month cadence, so no separate skip is needed.

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

        v_requires_sig := not v_auto_renew;

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

        v_new_close := v_anniversary;
        v_new_name := coalesce(nullif(trim(v_parent.name), ''), 'Renewal');

        insert into public.opportunities (
          name, account_id, primary_contact_id, owner_user_id,
          original_sales_rep_id, assigned_assessor_id,
          team, kind, stage, amount, service_amount, product_amount,
          services_included, service_description, discount,
          payment_frequency, promo_code,
          contract_signed_date,
          contract_start_date, contract_end_date,
          contract_length_months, contract_year, cycle_count,
          expected_close_date, close_date, requires_new_signature,
          renewal_from_opportunity_id, auto_renewal,
          fte_range, fte_count, lead_source, lead_source_detail,
          created_by_automation,
          description, next_step, notes
        )
        values (
          v_new_name, v_parent.account_id, v_parent.primary_contact_id,
          coalesce(v_parent.assigned_assessor_id, v_parent.owner_user_id),
          -- (2026-08-05) Credit the TRUE original seller down the renewal
          -- chain. The old value (parent owner) drifted to the assessor
          -- after one cycle, because generated renewals are assessor-owned.
          coalesce(v_parent.original_sales_rep_id, v_parent.owner_user_id),
          v_parent.assigned_assessor_id,
          'renewals', 'renewal',
          'proposal_conversation',
          v_parent.amount, coalesce(v_parent.service_amount, 0),
          coalesce(v_parent.product_amount, 0),
          coalesce(v_parent.services_included, true),
          v_parent.service_description, v_parent.discount,
          v_parent.payment_frequency, v_parent.promo_code,
          v_parent.contract_signed_date,
          null,
          (v_anniversary + (v_new_length || ' months')::interval)::date,
          v_new_length, v_new_year, v_new_cycle,
          v_anniversary,
          null,
          v_requires_sig,
          v_parent.id, v_auto_renew,
          v_parent.fte_range, v_parent.fte_count,
          -- (2026-08-05) lead_source_detail now carries over too; it was
          -- silently dropped while lead_source survived.
          v_parent.lead_source, v_parent.lead_source_detail,
          true,
          v_parent.description,
          v_parent.next_step,
          format(
            'Auto-generated renewal from %s. Anchored on parent %s = %s. Year %s, cycle %s, length %s mo. Sig required: %s.',
            v_parent.name,
            case
              when v_parent.contract_end_date is not null    then 'contract_end_date'
              when v_parent.contract_signed_date is not null then 'contract_signed_date + length'
              else                                                'close_date + length'
            end
            || case when coalesce(v_parent.account_renewal_cadence_years, 1) > 1
                    then format(' +%smo (renews every %s years)',
                                12 * (v_parent.account_renewal_cadence_years - 1),
                                v_parent.account_renewal_cadence_years)
                    else '' end,
            to_char(v_anniversary, 'YYYY-MM-DD'),
            coalesce(v_new_year::text, '1'),
            coalesce(v_new_cycle::text, 'n/a'),
            v_new_length::text,
            case when v_requires_sig then 'yes' else 'no' end
          )
        )
        returning id into v_new_opp_id;

        insert into public.opportunity_products (
          opportunity_id, product_id, quantity, unit_price, discount_percent, discount_type
        )
        select
          v_new_opp_id, product_id, quantity, unit_price, discount_percent, discount_type
        from public.opportunity_products
        where opportunity_id = v_parent.id;

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

      exception when others then
        v_skipped := v_skipped + 1;
        if v_first_err is null then
          v_first_err := format('opp %s: %s', v_parent.id, sqlerrm);
        end if;
      end;
    end loop;

    v_err := case
      when v_first_err is not null
        then format('%s row(s) skipped due to errors; first: %s', v_skipped, v_first_err)
      else null
    end;

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

revoke execute on function public.generate_upcoming_renewals_unsafe(text) from public, anon, authenticated;

create or replace function public.preview_upcoming_renewals_unsafe()
returns table (
  status                  text,
  parent_opportunity_id   uuid,
  parent_opportunity_name text,
  account_id              uuid,
  account_name            text,
  account_status          text,
  close_date              date,
  contract_signed_date    date,
  contract_end_date       date,
  contract_length_months  integer,
  contract_year           integer,
  cycle_count             integer,
  one_time_project        boolean,
  do_not_auto_renew       boolean,
  archived                boolean,
  computed_anniversary    date,
  anchor_field            text,
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
      coalesce(c.lookback_days, 30)   as lookback_days,
      c.baseline_date,
      c.test_account_id
    from public.renewal_automation_config c
    where c.id = 1
  ),
  candidates as (
    select
      o.id                             as opportunity_id,
      o.name                           as opportunity_name,
      o.account_id,
      o.close_date,
      o.contract_signed_date,
      o.contract_end_date,
      o.contract_length_months,
      o.contract_year,
      o.cycle_count,
      o.amount,
      o.one_time_project,
      o.archived_at,
      a.name                           as account_name,
      a.customer_status::text          as account_status,
      a.do_not_auto_renew,
      a.archived_at                    as account_archived_at,
      (case
        when o.contract_end_date is not null
          then o.contract_end_date
        when o.contract_signed_date is not null
          then case
            when extract(month from o.contract_signed_date) = 2
             and extract(day   from o.contract_signed_date) = 29
             and not (extract(month from (o.contract_signed_date
                   + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date) = 2
                  and extract(day from (o.contract_signed_date
                   + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date) = 29)
            then make_date(
              extract(year from (o.contract_signed_date
                + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date)::int,
              3, 1
            )
            else (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
          end
        when o.close_date is not null
          then case
            when extract(month from o.close_date) = 2
             and extract(day   from o.close_date) = 29
             and not (extract(month from (o.close_date
                   + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date) = 2
                  and extract(day from (o.close_date
                   + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date) = 29)
            then make_date(
              extract(year from (o.close_date
                + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date)::int,
              3, 1
            )
            else (o.close_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
          end
        else null
      end
      + make_interval(months => 12 * (coalesce(a.renewal_cadence_years, 1) - 1))
      )::date                          as anniversary,
      (case
        when o.contract_end_date is not null    then 'contract_end_date'
        when o.contract_signed_date is not null then 'contract_signed_date_plus_length'
        when o.close_date is not null           then 'close_date_plus_length'
        else                                         'none'
      end
      || case
           when coalesce(a.renewal_cadence_years, 1) > 1
            and (o.contract_end_date is not null
                 or o.contract_signed_date is not null
                 or o.close_date is not null)
           then '_plus_' || (12 * (a.renewal_cadence_years - 1))::text || 'mo_cadence'
           else '' end
      )                                as anchor_field,
      (
        exists (
          select 1
          from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
        )
        or exists (
          select 1
          from public.renewal_suppressions s
          where s.source_opportunity_id = o.id
        )
      )                                as has_live_renewal
    from public.opportunities o
    join public.accounts a on a.id = o.account_id
    where o.stage = 'closed_won'
  )
  select
    case
      when c.archived_at is not null or c.account_archived_at is not null
                                                                then 'archived'
      when (select test_account_id from cfg) is not null
       and c.account_id <> (select test_account_id from cfg)    then 'not_test_account'
      when c.anchor_field = 'none'                              then 'no_close_date'
      when c.account_status <> 'client'                         then 'account_not_customer'
      when coalesce(c.do_not_auto_renew, false)                 then 'account_do_not_auto_renew'
      when coalesce(c.one_time_project, false)                  then 'one_time_project'
      when c.has_live_renewal                                   then 'has_live_renewal'
      when c.anniversary <  current_date
                          - ((select lookback_days from cfg) || ' days')::interval
                                                                then 'anniversary_outside_window'
      -- BASELINE ("start fresh"): already inside the window at go-live.
      when (select baseline_date from cfg) is not null
       and c.anniversary <= (select baseline_date from cfg)
                          + ((select lookahead_days from cfg) || ' days')::interval
                                                                then 'before_baseline'
      when c.anniversary >  current_date
                          + ((select lookahead_days from cfg) || ' days')::interval
                                                                then 'anniversary_outside_window'
      when public.find_covering_renewal_deal(
             c.account_id, c.opportunity_id, c.opportunity_name,
             c.anniversary, c.amount) is not null               then 'covered_by_existing'
      else 'will_create'
    end                                                          as status,
    c.opportunity_id,
    c.opportunity_name,
    c.account_id,
    c.account_name,
    c.account_status,
    c.close_date,
    c.contract_signed_date,
    c.contract_end_date,
    c.contract_length_months,
    c.contract_year,
    c.cycle_count,
    coalesce(c.one_time_project, false)                          as one_time_project,
    coalesce(c.do_not_auto_renew, false)                         as do_not_auto_renew,
    (c.archived_at is not null or c.account_archived_at is not null) as archived,
    c.anniversary                                                as computed_anniversary,
    c.anchor_field,
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
      when c.anchor_field = 'none'
        then 'Parent opportunity has none of contract_end_date, contract_signed_date, or close_date set. Anniversary cannot be computed.'
      when c.account_status <> 'client'
        then format('Account Status is "%s", not Customer.', c.account_status)
      when coalesce(c.do_not_auto_renew, false)
        then 'Account has do_not_auto_renew = true.'
      when coalesce(c.one_time_project, false)
        then 'Parent opportunity is flagged one_time_project = true.'
      when c.has_live_renewal
        then 'A live child renewal already exists (renewal_from_opportunity_id = this opp).'
      when c.anniversary < current_date
                         - ((select lookback_days from cfg) || ' days')::interval
        then format(
          'Anniversary %s is %s days past due (via %s) — beyond the %s-day lookback window. The function only acts on anniversaries between today - lookback_days and today + lookahead_days.',
          to_char(c.anniversary, 'YYYY-MM-DD'),
          (current_date - c.anniversary)::text,
          c.anchor_field,
          (select lookback_days from cfg)::text
        )
      when (select baseline_date from cfg) is not null
       and c.anniversary <= (select baseline_date from cfg)
                          + ((select lookahead_days from cfg) || ' days')::interval
        then format(
          'Contract was already inside the renewal window when the automation started (fresh-start date %s) — part of the manual backlog; will not be auto-created.',
          to_char((select baseline_date from cfg), 'YYYY-MM-DD')
        )
      when c.anniversary > current_date + ((select lookahead_days from cfg) || ' days')::interval
        then format(
          'Anniversary %s is %s days away (via %s) — beyond the %s-day lookahead. Set contract_end_date directly, or raise lookahead_days.',
          to_char(c.anniversary, 'YYYY-MM-DD'),
          (c.anniversary - current_date)::text,
          c.anchor_field,
          (select lookahead_days from cfg)::text
        )
      when public.find_covering_renewal_deal(
             c.account_id, c.opportunity_id, c.opportunity_name,
             c.anniversary, c.amount) is not null
        then format(
          'An existing deal on this account already covers this renewal: "%s". No duplicate will be created; the skip is logged in renewal_generation_skips.',
          coalesce((
            select s.name from public.opportunities s
            where s.id = public.find_covering_renewal_deal(
              c.account_id, c.opportunity_id, c.opportunity_name,
              c.anniversary, c.amount)
          ), 'unknown')
        )
      else format(
        'Will create a renewal on the next run. Anniversary %s is %s days away (via %s).',
        to_char(c.anniversary, 'YYYY-MM-DD'),
        (c.anniversary - current_date)::text,
        c.anchor_field
      )
    end                                                          as reason
  from candidates c
  where not (
    (select test_account_id from cfg) is not null
    and c.account_id <> (select test_account_id from cfg)
  )
  order by
    case
      when c.archived_at is not null or c.account_archived_at is not null then 10
      when c.anchor_field = 'none'                                        then 9
      when c.account_status <> 'client'                                   then 8
      when coalesce(c.do_not_auto_renew, false)                           then 7
      when coalesce(c.one_time_project, false)                            then 6
      when c.has_live_renewal                                             then 5
      when c.anniversary < current_date
                         - ((select lookback_days from cfg) || ' days')::interval then 3
      when (select baseline_date from cfg) is not null
       and c.anniversary <= (select baseline_date from cfg)
                          + ((select lookahead_days from cfg) || ' days')::interval then 4
      when c.anniversary > current_date
                         + ((select lookahead_days from cfg) || ' days')::interval
                                                                          then 2
      else 1
    end,
    c.anniversary nulls last,
    c.opportunity_name;
$$;

revoke execute on function public.preview_upcoming_renewals_unsafe() from public, anon, authenticated;

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
    a.customer_status as lifecycle_status,
    a.renewal_type,
    a.auto_renew,
    a.every_other_year,
    a.do_not_auto_renew,
    case
      when o.close_date is null then null
      else (o.close_date
            + make_interval(months => 12 * coalesce(a.renewal_cadence_years, 1)))::date
    end                          as effective_end_date,
    exists (
      select 1
      from public.opportunities child
      where child.renewal_from_opportunity_id = o.id
        and child.archived_at is null
    ) as has_live_renewal,
    s.source_opportunity_id is not null as is_suppressed,
    s.reason                     as suppression_reason,
    s.deleted_child_name         as suppression_deleted_child
  from public.opportunities o
  join public.accounts a on a.id = o.account_id
  left join public.renewal_suppressions s on s.source_opportunity_id = o.id
  cross join cfg
  where o.archived_at is null
    and a.archived_at is null
    and o.stage = 'closed_won'
    and (o.close_date is null
         or o.close_date >= current_date
              - (interval '6 months'
                 + make_interval(months => 12 * coalesce(a.renewal_cadence_years, 1))))
    and (cfg.test_account_id is null or a.id = cfg.test_account_id)
)
-- 1. WILL be created on the next run.
select
  'missing_renewal'::text                              as audit_category,
  cw.opportunity_id                                    as parent_opportunity_id,
  cw.account_id,
  cw.account_name,
  cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  format(
    'Anniversary %s — inside the %s-day lookahead. Will be created on the next run.',
    to_char(cw.effective_end_date, 'YYYY-MM-DD'),
    (select lookahead_days from cfg)::text
  )::text                                              as note
from closed_wons cw, cfg
where cw.has_live_renewal = false
  and cw.is_suppressed = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date >= current_date
  and cw.effective_end_date <= current_date + (cfg.lookahead_days || ' days')::interval

union all

-- 2. Past-due closed-wons — genuinely unhandled only (suppressed ones
-- now appear under their own categories below).
select
  'past_due_no_renewal'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  format(
    'Anniversary %s — already past with no renewal and no suppression. The wide lookback window will create it on the next run (clients only).',
    to_char(cw.effective_end_date, 'YYYY-MM-DD')
  )::text
from closed_wons cw
where cw.has_live_renewal = false
  and cw.is_suppressed = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date < current_date

union all

-- 2b. Confirmed churned (reconciliation suppressions).
select
  'suppressed_churned'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  cw.suppression_reason::text
from closed_wons cw
where cw.is_suppressed
  and cw.suppression_reason like 'churned%'

union all

-- 2c. Superseded by a manual deal (reconciliation suppressions).
select
  'suppressed_superseded'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  cw.suppression_reason::text
from closed_wons cw
where cw.is_suppressed
  and cw.suppression_reason like 'superseded%'

union all

-- 2d. Renewal deliberately deleted (Jordan's flow) — was wrongly nagging
-- as past_due before this re-emit.
select
  'suppressed_deleted'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  coalesce(
    cw.suppression_reason,
    format('auto-renewal "%s" was deliberately deleted — automation will not recreate it', coalesce(cw.suppression_deleted_child, 'unknown'))
  )::text
from closed_wons cw
where cw.is_suppressed
  and (cw.suppression_reason is null or (cw.suppression_reason not like 'churned%' and cw.suppression_reason not like 'superseded%'))

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
  'auto_renew_null'::text,
  null::uuid, a.id, a.name, null::text,
  null::date, null::date, null::date,
  null::integer, null::integer, null::integer,
  a.customer_status::text, a.renewal_type::text,
  a.auto_renew, a.every_other_year, a.do_not_auto_renew,
  'Account has no auto_renew value (renewal_type was NULL or unmapped). Automation falls back to non-auto-renew; admin should confirm.'::text
from public.accounts a
cross join cfg
where a.archived_at is null
  and a.auto_renew is null
  and a.customer_status = 'client'
  and (cfg.test_account_id is null or a.id = cfg.test_account_id)

union all

select
  'do_not_auto_renew'::text,
  null::uuid, a.id, a.name, null::text,
  null::date, null::date, null::date,
  null::integer, null::integer, null::integer,
  a.customer_status::text, a.renewal_type::text,
  a.auto_renew, a.every_other_year, a.do_not_auto_renew,
  'Account flagged do_not_auto_renew — automation will skip all renewals on this account regardless of auto_renew.'::text
from public.accounts a
cross join cfg
where a.archived_at is null
  and a.do_not_auto_renew = true
  and a.customer_status = 'client'
  and (cfg.test_account_id is null or a.id = cfg.test_account_id);

comment on view public.v_renewal_audit is
  'Renewal automation X-ray: what will be created, what is genuinely unhandled, and every deliberate skip (churn-confirmed / superseded / deleted) with its written reason. Effective end = close + renewal_cadence_years*12 months (each account''s real cadence). Suppressed parents never nag the actionable lists.';

commit;

notify pgrst, 'reload schema';
