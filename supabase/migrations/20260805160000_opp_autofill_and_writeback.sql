-- ---------------------------------------------------------------------
-- Summer's auto-populate request (2026-08-04, docket A9), approved by
-- Nathan 2026-08-05.
--
-- Plain English: three quality-of-life fills around opportunity creation.
--   1. Original Sales Rep defaults to the opp owner on new opps (the
--      owner at creation IS the seller; the field exists to preserve
--      that credit when renewals hand ownership to the assessor). It was
--      filled on 1 of 2,199 opps, so the renewal chain had nothing to
--      carry. Renewals now also prefer the parent's original rep over
--      the parent's owner, so credit no longer drifts to the assessor
--      after the first renewal cycle.
--   2. Lead Source on a new opp fills from the account, and when the
--      account has none (98% of accounts) from the primary contact
--      (63% of contacts have one). Lead Source stays REQUIRED on opp
--      creation (Joe 2026-07-10, migration 20260710186000); this makes
--      the requirement mostly self-satisfying.
--   3. Blank-only write-back: when an opp carries FTE or Lead Source
--      that its account is missing, saving the opp fills the account.
--      Never overwrites an existing account value. FTE on the account
--      is required to close a deal (opportunity_close gate), so this
--      removes a roadblock reps otherwise hit at close time.
--
-- Mechanics:
--   - BEFORE INSERT trigger fills opp defaults (rep, lead source pair)
--     so every create surface gets them, not just the main form. The
--     form ALSO fills live at create time (client change, same commit)
--     so reps see values before saving; this trigger is the safety net.
--   - AFTER INSERT OR UPDATE trigger does the blank-only account
--     write-back. Composes with trg_accounts_fte_propagate
--     (20260415000008, account to open opps): our write-back only fires
--     when the account field IS NULL, so the bounce terminates after
--     one round trip.
--   - accounts.lead_source is TEXT while opportunities/contacts use the
--     lead_source enum; account text is cast only when it matches an
--     enum label, and written back as text.
--   - fte_count_to_range(int) mirrors employeesToFteRange in
--     src/lib/formatters.ts. Keep the two in sync.
--   - Generator re-emit (verbatim from 20260805121000 except):
--     original_sales_rep_id = coalesce(parent original rep, parent
--     owner), and lead_source_detail now copies parent to child (it was
--     silently dropped before).
--
-- Idempotent: create-or-replace + drop-trigger-if-exists.
-- ---------------------------------------------------------------------

begin;

-- ---------- 0. FTE bucket helper (mirror of employeesToFteRange) ----------
create or replace function public.fte_count_to_range(p_count integer)
returns text
language sql
immutable
as $$
  select case
    when p_count is null or p_count <= 0 then null
    when p_count <= 20   then '1-20'
    when p_count <= 50   then '21-50'
    when p_count <= 100  then '51-100'
    when p_count <= 250  then '101-250'
    when p_count <= 500  then '251-500'
    when p_count <= 750  then '501-750'
    when p_count <= 1000 then '751-1000'
    when p_count <= 1500 then '1001-1500'
    when p_count <= 2000 then '1501-2000'
    when p_count <= 5000 then '2001-5000'
    else '5001-10000'
  end
$$;

comment on function public.fte_count_to_range(integer) is
  'FTE count to price-tier bucket. MUST mirror employeesToFteRange in src/lib/formatters.ts.';

-- ---------- 1. Opp-create defaults (BEFORE INSERT) ----------
create or replace function public.opp_create_fill_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acct_source  text;
  v_acct_detail  text;
  v_c_source     public.lead_source;
  v_c_detail     text;
begin
  -- Original Sales Rep: the owner at creation is the seller. The renewal
  -- generator sets this explicitly, so it is never null there; this
  -- covers human-created opps on every surface.
  if new.original_sales_rep_id is null then
    new.original_sales_rep_id := new.owner_user_id;
  end if;

  -- Lead Source: account first, then primary contact. Fill the detail
  -- text only alongside its source so the pair stays coherent.
  if new.lead_source is null and new.account_id is not null then
    select a.lead_source, a.lead_source_detail
      into v_acct_source, v_acct_detail
      from public.accounts a
     where a.id = new.account_id;

    if v_acct_source is not null
       and v_acct_source = any (enum_range(null::public.lead_source)::text[]) then
      new.lead_source := v_acct_source::public.lead_source;
      if new.lead_source_detail is null then
        new.lead_source_detail := v_acct_detail;
      end if;
    end if;
  end if;

  if new.lead_source is null and new.primary_contact_id is not null then
    select c.lead_source, c.lead_source_detail
      into v_c_source, v_c_detail
      from public.contacts c
     where c.id = new.primary_contact_id;

    if v_c_source is not null then
      new.lead_source := v_c_source;
      if new.lead_source_detail is null then
        new.lead_source_detail := v_c_detail;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_opp_create_fill_defaults on public.opportunities;
create trigger trg_opp_create_fill_defaults
  before insert on public.opportunities
  for each row
  execute function public.opp_create_fill_defaults();

-- ---------- 2. Blank-only account write-back (AFTER INSERT OR UPDATE) ----------
create or replace function public.opp_backfill_account_basics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_id is null then
    return null;
  end if;
  -- Fast no-op: nothing to give.
  if new.fte_count is null and nullif(new.fte_range, '') is null
     and new.lead_source is null then
    return null;
  end if;

  update public.accounts a
  set
    fte_count = coalesce(a.fte_count, new.fte_count),
    fte_range = coalesce(
      a.fte_range,
      nullif(new.fte_range, ''),
      public.fte_count_to_range(coalesce(a.fte_count, new.fte_count))
    ),
    -- Lead source pair moves together: detail only lands when the
    -- account is taking the source from this opp too.
    lead_source = coalesce(a.lead_source, new.lead_source::text),
    lead_source_detail = case
      when a.lead_source is null and new.lead_source is not null
        then coalesce(a.lead_source_detail, new.lead_source_detail)
      else a.lead_source_detail
    end
  where a.id = new.account_id
    and (
      (a.fte_count is null and new.fte_count is not null)
      or (a.fte_range is null
          and (nullif(new.fte_range, '') is not null or new.fte_count is not null))
      or (a.lead_source is null and new.lead_source is not null)
    );

  return null;
end;
$$;

drop trigger if exists trg_opp_backfill_account_basics on public.opportunities;
create trigger trg_opp_backfill_account_basics
  after insert or update of fte_count, fte_range, lead_source, lead_source_detail, account_id
  on public.opportunities
  for each row
  execute function public.opp_backfill_account_basics();

-- ---------- 3. Generator re-emit (20260805121000 + rep credit + detail copy) ----------

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
        a.every_other_year        as account_every_other_year,
        -- EOY accounts renew 12 months later than the contract math says.
        (coalesce(
           o.contract_end_date,
           (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
           (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
         )
         + case when a.every_other_year then interval '12 months' else interval '0 months' end
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
             + case when a.every_other_year then interval '12 months' else interval '0 months' end
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
              + case when a.every_other_year then interval '12 months' else interval '0 months' end
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
            -- keep the every-other-year shift the query applied
            if v_parent.account_every_other_year then
              v_anniversary := (v_anniversary + interval '12 months')::date;
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
            || case when v_parent.account_every_other_year
                    then ' +12mo (every other year)' else '' end,
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

commit;

notify pgrst, 'reload schema';
