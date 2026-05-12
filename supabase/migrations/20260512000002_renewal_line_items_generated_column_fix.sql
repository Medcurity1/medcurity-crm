-- Renewal automation: fix the line-item clone.
--
-- `opportunity_products.total_price` is a `generated always as (...) stored`
-- column (see 20260430000003_discount_amount_unconstrained.sql). Postgres
-- rejects INSERTs that try to write to a generated column, so every
-- attempt to run the renewal automation against an opp with line items
-- has been raising:
--
--   ERROR: cannot insert a non-DEFAULT value into column "total_price"
--   DETAIL: Column "total_price" is a generated column.
--
-- Fix: drop `total_price` from the INSERT/SELECT column list and add
-- `discount_type` instead. The generated column re-derives `total_price`
-- from (quantity, unit_price, discount_percent, discount_type) at insert
-- time, and propagating `discount_type` ensures the percent-vs-amount
-- branch matches the parent line.
--
-- This is a `create or replace function` of the body from
-- 20260511000002_renewal_close_date_anchor.sql with ONLY the line-item
-- clone block changed. No other behavior changes.

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

      if extract(month from v_parent.close_date) = 2
         and extract(day from v_parent.close_date) = 29
      then
        v_anniversary := make_date(
          extract(year from v_parent.close_date)::int + 1,
          3, 1
        );
      end if;

      if v_parent.account_every_other_year then
        if coalesce(v_parent.cycle_count, 0) % 2 = 1 then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;

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

      -- Copy line items. total_price is a generated stored column on
      -- opportunity_products (see 20260430000003) — must NOT be in the
      -- column list. discount_type IS in the list so the generated
      -- column's percent-vs-amount branch matches the parent line.
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

commit;
