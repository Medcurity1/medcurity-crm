-- Nexus Your Day: copy polish on the queue's reason strings (docket C2).
--
-- Nathan's style rule for the Nexus tab (2026-07-29): no em dashes, no
-- filler words. The queue's reason strings render verbatim in the coming
-- YourDayWidget, so they are UI copy and follow the rule. This re-emits
-- rep_day_queue with tightened strings; logic, scoping, ranking, and the
-- row shape are byte-identical to 20260729130000 apart from the literals.

begin;

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
    where o.owner_user_id = (select auth.uid())
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

commit;

notify pgrst, 'reload schema';
