-- Nexus Your Day: durable per-user hide prefs (Nathan, 2026-08-18).
--
-- Repeated "Not today" on the SAME item is counted atomically. The third
-- (and every later third) dismissal can ask whether to stop seeing that
-- exact reminder or the whole category. Regular tasks cannot be hidden as
-- a group: one dismissal must never suppress all task reminders. Product
-- requests are a hideable category of their own so they can leave Your
-- Day while still living in Requests.
--
-- Re-emits rep_day_queue from the latest live body (20260805030000,
-- assessor-first renewals + requests branch + Pacific day + dash-free
-- copy) and adds category + hide filters. DROP is required because the
-- extra out-column changes the return type.

begin;

-- ── 1. Per-item state (counts + exact-item hide) ──────────────────────
create table if not exists public.day_queue_item_state (
  user_id            uuid not null references public.user_profiles(id) on delete cascade,
  item_key           text not null,
  kind               text not null,
  category           text not null,
  title              text,
  dismiss_count      integer not null default 0
                       check (dismiss_count >= 0),
  hidden_at          timestamptz,
  last_dismissed_at  timestamptz,
  created_at         timestamptz not null default timezone('utc', now()),
  updated_at         timestamptz not null default timezone('utc', now()),
  primary key (user_id, item_key),
  check (length(item_key) between 1 and 200),
  check (category ~ '^[a-z][a-z0-9_:%]*$')
);

create index if not exists day_queue_item_state_hidden
  on public.day_queue_item_state (user_id)
  where hidden_at is not null;

alter table public.day_queue_item_state enable row level security;

drop policy if exists day_queue_item_state_own on public.day_queue_item_state;
create policy day_queue_item_state_own on public.day_queue_item_state
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.day_queue_item_state to authenticated;
revoke all on public.day_queue_item_state from public, anon;

comment on table public.day_queue_item_state is
  'Per-user Your Day item state: atomic Not-today counts and optional exact-item hides.';

-- ── 2. Hidden categories ──────────────────────────────────────────────
create table if not exists public.day_queue_hidden_categories (
  user_id    uuid not null references public.user_profiles(id) on delete cascade,
  category   text not null,
  hidden_at  timestamptz not null default timezone('utc', now()),
  primary key (user_id, category),
  constraint day_queue_hidden_categories_hideable check (
    category <> 'task'
    and category not in ('*', 'all', '%')
    and category ~ '^[a-z][a-z0-9_:%]*$'
  )
);

alter table public.day_queue_hidden_categories enable row level security;

drop policy if exists day_queue_hidden_categories_own on public.day_queue_hidden_categories;
create policy day_queue_hidden_categories_own on public.day_queue_hidden_categories
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.day_queue_hidden_categories to authenticated;
revoke all on public.day_queue_hidden_categories from public, anon;

comment on table public.day_queue_hidden_categories is
  'Per-user Your Day category hides. Regular tasks (category = task) are rejected by constraint: one dismissal must never suppress all task reminders. Matching in rep_day_queue is equality, never LIKE.';

-- ── 3. Atomic Not today ───────────────────────────────────────────────
create or replace function public.day_queue_not_today(
  p_item_key  text,
  p_kind      text,
  p_category  text,
  p_title     text default null,
  p_until     timestamptz default null
)
returns table (
  dismiss_count integer,
  ask_to_hide   boolean
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_key   text := nullif(btrim(p_item_key), '');
  v_kind  text := nullif(btrim(p_kind), '');
  v_cat   text := nullif(btrim(p_category), '');
  v_title text := nullif(btrim(p_title), '');
  v_until timestamptz := coalesce(p_until, timezone('utc', now()) + interval '20 hours');
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_key is null or length(v_key) > 200 then
    raise exception 'Invalid reminder';
  end if;
  if v_kind is null or length(v_kind) > 80 then
    raise exception 'Invalid reminder';
  end if;
  if v_cat is null or v_cat !~ '^[a-z][a-z0-9_:%]*$' then
    raise exception 'Invalid reminder';
  end if;
  if v_until <= timezone('utc', now()) or v_until > timezone('utc', now()) + interval '48 hours' then
    raise exception 'Invalid snooze';
  end if;

  insert into public.day_queue_snoozes as z (user_id, item_key, until)
  values (v_uid, v_key, v_until)
  on conflict (user_id, item_key) do update
    set until = excluded.until;

  insert into public.day_queue_item_state as s (
    user_id, item_key, kind, category, title, dismiss_count, last_dismissed_at, updated_at
  )
  values (
    v_uid, v_key, v_kind, v_cat, v_title, 1, timezone('utc', now()), timezone('utc', now())
  )
  on conflict (user_id, item_key) do update
    set dismiss_count     = s.dismiss_count + 1,
        kind              = excluded.kind,
        category          = excluded.category,
        title             = coalesce(excluded.title, s.title),
        last_dismissed_at = timezone('utc', now()),
        updated_at        = timezone('utc', now())
  returning s.dismiss_count into v_count;

  return query select v_count, (v_count > 0 and v_count % 3 = 0);
end;
$$;

revoke all on function public.day_queue_not_today(text, text, text, text, timestamptz) from public, anon;
grant execute on function public.day_queue_not_today(text, text, text, text, timestamptz) to authenticated, service_role;

comment on function public.day_queue_not_today(text, text, text, text, timestamptz) is
  'Snooze one Your Day item until p_until (default ~next morning) and atomically increment that user+item dismiss_count. ask_to_hide is true on every third dismissal.';

-- ── 4. Hide / restore ─────────────────────────────────────────────────
create or replace function public.day_queue_hide_item(
  p_item_key text,
  p_kind     text default null,
  p_category text default null,
  p_title    text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_key  text := nullif(btrim(p_item_key), '');
  v_kind text := coalesce(nullif(btrim(p_kind), ''), 'item');
  v_cat  text := coalesce(nullif(btrim(p_category), ''), v_kind);
  v_title text := nullif(btrim(p_title), '');
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_key is null or length(v_key) > 200 then
    raise exception 'Invalid reminder';
  end if;
  if v_cat !~ '^[a-z][a-z0-9_:%]*$' then
    v_cat := 'item';
  end if;

  insert into public.day_queue_item_state as s (
    user_id, item_key, kind, category, title, dismiss_count, hidden_at, updated_at
  )
  values (
    v_uid, v_key, v_kind, v_cat, v_title, 0, timezone('utc', now()), timezone('utc', now())
  )
  on conflict (user_id, item_key) do update
    set hidden_at  = timezone('utc', now()),
        kind       = excluded.kind,
        category   = excluded.category,
        title      = coalesce(excluded.title, s.title),
        updated_at = timezone('utc', now());
end;
$$;

create or replace function public.day_queue_unhide_item(p_item_key text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_key text := nullif(btrim(p_item_key), '');
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_key is null then
    raise exception 'Invalid reminder';
  end if;

  update public.day_queue_item_state
     set hidden_at = null, updated_at = timezone('utc', now())
   where user_id = v_uid and item_key = v_key;

  delete from public.day_queue_snoozes
   where user_id = v_uid and item_key = v_key;
end;
$$;

create or replace function public.day_queue_hide_category(p_category text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cat text := nullif(btrim(p_category), '');
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_cat is null or v_cat = 'task' then
    raise exception 'Task reminders stay on your list';
  end if;
  if v_cat in ('*', 'all', '%') or v_cat !~ '^[a-z][a-z0-9_:%]*$' then
    raise exception 'Cannot hide that category';
  end if;

  insert into public.day_queue_hidden_categories (user_id, category)
  values (v_uid, v_cat)
  on conflict (user_id, category) do nothing;
end;
$$;

create or replace function public.day_queue_unhide_category(p_category text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cat text := nullif(btrim(p_category), '');
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  if v_cat is null then
    raise exception 'Invalid category';
  end if;

  delete from public.day_queue_hidden_categories
   where user_id = v_uid and category = v_cat;
end;
$$;

revoke all on function public.day_queue_hide_item(text, text, text, text) from public, anon;
grant execute on function public.day_queue_hide_item(text, text, text, text) to authenticated, service_role;
revoke all on function public.day_queue_unhide_item(text) from public, anon;
grant execute on function public.day_queue_unhide_item(text) to authenticated, service_role;
revoke all on function public.day_queue_hide_category(text) from public, anon;
grant execute on function public.day_queue_hide_category(text) to authenticated, service_role;
revoke all on function public.day_queue_unhide_category(text) from public, anon;
grant execute on function public.day_queue_unhide_category(text) to authenticated, service_role;

comment on function public.day_queue_hide_category(text) is
  'Hide one Your Day category for the caller. Rejects task (and wildcards) so one action cannot suppress all task reminders.';

-- ── 5. Re-emit rep_day_queue from 20260805030000 + hide filters ────────
drop function if exists public.rep_day_queue(int);

create function public.rep_day_queue(p_limit int default 25)
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
  event_id       uuid,
  category       text
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
    null::uuid as task_id, e.campaign_id, e.id as event_id,
    'reply'::text                                   as category
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
    en.account_id, en.contact_id, null::uuid, en.id, null::uuid, en.campaign_id, null::uuid,
    'outreach_paused'::text
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
    a.campaign_enrollment_id, a.id, null::uuid, null::uuid,
    case when a.campaign_enrollment_id is not null then 'campaign_task' else 'task' end
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
    null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid, null::uuid,
    'request:' || r.type::text
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
    r.account_id, null::uuid, r.soonest_opp_id, null::uuid, null::uuid, null::uuid, null::uuid,
    'renewal'::text
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
    o.account_id, null::uuid, o.id, null::uuid, null::uuid, null::uuid, null::uuid,
    'stale_deal'::text
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
left join day_queue_item_state hid
  on hid.user_id = (select auth.uid()) and hid.item_key = u.item_key and hid.hidden_at is not null
left join day_queue_hidden_categories cat
  on cat.user_id = (select auth.uid()) and cat.category = u.category
where s.item_key is null
  and hid.item_key is null
  and cat.category is null
order by u.urgency desc, u.amount desc nulls last, u.due_at asc nulls last
limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.rep_day_queue(int) from public, anon;
grant execute on function public.rep_day_queue(int) to authenticated, service_role;

comment on function public.rep_day_queue(int) is
  'Nexus "Your Day" ranked next-best-action queue (docket C2). SECURITY INVOKER + explicit owner filters on every branch. Branches: replies, paused outreach, tasks, routed pending requests, renewal windows, stale deals. Renewal windows target coalesce(assigned_assessor_id, owner_user_id) per Nathan 2026-08-04 (D15). Pacific-time day boundaries; dash-free UI copy; snoozes come from day_queue_snoozes; exact-item hides from day_queue_item_state.hidden_at; category hides from day_queue_hidden_categories matched by equality only. Product requests use category request:product so they can leave Your Day without hiding tasks.';

commit;

notify pgrst, 'reload schema';
