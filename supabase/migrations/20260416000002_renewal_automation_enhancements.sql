-- Enhance the renewal automation to handle:
--   1. every_other_year accounts (skip off-years)
--   2. 3-year contract year cycling (Year 1 → 2 → 3 → 1)
--   3. cycle_count tracking
--   4. Copy additional fields: discount, payment_frequency, promo_code,
--      contract_length_months, contract_year, cycle_count, fte_range, fte_count,
--      lead_source, one_time_project (skip these)
--   5. 3-year contract "pull back" rule (Year 2 of first cycle gets +11 months not +12)

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
  v_config        public.renewal_automation_config%rowtype;
  v_parent        record;
  v_account       record;
  v_new_opp_id    uuid;
  v_new_start     date;
  v_new_end       date;
  v_new_close     date;
  v_new_name      text;
  v_new_year      integer;
  v_new_cycle     integer;
  v_months_offset integer;
  v_created       integer := 0;
  v_skipped       integer := 0;
  v_run_id        bigint;
  v_err           text;
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
        a.renewal_type    as account_renewal_type,
        a.every_other_year as account_every_other_year
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.stage = 'closed_won'
        and o.contract_end_date is not null
        and o.contract_end_date between current_date
                                    and current_date + (v_config.lookahead_days || ' days')::interval
        and coalesce(a.renewal_type::text, 'manual_renew') <> 'no_auto_renew'
        -- Skip one-time projects (they don't renew)
        and coalesce(o.one_time_project, false) = false
        -- No live child renewal already exists (idempotency)
        and not exists (
          select 1 from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
            and child.archived_at is null
        )
    loop
      -- ── Every-other-year handling ──────────────────────────────
      -- If the account does every-other-year and this would be an "off" year,
      -- skip it. The account stays active; the renewal just doesn't generate
      -- until next year.
      if v_parent.account_every_other_year then
        -- Off-year = odd cycle counts (1, 3, 5...) skip; even (0, 2, 4...) renew.
        -- If cycle_count is null, treat as 0 (first cycle, should renew).
        if coalesce(v_parent.cycle_count, 0) % 2 = 1 then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;

      -- ── Compute contract year cycling for 3-year contracts ─────
      v_months_offset := 12;  -- default: shift 1 year forward
      v_new_year := null;
      v_new_cycle := coalesce(v_parent.cycle_count, 1);

      if coalesce(v_parent.contract_length_months, 12) = 36 then
        -- 3-year contract: cycle Year 1 → 2 → 3 → 1
        case coalesce(v_parent.contract_year, 1)
          when 1 then
            v_new_year := 2;
            -- "Pull back" rule: Year 2 of first cycle gets +11 months
            if v_new_cycle = 1 then
              v_months_offset := 11;
            end if;
          when 2 then
            v_new_year := 3;
          when 3 then
            v_new_year := 1;
            v_new_cycle := v_new_cycle + 1;  -- new 3-year cycle
          else
            v_new_year := 1;
        end case;
      else
        -- Non-3-year contracts: always Year 1, increment cycle
        v_new_year := 1;
        v_new_cycle := v_new_cycle + 1;
      end if;

      -- ── Date arithmetic ────────────────────────────────────────
      v_new_start := v_parent.contract_end_date + interval '1 day';
      v_new_end   := (v_parent.contract_end_date + (v_months_offset || ' months')::interval)::date;
      v_new_close := v_parent.contract_end_date;

      -- Leap-year guard: if source was Feb 29, roll to Mar 1
      if extract(month from v_parent.contract_end_date) = 2
         and extract(day from v_parent.contract_end_date) = 29
      then
        v_new_end := make_date(
          extract(year from v_new_end)::int,
          3,
          1
        );
      end if;

      v_new_name := v_parent.name || ' (Renewal ' || to_char(v_new_start, 'YYYY') || ')';

      insert into public.opportunities (
        name,
        account_id,
        primary_contact_id,
        owner_user_id,
        team,
        kind,
        stage,
        amount,
        service_amount,
        product_amount,
        services_included,
        service_description,
        discount,
        payment_frequency,
        promo_code,
        contract_start_date,
        contract_end_date,
        contract_length_months,
        contract_year,
        cycle_count,
        expected_close_date,
        renewal_from_opportunity_id,
        auto_renewal,
        fte_range,
        fte_count,
        lead_source,
        notes
      )
      values (
        v_new_name,
        v_parent.account_id,
        v_parent.primary_contact_id,
        v_parent.owner_user_id,
        'renewals',
        'renewal',
        'lead',
        v_parent.amount,
        coalesce(v_parent.service_amount, 0),
        coalesce(v_parent.product_amount, 0),
        coalesce(v_parent.services_included, true),
        v_parent.service_description,
        v_parent.discount,
        v_parent.payment_frequency,
        v_parent.promo_code,
        v_new_start,
        v_new_end,
        v_parent.contract_length_months,
        v_new_year,
        v_new_cycle,
        v_new_close,
        v_parent.id,
        true,
        v_parent.fte_range,
        v_parent.fte_count,
        v_parent.lead_source,
        format(
          'Auto-generated renewal from %s (contract end %s). Year %s, cycle %s.',
          v_parent.name,
          to_char(v_parent.contract_end_date, 'YYYY-MM-DD'),
          coalesce(v_new_year::text, '1'),
          coalesce(v_new_cycle::text, '1')
        )
      )
      returning id into v_new_opp_id;

      -- Clone line items
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

commit;
