-- ---------------------------------------------------------------------
-- Renewals: lookback window + per-row robustness.
--
-- Re-emits public.generate_upcoming_renewals(text) and
-- public.preview_upcoming_renewals() VERBATIM from
-- 20260612000001_opportunity_delete_for_reps.sql with ONLY two surgical
-- changes. Everything else (security definer, search_path, grants, the
-- account status gate `a.status = 'active'`, the every_other_year gate,
-- the candidate SELECT, the insert columns/values, the
-- opportunity_products clone, the signature activity task) is unchanged.
--
-- CHANGE A — LOOKBACK WINDOW (audit item renewal-lookback / #6)
--   The candidate query had no floor below current_date, so a contract
--   whose anniversary already passed (cron miss, Supabase pause, account
--   flipped active after its anniversary, backdated end date) was
--   permanently skipped. Add renewal_automation_config.lookback_days
--   (default 30) and lower the candidate anniversary floor to
--   current_date - lookback_days. Idempotency is already guaranteed by
--   the existing `not exists (child renewal_from_opportunity_id)` check,
--   so re-acting on a past-due opp is safe. preview_upcoming_renewals
--   mirrors the lowered floor so a past-due-but-in-lookback opp shows
--   status 'will_create' instead of 'anniversary_outside_window'.
--
-- CHANGE B — ROBUSTNESS (audit item renewal-robustness / #7, parts b+c)
--   (b) Term-aware leap-year guard: recompute the anniversary as
--       anchor_base + contract_length_months, rolling ONLY a genuine
--       Feb-29 anchor to Mar 1, rather than hardcoding +12 months.
--   (c) Per-row isolation: wrap the per-candidate work inside the FOR
--       loop in a BEGIN/EXCEPTION WHEN OTHERS block so one bad row
--       increments skipped_count (and records the first error message)
--       and CONTINUEs instead of aborting the entire batch.
--
-- NOT changed here (deliberately, per scope): the account status gate
-- (`a.status = 'active'` stays — no derived-customer predicate), the
-- every_other_year gate (cycle_count parity stays verbatim), and no
-- recursive chain-depth CTE / renewal_from index is added.
-- ---------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------
-- CHANGE A.1 — config column. NOT NULL default backfills the singleton
-- config row (id = 1); no seeding needed.
-- ---------------------------------------------------------------------
alter table public.renewal_automation_config
  add column if not exists lookback_days integer not null default 30
    check (lookback_days between 0 and 365);

-- ---------------------------------------------------------------------
-- generate_upcoming_renewals — re-emitted from 20260612000001 with
-- CHANGE A (lookback floor) + CHANGE B (term-aware leap guard + per-row
-- exception isolation). Everything else byte-identical.
-- ---------------------------------------------------------------------

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
  v_first_err        text := null;   -- CHANGE B(c): first per-row error
  v_anniversary      date;
  v_anchor_base      date;           -- CHANGE B(b): base date for the anniversary
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
        -- Anchor priority:
        --   1. contract_end_date           — authoritative when set
        --   2. contract_signed_date + len  — renewal anchor; survives close_date drift
        --   3. close_date + len            — legacy SF fallback
        coalesce(
          o.contract_end_date,
          (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
          (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
        ) as anniversary
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.stage = 'closed_won'
        -- Need at least one of contract_end_date, contract_signed_date,
        -- or close_date to compute the anniversary.
        and (
          o.contract_end_date is not null
          or o.contract_signed_date is not null
          or o.close_date is not null
        )
        and a.status = 'active'
        -- CHANGE A: lower the candidate anniversary floor from current_date
        -- to current_date - lookback_days so just-missed / past-due
        -- anniversaries are caught up. The existing not-exists-child-renewal
        -- check below guarantees idempotency, so re-acting is safe.
        and coalesce(
              o.contract_end_date,
              (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
              (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
            )
              between current_date - (coalesce(v_config.lookback_days, 30) || ' days')::interval
                  and current_date + (v_config.lookahead_days || ' days')::interval
        and coalesce(o.one_time_project, false) = false
        and coalesce(a.do_not_auto_renew, false) = false
        and (v_config.test_account_id is null or a.id = v_config.test_account_id)
        -- A child renewal counts as already-generated even when it was
        -- archived (archiving used to trigger a silent regeneration on
        -- the next run), and deliberately deleted renewals stay deleted
        -- via renewal_suppressions (Jordan S 2026-06-12).
        and not exists (
          select 1 from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
        )
        and not exists (
          select 1 from public.renewal_suppressions s
          where s.source_opportunity_id = o.id
        )
    loop
      -- CHANGE B(c): per-row isolation. One bad parent must not abort the
      -- whole batch — count it into skipped_count, remember the first
      -- error message, and carry on with the rest of the candidates.
      begin
        v_anniversary := v_parent.anniversary;

        -- CHANGE B(b): term-aware leap-year guard. The anniversary is
        -- always (anchor_base + contract_length_months). Recompute it that
        -- way, and ONLY when the anchor was a genuine Feb 29 roll the result
        -- to Mar 1 of the anniversary year — never collapse the term to 12
        -- months. When contract_end_date is set we trust it as-is.
        if v_parent.contract_end_date is null then
          v_anchor_base := coalesce(v_parent.contract_signed_date, v_parent.close_date);
          if v_anchor_base is not null then
            v_anniversary := (v_anchor_base
              + (coalesce(v_parent.contract_length_months, 12) || ' months')::interval)::date;
            -- + N months never lands on Feb 29 unless the target year is a
            -- leap year (Postgres clamps Feb 29 → Feb 28 otherwise), so the
            -- explicit roll only matters when the SOURCE was Feb 29 and we
            -- want the canonical Mar 1 follow-on.
            if extract(month from v_anchor_base) = 2
               and extract(day   from v_anchor_base) = 29
               and not (extract(month from v_anniversary) = 2
                        and extract(day from v_anniversary) = 29)
            then
              v_anniversary := make_date(
                extract(year from v_anniversary)::int, 3, 1
              );
            end if;
          end if;
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
        v_new_name := coalesce(nullif(trim(v_parent.name), ''), 'Renewal');

        -- Child renewal: copy contract_signed_date FORWARD so the
        -- perennial signature anchor propagates. Year 2's renewal will
        -- have the same contract_signed_date as Year 1, which is the
        -- whole point — the signature date doesn't change just because
        -- the contract renewed. Child's close_date stays NULL until won.
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
          fte_range, fte_count, lead_source, created_by_automation,
          description, next_step, notes
        )
        values (
          v_new_name, v_parent.account_id, v_parent.primary_contact_id,
          coalesce(v_parent.assigned_assessor_id, v_parent.owner_user_id),
          v_parent.owner_user_id, v_parent.assigned_assessor_id,
          'renewals', 'renewal',
          'proposal',
          v_parent.amount, coalesce(v_parent.service_amount, 0),
          coalesce(v_parent.product_amount, 0),
          coalesce(v_parent.services_included, true),
          v_parent.service_description, v_parent.discount,
          v_parent.payment_frequency, v_parent.promo_code,
          -- contract_signed_date: pull forward from parent. NULL when
          -- parent has none — surfaced in v_renewal_anchor_audit so the
          -- team can backfill, but we still create the renewal so we
          -- don't miss it.
          v_parent.contract_signed_date,
          -- contract_start_date: leave null; will be set when signed.
          null,
          -- contract_end_date: anniversary + new term length.
          (v_anniversary + (v_new_length || ' months')::interval)::date,
          v_new_length, v_new_year, v_new_cycle,
          -- expected_close_date: target = the anniversary.
          v_anniversary,
          -- close_date: stays NULL until this opp moves to Closed Won.
          null,
          v_requires_sig,
          v_parent.id, v_auto_renew,
          v_parent.fte_range, v_parent.fte_count, v_parent.lead_source,
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
            end,
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
        -- CHANGE B(c): isolate the bad row. Count it as skipped and keep
        -- the first error message; the rest of the batch proceeds.
        v_skipped := v_skipped + 1;
        if v_first_err is null then
          v_first_err := format('opp %s: %s', v_parent.id, sqlerrm);
        end if;
      end;
    end loop;

    -- CHANGE B(c): surface the first per-row error (if any) on the run
    -- record so admins can see that rows were skipped without the whole
    -- batch having aborted.
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

grant execute on function public.generate_upcoming_renewals(text) to authenticated;

-- ---------------------------------------------------------------------
-- preview_upcoming_renewals — mirror CHANGE A (lookback floor) and
-- CHANGE B(b) (term-aware leap guard) so the admin preview matches what
-- the generator will actually do. Everything else copied verbatim from
-- 20260612000001.
-- ---------------------------------------------------------------------

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
      -- CHANGE A: expose lookback_days (default 30) for the past-due floor.
      coalesce(c.lookback_days, 30)   as lookback_days,
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
      o.one_time_project,
      o.archived_at,
      a.name                           as account_name,
      a.status::text                   as account_status,
      a.do_not_auto_renew,
      a.archived_at                    as account_archived_at,
      -- CHANGE B(b): term-aware leap guard. Anniversary is always
      -- (anchor + contract_length_months); roll to Mar 1 only on a genuine
      -- Feb-29 anchor. contract_end_date trusted as-is when set.
      case
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
      end                              as anniversary,
      case
        when o.contract_end_date is not null    then 'contract_end_date'
        when o.contract_signed_date is not null then 'contract_signed_date_plus_length'
        when o.close_date is not null           then 'close_date_plus_length'
        else                                         'none'
      end                              as anchor_field,
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
      when c.account_status <> 'active'                         then 'account_not_active'
      when coalesce(c.do_not_auto_renew, false)                 then 'account_do_not_auto_renew'
      when coalesce(c.one_time_project, false)                  then 'one_time_project'
      when c.has_live_renewal                                   then 'has_live_renewal'
      -- CHANGE A: past-due floor lowered to current_date - lookback_days.
      when c.anniversary <  current_date
                          - ((select lookback_days from cfg) || ' days')::interval
                                                                then 'anniversary_outside_window'
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
      when c.account_status <> 'active'
        then format('Account status is "%s", not "active".', c.account_status)
      when coalesce(c.do_not_auto_renew, false)
        then 'Account has do_not_auto_renew = true.'
      when coalesce(c.one_time_project, false)
        then 'Parent opportunity is flagged one_time_project = true.'
      when c.has_live_renewal
        then 'A live child renewal already exists (renewal_from_opportunity_id = this opp).'
      -- CHANGE A: past-due reason now references the lookback window.
      when c.anniversary < current_date
                         - ((select lookback_days from cfg) || ' days')::interval
        then format(
          'Anniversary %s is %s days past due (via %s) — beyond the %s-day lookback window. The function only acts on anniversaries between today - lookback_days and today + lookahead_days.',
          to_char(c.anniversary, 'YYYY-MM-DD'),
          (current_date - c.anniversary)::text,
          c.anchor_field,
          (select lookback_days from cfg)::text
        )
      when c.anniversary > current_date + ((select lookahead_days from cfg) || ' days')::interval
        then format(
          'Anniversary %s is %s days away (via %s) — beyond the %s-day lookahead. Set contract_end_date directly, or raise lookahead_days.',
          to_char(c.anniversary, 'YYYY-MM-DD'),
          (c.anniversary - current_date)::text,
          c.anchor_field,
          (select lookahead_days from cfg)::text
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
      when c.archived_at is not null or c.account_archived_at is not null then 9
      when c.anchor_field = 'none'                                        then 8
      when c.account_status <> 'active'                                   then 7
      when coalesce(c.do_not_auto_renew, false)                           then 6
      when coalesce(c.one_time_project, false)                            then 5
      when c.has_live_renewal                                             then 4
      -- CHANGE A: past-due bucket uses the lookback floor.
      when c.anniversary < current_date
                         - ((select lookback_days from cfg) || ' days')::interval then 3
      when c.anniversary > current_date
                         + ((select lookahead_days from cfg) || ' days')::interval
                                                                          then 2
      else 1
    end,
    c.anniversary nulls last,
    c.opportunity_name;
$$;

grant execute on function public.preview_upcoming_renewals() to authenticated;

commit;

notify pgrst, 'reload schema';
