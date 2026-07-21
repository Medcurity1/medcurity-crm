-- Renewals: RESTORE the "New signature needed" auto-tasks (Nathan, 2026-07-21
-- late morning) — full reversal of 20260721160000.
--
-- The team clarified at standup: renewal ownership follows the previous
-- deal (assessor first, else owner), which lands renewals on people like
-- Molly who don't watch the renewals pipeline day-to-day. WITHOUT a task,
-- an owner has no signal they hold a renewal needing a signature — the
-- auto-task IS the notification channel. The 7/21-morning walk-back was a
-- team miscommunication; putting it back exactly as designed:
--
--  1. generate_upcoming_renewals_unsafe re-emitted VERBATIM from
--     20260715230000 — WITH the signature-task block (task on the parent
--     deal's owner, due anniversary − 60 days, non-auto-renew parents
--     only). Future renewals create their tasks again.
--  2. UN-archive the machine-created backlog tasks that 20260721160000
--     archived (archiving preserved them fully — due dates included).
--     Matched by the same "Created by renewal automation." body marker;
--     they were invisible while archived, so no user-archived rows can
--     match. The one human-completed task was never touched.
--
-- No renewals were generated in the tasks-off window (no cron run and no
-- manual run between the two migrations), so nothing else needs backfill.
--
-- Idempotent: create-or-replace + guarded update.

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
          (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
          (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
        ) as anniversary
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
        and coalesce(
              o.contract_end_date,
              (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
              (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
            )
              between current_date - (coalesce(v_config.lookback_days, 30) || ' days')::interval
                  and current_date + (v_config.lookahead_days || ' days')::interval
        -- BASELINE ("start fresh", 2026-07-11): contracts already inside
        -- the renewal window when the automation went live on this env are
        -- the team's manual backlog — never auto-create them. Only
        -- anniversaries that ENTER the window after baseline are automated.
        and (
          v_config.baseline_date is null
          or coalesce(
               o.contract_end_date,
               (o.contract_signed_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date,
               (o.close_date           + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
             ) > v_config.baseline_date + (v_config.lookahead_days || ' days')::interval
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
          v_parent.contract_signed_date,
          null,
          (v_anniversary + (v_new_length || ' months')::interval)::date,
          v_new_length, v_new_year, v_new_cycle,
          v_anniversary,
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


-- 2. Un-archive the machine-created signature tasks.
update public.activities
   set archived_at = null
 where activity_type = 'task'
   and subject like 'New signature needed%'
   and body like '%Created by renewal automation.%'
   and completed_at is null
   and archived_at is not null;

commit;
