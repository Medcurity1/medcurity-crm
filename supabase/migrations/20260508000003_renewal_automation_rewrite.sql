-- Phase: Rewrite generate_upcoming_renewals per the new rules.
--
-- Behavior changes vs the previous version:
--   1. No more silent skip of accounts whose renewal_type was
--      'no_auto_renew'. We now generate the renewal opp regardless,
--      flag it requires_new_signature=true, and apply the longer
--      60-day pull-back so sales has runway to secure a signature.
--   2. Pull-back lives on expected_close_date instead of being baked
--      into contract_end_date as a hidden ratchet. The previous code's
--      +11-month-instead-of-+12 hack for "Year 2 of cycle 1 of a 3-year
--      contract" is gone — contract_end_date now always advances by
--      exactly 12 months (the yearly billing anchor), and the
--      pull-back is the difference between contract_end_date and
--      expected_close_date.
--   3. close_date is mirrored from expected_close_date at creation so
--      the open-phase sync rule (see the sync_opportunity_close_dates
--      trigger) keeps the two in lockstep until the deal closes.
--   4. cycle_count is set only for 36-month contracts. 12-month
--      contracts get NULL — the field is conceptually meaningful only
--      for tracking how many full 3-year commitments a customer has
--      completed. For 1-year-contract tenure, derive from
--      MIN(contract_start_date) per account in reports.
--   5. account.auto_renew_term_months override: on the Year 3 → Year 1
--      wrap of a 3-year contract on auto-renew, if the account has
--      auto_renew_term_months set, the new renewal's
--      contract_length_months changes accordingly (e.g. 36 → 12 for
--      "auto-renews into successive 1-year terms after the initial
--      3-year period"). Without the override, length carries forward.
--   6. requires_new_signature is auto-set on the new opp:
--        TRUE  if account.auto_renew = false AND
--              (contract_length_months = 12 OR is_year_3_wrap)
--        FALSE otherwise (auto-renew accounts, or year-1→2/year-2→3
--              transitions inside an existing 3-year commitment).
--   7. Pull-back days come from renewal_automation_config:
--        pullback_days_auto_renew (default 30)
--        pullback_days_signature_required (default 60)
--
-- Data preservation:
--   * Function signature is unchanged — cron and the manual-run RPC
--     keep working without other migrations.
--   * Existing opps are not modified by this migration. Only future
--     calls produce different output.

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
        -- Note: we do NOT filter on renewal_type / auto_renew anymore.
        -- Accounts that aren't on auto-renew still need a renewal opp;
        -- they just get the longer pull-back and requires_new_signature.
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

      -- ── Resolve auto_renew, with fallback to legacy renewal_type
      -- for accounts that haven't been touched since the
      -- simplification migration. Default to FALSE (signature
      -- required) for safety when both are NULL.
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

      -- ── Determine cycle-wrap status (only meaningful for 3-yr) ─
      v_is_cycle_wrap := (
        coalesce(v_parent.contract_length_months, 12) = 36
        and coalesce(v_parent.contract_year, 1) = 3
      );

      -- ── Compute requires_new_signature + pullback_days ─────────
      -- Rule:
      --   * auto_renew=true  → 30d, no signature needed
      --   * auto_renew=false AND length=12 → 60d, signature needed
      --     (every 1-yr renewal is a fresh contract)
      --   * auto_renew=false AND length=36 AND year=3 → 60d, signature
      --     (cycle wrap; new 3-yr commitment requires resign)
      --   * auto_renew=false AND length=36 AND year IN (1,2) → 30d,
      --     no signature (still inside the existing 3-yr commitment;
      --     this is an internal billing event, not a new contract)
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
        -- Inside 3-yr cycle (year 1→2 or 2→3), no auto-renew
        v_pullback_days := v_config.pullback_days_auto_renew;
        v_requires_sig := false;
        v_pull_reason := 'no auto-renew, but inside existing 3-year commitment';
      end if;

      -- ── Compute next contract_year + cycle_count + length ──────
      v_new_year   := 1;
      v_new_cycle  := null;
      v_new_length := coalesce(v_parent.contract_length_months, 12);

      if coalesce(v_parent.contract_length_months, 12) = 36 then
        -- 3-year contract: walk year 1→2→3→1, increment cycle on wrap
        v_new_cycle := coalesce(v_parent.cycle_count, 1);
        case coalesce(v_parent.contract_year, 1)
          when 1 then v_new_year := 2;
          when 2 then v_new_year := 3;
          when 3 then
            v_new_year := 1;
            v_new_cycle := coalesce(v_parent.cycle_count, 1) + 1;
            -- Optional override: switch term length on the wrap.
            -- e.g. account signed "auto-renews into 1-year terms"
            -- after the initial 3-year period.
            if v_auto_renew = true
               and v_parent.account_auto_renew_term_months is not null
            then
              v_new_length := v_parent.account_auto_renew_term_months;
            end if;
          else v_new_year := 1;
        end case;
      else
        -- 1-year contract: always year 1, cycle_count NULL
        v_new_year := 1;
        v_new_cycle := null;
      end if;

      -- ── Date arithmetic ────────────────────────────────────────
      v_new_start    := v_effective_end + interval '1 day';
      -- contract_end_date always advances by 12 months (yearly anchor).
      -- The 36-month commitment is preserved via contract_length_months
      -- + contract_year + cycle_count, not via this date.
      v_new_end      := (v_effective_end + interval '12 months')::date;

      -- Leap-year guard: parent ended on Feb 29 → roll new end to Mar 1
      if extract(month from v_effective_end) = 2
         and extract(day from v_effective_end) = 29
      then
        v_new_end := make_date(extract(year from v_new_end)::int, 3, 1);
      end if;

      -- expected_close_date = anchor − pullback. close_date mirrors at
      -- creation (the sync trigger keeps them aligned during open
      -- phase, then close_date snaps to actual close date when the
      -- opp lands).
      v_new_expected := v_effective_end - v_pullback_days;
      v_new_close    := v_new_expected;

      -- Backfill parent.contract_end_date if it was missing — keeps
      -- future runs from re-paying the close_date+length fallback.
      if v_parent.contract_end_date is null then
        update public.opportunities
        set contract_end_date = v_effective_end
        where id = v_parent.id;
      end if;

      v_new_name := v_parent.name || ' (Renewal ' || to_char(v_new_start, 'YYYY') || ')';

      insert into public.opportunities (
        name,
        account_id,
        primary_contact_id,
        owner_user_id,
        original_sales_rep_id,
        assigned_assessor_id,
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
        close_date,
        requires_new_signature,
        renewal_from_opportunity_id,
        auto_renewal,
        fte_range,
        fte_count,
        lead_source,
        created_by_automation,
        notes
      )
      values (
        v_new_name,
        v_parent.account_id,
        v_parent.primary_contact_id,
        coalesce(v_parent.assigned_assessor_id, v_parent.owner_user_id),
        v_parent.owner_user_id,
        v_parent.assigned_assessor_id,
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
        v_new_length,
        v_new_year,
        v_new_cycle,
        v_new_expected,
        v_new_close,
        v_requires_sig,
        v_parent.id,
        v_auto_renew,
        v_parent.fte_range,
        v_parent.fte_count,
        v_parent.lead_source,
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
