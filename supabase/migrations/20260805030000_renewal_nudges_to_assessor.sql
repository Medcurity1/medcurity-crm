-- Renewal touchpoints go to the ASSESSOR, seller is only the fallback
-- (Nathan 2026-08-04, settling docket D15 after Summer's report).
--
-- The Assigned Assessor field was made required on service deals
-- (20260715170000, Rachel) precisely so renewal work could route to the
-- person doing the work. Two surfaces still targeted the original seller:
--
--   1. rep_day_queue's renewals branch ("Renewal N days out, no deal
--      open yet") matched the expiring contract's owner_user_id. Now
--      coalesce(assigned_assessor_id, owner_user_id): the assessor sees
--      the warning; deals with no assessor (mostly pre-July) still fall
--      back to the seller so nothing goes unwatched. SECURITY INVOKER is
--      safe here: opportunities_read_active is team-wide.
--
--   2. The generator's "New signature needed" task was assigned
--      coalesce(owner, assessor) - backwards vs the child deal itself,
--      which has been coalesce(assessor, owner) since 20260416000002.
--      Flipped to match.
--
-- Both functions are restated in full from their previous definitions
-- (20260729160000 and 20260727130000); each contains exactly that one
-- line changed.

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
            coalesce(v_parent.assigned_assessor_id, v_parent.owner_user_id),
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

create or replace function public.rep_day_queue(p_limit int default 25)
returns table (
  item_key       text,
  kind           text,
  title          text,
  reason         text,
  urgency        numeric,
  amount         numeric,
  due_at         timestamptz,
  account_id     uuid,
  contact_id     uuid,
  opportunity_id uuid,
  enrollment_id  uuid,
  task_id        uuid,
  campaign_id    uuid,
  event_id       uuid
)
language sql
stable
security invoker
set search_path = public
as $$
with
replies as (
  select
    'reply:' || e.id                                as item_key,
    'reply'                                         as kind,
    trim(coalesce(en.first_name,'') || ' ' || coalesce(en.last_name,''))
      || case when coalesce(en.company,'') <> '' then ' · ' || en.company else '' end as title,
    'Replied'
      || case when en.reply_category is not null then ' "' || en.reply_category || '"' else '' end
      || case
           when ((now() at time zone 'America/Los_Angeles')::date - coalesce(e.occurred_at, e.created_at)::date) <= 0 then ' today'
           when ((now() at time zone 'America/Los_Angeles')::date - coalesce(e.occurred_at, e.created_at)::date) = 1 then ' yesterday'
           else ' ' || ((now() at time zone 'America/Los_Angeles')::date - coalesce(e.occurred_at, e.created_at)::date) || ' days ago'
         end
      || ', unanswered'                             as reason,
    90
      + case when en.reply_category in ('Interested','Meeting Request') then 10 else 0 end
      - greatest(0, least(((now() at time zone 'America/Los_Angeles')::date - coalesce(e.occurred_at, e.created_at)::date), 20)) * 0.1 as urgency,
    0::numeric                                      as amount,
    coalesce(e.occurred_at, e.created_at)           as due_at,
    en.account_id, en.contact_id,
    null::uuid as opportunity_id, en.id as enrollment_id,
    null::uuid as task_id, e.campaign_id, e.id as event_id
  from campaign_events e
  join campaign_enrollments en on en.id = e.enrollment_id
  where e.event_type in ('EMAIL_REPLIED', 'EMAIL_REPLY')
    and (e.payload #>> '{handled,at}') is null
    and coalesce(e.occurred_at, e.created_at) > now() - interval '30 days'
    and en.owner_user_id = (select auth.uid())
),

paused_deals as (
  select
    'pause:' || en.id,
    'outreach_paused',
    trim(coalesce(en.first_name,'') || ' ' || coalesce(en.last_name,''))
      || case when coalesce(en.company,'') <> '' then ' · ' || en.company else '' end,
    'Opportunity opened, outreach paused',
    85::numeric,
    0::numeric,
    coalesce(en.last_event_at, en.enrolled_at),
    en.account_id, en.contact_id, null::uuid, en.id, null::uuid, en.campaign_id, null::uuid
  from campaign_enrollments en
  where en.status = 'paused'
    and en.paused_reason = 'meeting_booked'
    and en.owner_user_id = (select auth.uid())
),

tasks as (
  select
    'task:' || a.id,
    case when a.campaign_enrollment_id is not null then 'campaign_task' else 'task' end,
    a.subject,
    case
      when a.due_at::date < (now() at time zone 'America/Los_Angeles')::date then
        'Overdue by ' || ((now() at time zone 'America/Los_Angeles')::date - a.due_at::date)
        || case when ((now() at time zone 'America/Los_Angeles')::date - a.due_at::date) = 1 then ' day' else ' days' end
      else 'Due today'
    end || case when a.campaign_enrollment_id is not null then ' · campaign step' else '' end,
    (case when a.due_at::date < (now() at time zone 'America/Los_Angeles')::date
         then 75 + least(((now() at time zone 'America/Los_Angeles')::date - a.due_at::date), 10)
         when a.campaign_enrollment_id is not null then 70
         else 65 end)::numeric,
    0::numeric,
    a.due_at,
    a.account_id, a.contact_id, a.opportunity_id,
    a.campaign_enrollment_id, a.id, null::uuid, null::uuid
  from activities a
  where a.owner_user_id = (select auth.uid())
    and a.completed_at is null
    and a.archived_at is null
    and a.activity_type = 'task'
    and a.due_at is not null
    and a.due_at::date <= (now() at time zone 'America/Los_Angeles')::date
),

requests_waiting as (
  select
    'request:' || r.id,
    'request',
    r.title,
    'Asked by ' || coalesce(nullif(trim(r.requester_name), ''), 'a teammate')
      || case
           when ((now() at time zone 'America/Los_Angeles')::date - r.created_at::date) <= 0 then ' today'
           when ((now() at time zone 'America/Los_Angeles')::date - r.created_at::date) = 1 then ' yesterday'
           else ' ' || ((now() at time zone 'America/Los_Angeles')::date - r.created_at::date) || ' days ago'
         end,
    (68 + case r.priority when 'high' then 6 when 'medium' then 0 else -4 end
        + least(((now() at time zone 'America/Los_Angeles')::date - r.created_at::date) * 0.3, 6))::numeric,
    0::numeric,
    r.created_at,
    null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid
  from requests r
  where r.status = 'pending'
    and exists (
      select 1 from request_routing rt
      where rt.type = r.type and rt.user_id = (select auth.uid())
    )
),

renewals as (
  select
    'renewal:' || r.account_id,
    'renewal',
    r.account_name || ' · ' || to_char(r.total_amount, 'FM$999,999,999'),
    'Renewal ' || (r.soonest_end - (now() at time zone 'America/Los_Angeles')::date)
      || ' days out, no deal open yet'
      || case when r.contracts > 1 then ' (' || r.contracts || ' contracts)' else '' end,
    80
      + least(coalesce(r.total_amount, 0) / 5000, 10)
      + (60 - (r.soonest_end - (now() at time zone 'America/Los_Angeles')::date)) * 0.1,
    r.total_amount,
    r.soonest_end::timestamptz,
    r.account_id, null::uuid, r.soonest_opp_id, null::uuid, null::uuid, null::uuid, null::uuid
  from (
    select
      o.account_id,
      max(a.name)                as account_name,
      sum(o.amount)              as total_amount,
      min(o.contract_end_date)   as soonest_end,
      (array_agg(o.id order by o.contract_end_date asc))[1] as soonest_opp_id,
      count(*)                   as contracts
    from opportunities o
    join accounts a on a.id = o.account_id
    where coalesce(o.assigned_assessor_id, o.owner_user_id) = (select auth.uid())
      and o.stage = 'closed_won'
      and o.archived_at is null
      and a.archived_at is null
      and o.contract_end_date between (now() at time zone 'America/Los_Angeles')::date
                                  and (now() at time zone 'America/Los_Angeles')::date + 60
      and not exists (
        select 1 from opportunities o2
        where o2.account_id = o.account_id
          and o2.archived_at is null
          and o2.stage not in ('closed_won', 'closed_lost')
      )
    group by o.account_id
  ) r
),

stale as (
  select
    'stale:' || o.id,
    'stale_deal',
    a.name || ' · ' || to_char(o.amount, 'FM$999,999,999') || ' ' || replace(o.stage::text, '_', ' '),
    'No touch in ' || ((now() at time zone 'America/Los_Angeles')::date - coalesce(la.last_activity_at::date, o.updated_at::date)) || ' days',
    40 + least(coalesce(o.amount, 0) / 5000, 10)
       + least(((now() at time zone 'America/Los_Angeles')::date - coalesce(la.last_activity_at::date, o.updated_at::date)) * 0.2, 10),
    o.amount,
    o.updated_at,
    o.account_id, null::uuid, o.id, null::uuid, null::uuid, null::uuid, null::uuid
  from opportunities o
  join accounts a on a.id = o.account_id
  left join v_opportunity_last_activity la on la.opportunity_id = o.id
  where o.owner_user_id = (select auth.uid())
    and o.stage in ('proposal', 'verbal_commit')
    and o.archived_at is null
    and a.archived_at is null
    and coalesce(la.last_activity_at::date, o.updated_at::date)
        < (now() at time zone 'America/Los_Angeles')::date - 14
),

unioned as (
  select * from replies
  union all select * from paused_deals
  union all select * from tasks
  union all select * from requests_waiting
  union all select * from renewals
  union all select * from stale
)
select u.*
from unioned u
left join day_queue_snoozes s
  on s.user_id = (select auth.uid()) and s.item_key = u.item_key and s.until > now()
where s.item_key is null
order by u.urgency desc, u.amount desc nulls last, u.due_at asc nulls last
limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

comment on function public.rep_day_queue(int) is
  'Nexus "Your Day" ranked next-best-action queue (docket C2). SECURITY INVOKER + explicit owner filters on every branch. Branches: replies, paused outreach, tasks, routed pending requests, renewal windows, stale deals. Renewal windows target coalesce(assigned_assessor_id, owner_user_id) per Nathan 2026-08-04 (D15). Pacific-time day boundaries; dash-free UI copy; snoozes come from day_queue_snoozes.';

commit;

notify pgrst, 'reload schema';
