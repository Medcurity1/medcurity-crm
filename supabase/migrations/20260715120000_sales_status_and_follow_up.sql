-- ---------------------------------------------------------------------
-- Account Status Restructure, Step 1 of 3 — the additive layer.
-- (Summer's request 2026-07-14, design confirmed by her 2026-07-15;
--  Nathan delegated implementation decisions. Full impact map in the
--  2026-07-14 deep dive; ledger: DOCKET "Account status restructure".)
--
-- Adds the NEW fields only. Nothing is removed or re-pointed here —
-- accounts.status / lifecycle_status keep working untouched until
-- Step 2 (rewire) and Step 3 (retire).
--
--   sales_active        — Summer's Active/Inactive "am I working this
--                         account?" toggle. Shared per account. Default
--                         false: the whole book starts as the cold
--                         database and reps flip accounts on deliberately
--                         (her Q3/Q7 answers — no value crosswalk from
--                         the old status field, it was machine-set).
--   sales_status        — sub-status while working: Prospecting /
--                         Identified Outreach / Engaged / Nurture.
--                         TEXT + picklist_options (NOT an enum) so Summer
--                         can rename values in Admin > Picklists with no
--                         code change — the pattern that already survived
--                         two of her vocabulary renames (partnership_status,
--                         account_type). Kept as history when the toggle
--                         goes off (her Q4 answer), so no clearing here.
--   next_follow_up_date — plain date. Conditional requiredness is enforced
--                         in the account form + the v_follow_up_gaps
--                         cleanup view below, NOT as a DB constraint —
--                         convert_lead, bulk imports, and merges must
--                         never hard-fail on it (her Q5 answer:
--                         grandfather + cleanup list, prompt not block).
--
-- Also here, because they must ship atomically with the columns:
--   - toggle-off trigger: sales_active true→false clears the follow-up
--     date on EVERY write path (form, imports, merges), matching Q4.
--   - call-list activation rule (her Q8 answer): an account auto-
--     activates when one of its contacts is added to any list, and
--     auto-deactivates when its contacts leave ALL lists — unless the
--     account is a current client or partner.
--   - drop+recreate of the three views that snapshot accounts.* so the
--     new columns are visible to /partners, the report engine, and the
--     suppression list (CREATE OR REPLACE cannot append columns; the
--     20260707140000 pattern, suppression logic byte-identical).
--   - v_follow_up_gaps data-health view (the cleanup list).
--   - one grouped daily "follow-ups due" bell notification (her Q6
--     answer: never one ping per account), registered in the
--     scheduled-jobs status card + watchdog like every other job.
-- ---------------------------------------------------------------------

begin;

-- 1. Columns --------------------------------------------------------------
alter table public.accounts
  add column if not exists sales_active boolean not null default false,
  add column if not exists sales_status text,
  add column if not exists next_follow_up_date date;

create index if not exists idx_accounts_sales_active
  on public.accounts (sales_active) where sales_active;
create index if not exists idx_accounts_next_follow_up
  on public.accounts (next_follow_up_date) where next_follow_up_date is not null;

comment on column public.accounts.sales_active is
  'Sales Status toggle: true = actively being worked, false = cold database. Manual, plus the call-list auto-rule (trg_list_member_sales_active).';
comment on column public.accounts.sales_status is
  'Sales sub-status while worked (picklist accounts.sales_status). Deliberately KEPT when sales_active flips off — shown as history (Summer Q4).';
comment on column public.accounts.next_follow_up_date is
  'Rep-managed follow-up date. Required (form-level only) while sales_status is identified_outreach/engaged/nurture or an opp is open; gaps surface in v_follow_up_gaps.';

-- 1b. Un-require the old Status field. The account form stops submitting
--     `status` in this same release, and staging/prod have a live
--     (accounts, status, required=true) config row — left on, the required-
--     fields check would block EVERY account create the moment the form
--     deploys (the exact trap 20260630000003 documented for account_type).
update public.required_field_config
   set is_required = false
 where entity = 'accounts'
   and field_key = 'status';

-- 2. Sub-status vocabulary (admin-editable) --------------------------------
insert into public.picklist_options (field_key, value, label, sort_order, is_active)
values
  ('accounts.sales_status', 'prospecting',         'Prospecting',         10, true),
  ('accounts.sales_status', 'identified_outreach', 'Identified Outreach', 20, true),
  ('accounts.sales_status', 'engaged',             'Engaged',             30, true),
  ('accounts.sales_status', 'nurture',             'Nurture',             40, true)
on conflict (field_key, value)
  do update set label = excluded.label,
                sort_order = excluded.sort_order,
                is_active = true;

-- 3. Toggle-off clears the follow-up date (every write path) ---------------
create or replace function public.trg_accounts_sales_toggle_off()
returns trigger
language plpgsql
as $$
begin
  if old.sales_active and not new.sales_active then
    new.next_follow_up_date := null;   -- Q4: date cleared, sub-status kept
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_toggle_off on public.accounts;
create trigger trg_sales_toggle_off
  before update of sales_active on public.accounts
  for each row execute function public.trg_accounts_sales_toggle_off();

-- 4. Call-list activation rule (Summer Q8) ---------------------------------
-- Add a contact to any list  → its account activates (sub-status defaults
--                              to Prospecting if unset).
-- Remove from a list         → if NO contact of that account remains on ANY
--                              list, deactivate — unless the account is a
--                              current client or a partner (her exception).
-- Fail-soft like trg_opp_customer_status: a rule bug must never block the
-- list edit itself (bulk list imports fire this per row).
create or replace function public.trg_list_member_sales_active()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account uuid;
begin
  begin
    if tg_op = 'INSERT' then
      select c.account_id into v_account
        from public.contacts c where c.id = new.contact_id;
      if v_account is not null then
        update public.accounts a
           set sales_active = true,
               sales_status = coalesce(a.sales_status, 'prospecting')
         where a.id = v_account
           and a.sales_active = false;
      end if;
      return new;
    end if;

    if tg_op = 'DELETE' then
      select c.account_id into v_account
        from public.contacts c where c.id = old.contact_id;
      if v_account is not null
         and not exists (                        -- any of the account's
           select 1                              -- contacts still on a list?
             from public.lead_list_members m
             join public.contacts c2 on c2.id = m.contact_id
            where c2.account_id = v_account
         ) then
        update public.accounts a
           set sales_active = false               -- trg_sales_toggle_off
         where a.id = v_account                   -- clears the date
           and a.sales_active = true
           and a.customer_status <> 'client'      -- Q8 exception
           and coalesce(a.account_type, '') not ilike 'Partner%';
      end if;
      return old;
    end if;

    return coalesce(new, old);
  exception when others then
    raise warning 'sales_active list rule failed for member %: %',
      coalesce(new.id, old.id), sqlerrm;
    return coalesce(new, old);
  end;
end;
$$;

drop trigger if exists trg_list_member_sales_active on public.lead_list_members;
create trigger trg_list_member_sales_active
  after insert or delete on public.lead_list_members
  for each row execute function public.trg_list_member_sales_active();

-- 5. Recreate the accounts.*-snapshot views so new columns flow through ----
-- 5a. v_accounts_with_activity — verbatim from 20260707160000 (definition
--     unchanged; recreated only to refresh the a.* snapshot).
drop view if exists public.v_accounts_with_activity;
create view public.v_accounts_with_activity
with (security_invoker = on) as
select
  a.*,
  la.last_activity_at,
  coalesce(la.last_activity_at, a.created_at) as effective_last_touch
from public.accounts a
left join public.v_account_last_activity la on la.account_id = a.id;

comment on view public.v_accounts_with_activity is
  'accounts + last_activity_at (v_account_last_activity) + never-null effective_last_touch. Lets account reports server-side sort/filter by outreach recency across ALL rows (not a client-side page). Mirrors v_opportunities_with_activity.';

grant select on public.v_accounts_with_activity to authenticated;
revoke all on public.v_accounts_with_activity from anon;

-- 5b. v_partner_accounts + v_marketing_suppression — verbatim from
--     20260707140000 (logic byte-identical; dropped/recreated together
--     because suppression depends on the partner view and a.* must
--     re-snapshot). Suppression is the do-not-email compliance list:
--     NO logic change is intended in this migration.
drop view if exists public.v_marketing_suppression;
drop view if exists public.v_partner_accounts;

create view public.v_partner_accounts
with (security_invoker = on) as
with member_counts as (
  select partner_account_id as account_id, count(*)::int as member_count
  from public.account_partners
  group by partner_account_id
),
members as (
  select distinct member_account_id as account_id
  from public.account_partners
)
select
  a.*,
  coalesce(mc.member_count, 0)        as member_count,
  (mc.account_id is not null)         as is_umbrella,
  (mem.account_id is not null)        as is_member,
  (mc.account_id is not null and mem.account_id is null) as is_top_level,
  up.full_name                        as owner_full_name
from public.accounts a
left join member_counts mc on mc.account_id = a.id
left join members mem       on mem.account_id = a.id
left join public.user_profiles up on up.id = a.owner_user_id
where a.archived_at is null
  and (
    a.account_type ilike 'Partner%'
    or a.partner_account is not null
    or a.partner_prospect = true
    or mc.account_id is not null
    or mem.account_id is not null
  );

comment on view public.v_partner_accounts is
  'Partner-flagged accounts (account_type ILIKE Partner%, legacy partner_account text, partner_prospect, any account_partners umbrella, OR any member under an umbrella) with member_count + umbrella/member/top_level flags + partner_type. Powers /partners server-side.';

grant select on public.v_partner_accounts to authenticated;
revoke all on public.v_partner_accounts from anon;

create view public.v_marketing_suppression
with (security_invoker = on) as
with won as (
  select o.account_id,
         bool_or(
           (o.contract_end_date is not null and o.contract_end_date >= current_date)
           or (o.contract_end_date is null and o.close_date is not null
               and o.close_date >= current_date - 365)
         ) as active_won
    from public.opportunities o
   where o.stage = 'closed_won'
     and o.archived_at is null
     and o.account_id is not null
   group by o.account_id
),
c as (
  select c.id, c.first_name, c.last_name, em.email, c.account_id, c.owner_user_id,
         c.do_not_contact, c.no_longer_employed, c.archived_at,
         a.name as account_name, a.account_type, a.lifecycle_status,
         a.do_not_contact as account_dnc, a.archived_at as account_archived,
         (w.account_id is not null)       as ever_won,
         coalesce(w.active_won, false)     as active_won
    from public.contacts c
    left join public.accounts a on a.id = c.account_id
    left join won w on w.account_id = c.account_id
    cross join lateral (
      select e as email
        from unnest(array[
          nullif(btrim(c.email), ''),
          nullif(btrim(c.email2), ''),
          nullif(btrim(c.email3), '')
        ]) as e
       where e is not null
    ) em
),
l as (
  select l.id, l.first_name, l.last_name, l.email, l.company, l.owner_user_id,
         l.do_not_market_to, l.do_not_contact, l.avoid_reason, l.archived_at
    from public.leads l
   where l.email is not null and btrim(l.email) <> ''
)
select 'contact'::text as source_kind, c.id as source_id, 'customer_account'::text as reason,
       c.first_name, c.last_name, c.email, c.account_name as company,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where (c.active_won or c.lifecycle_status = 'customer')
union all
select 'contact', c.id, 'former_customer_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where not (c.active_won or c.lifecycle_status = 'customer')
   and (c.ever_won or c.lifecycle_status = 'former_customer')
union all
select 'contact', c.id, 'partner_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where c.account_id is not null
   and (
        exists (select 1 from public.v_partner_accounts vpa where vpa.id = c.account_id)
        or c.account_type ilike 'Partner%'
       )
union all
select 'contact', c.id, 'contact_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.do_not_contact = true
union all
select 'contact', c.id, 'account_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.account_dnc = true
union all
select 'contact', c.id, 'contact_no_longer_employed',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.no_longer_employed = true
union all
select 'contact', c.id, 'contact_archived',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.archived_at is not null
union all
select 'lead', l.id, 'lead_do_not_market',
       l.first_name, l.last_name, l.email, l.company,
       null::uuid, null::text, null::public.account_lifecycle, l.owner_user_id
  from l where l.do_not_market_to = true
union all
select 'lead', l.id, 'lead_do_not_contact',
       l.first_name, l.last_name, l.email, l.company,
       null::uuid, null::text, null::public.account_lifecycle, l.owner_user_id
  from l where l.do_not_contact = true
union all
select 'lead', l.id, 'lead_avoid',
       l.first_name, l.last_name, l.email, l.company,
       null::uuid, null::text, null::public.account_lifecycle, l.owner_user_id
  from l where l.avoid_reason is not null
union all
select 'lead', l.id, 'lead_archived',
       l.first_name, l.last_name, l.email, l.company,
       null::uuid, null::text, null::public.account_lifecycle, l.owner_user_id
  from l where l.archived_at is not null;

grant select on public.v_marketing_suppression to authenticated;
revoke all on public.v_marketing_suppression from anon;

-- 6. The cleanup list (Summer Q5: grandfather + burn-down, never block) ----
create view public.v_follow_up_gaps
with (security_invoker = on) as
select
  a.id,
  a.name,
  a.owner_user_id,
  up.full_name as owner_full_name,
  a.sales_active,
  a.sales_status,
  a.customer_status,
  exists (
    select 1 from public.opportunities o
     where o.account_id = a.id
       and o.archived_at is null
       and o.stage not in ('closed_won', 'closed_lost')
  ) as has_open_opportunity
from public.accounts a
left join public.user_profiles up on up.id = a.owner_user_id
where a.archived_at is null
  and a.next_follow_up_date is null
  and (
    (a.sales_active and a.sales_status in ('identified_outreach', 'engaged', 'nurture'))
    or exists (
      select 1 from public.opportunities o
       where o.account_id = a.id
         and o.archived_at is null
         and o.stage not in ('closed_won', 'closed_lost')
    )
  );

comment on view public.v_follow_up_gaps is
  'Accounts that SHOULD have a next_follow_up_date (worked sub-status or open opp) but don''t. The rule is deliberately not a DB constraint — imports/merges/conversion must never hard-fail. This is the burn-down list (Summer Q5a).';

grant select on public.v_follow_up_gaps to authenticated;
revoke all on public.v_follow_up_gaps from anon;

-- 7. Grouped daily follow-up notification (Summer Q6) -----------------------
-- ONE bell row per owner per day ("You have N follow-ups due"), never one
-- per account. Off-switch: user_notification_prefs.prefs->>'follow_up_due_bell'
-- = 'false' (Settings UI ships with the frontend slice).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'task_due', 'renewal_upcoming', 'deal_stage_change', 'mention',
    'engagement', 'system',
    'meddy_new_chat', 'meddy_human_requested', 'meddy_buying_intent',
    'meddy_missed_chat', 'meddy_contact_received',
    'support_human_requested', 'support_new_chat',
    'deal_high_five',
    'follow_up_due'
  ));

create or replace function public.notify_follow_ups_due()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, message, link)
  select
    d.owner_user_id,
    'follow_up_due',
    'Follow-ups due',
    case when d.n = 1
         then 'You have 1 account follow-up due today or overdue.'
         else format('You have %s account follow-ups due today or overdue.', d.n)
    end,
    '/accounts?follow_up=due&sales=active'
  from (
    select a.owner_user_id, count(*)::int as n
      from public.accounts a
     where a.archived_at is null
       and a.sales_active
       and a.next_follow_up_date is not null
       and a.next_follow_up_date <= current_date
       and a.owner_user_id is not null
     group by a.owner_user_id
  ) d
  join public.user_profiles up
    on up.id = d.owner_user_id and coalesce(up.is_active, true)
  left join public.user_notification_prefs p on p.user_id = d.owner_user_id
  where coalesce((p.prefs->>'follow_up_due_bell')::boolean, true)   -- off-switch
    and not exists (                                                -- one per day
      select 1 from public.notifications n
       where n.user_id = d.owner_user_id
         and n.type = 'follow_up_due'
         and n.created_at >= date_trunc('day', timezone('utc', now()))
    );
end;
$$;

comment on function public.notify_follow_ups_due() is
  'Daily grouped bell: one follow_up_due notification per owner with a due-or-overdue count. Deduped per UTC day; respects prefs->>follow_up_due_bell.';

commit;

-- 8. Schedule (outside the txn, fail-soft — the 20260630000002 pattern;
--    the watchdog registration below makes a silent skip visible).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[follow_up_due] pg_cron not installed — daily notification not scheduled (still callable via notify_follow_ups_due())';
    return;
  end if;
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'follow_up_due_daily';
  perform cron.schedule(
    'follow_up_due_daily',
    '45 9 * * *',
    $cron$ select public.notify_follow_ups_due(); $cron$
  );
exception when others then
  raise warning '[follow_up_due] pg_cron schedule failed (callable manually): %', sqlerrm;
end $$;

-- 9. Register the job in the admin status card + watchdog -------------------
-- Both functions hard-code their expected-job lists (the fail-soft-install
-- trap that once left renewal automation unscheduled for weeks), so they are
-- re-emitted verbatim-plus-one-row from 20260711200000 / 20260711220000.
create or replace function public.scheduled_jobs_status()
returns table (
  jobname text,
  kind text,               -- 'sql' (migration-installed) | 'http' (hand-pasted literals)
  required boolean,        -- expected on EVERY environment
  installed boolean,
  active boolean,
  schedule text,
  last_run_at timestamptz,
  last_run_status text,
  last_run_message text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can view scheduled job status';
  end if;

  if to_regclass('cron.job') is null then
    return query
    select e.name, e.kind, e.req, false, false,
           null::text, null::timestamptz, null::text,
           'pg_cron not available on this database'::text
    from (values
      ('renewal_automation_daily',    'sql',  true),
      ('customer-status-daily-sweep', 'sql',  true),
      ('follow_up_due_daily',         'sql',  true),
      ('spawn_recurring_tasks_daily', 'sql',  true),
      ('import_runs_retention_daily', 'sql',  true),
      ('meddy-stale-agents',          'sql',  true),
      ('scheduled_job_watchdog_daily','sql',  true),
      ('email_sync_every_10_min',     'http', false),
      ('task_reminders_every_5_min',  'http', false),
      ('clickup_sf_id_sync_daily',    'http', false),
      ('clickup_services_sync_daily', 'http', false),
      ('meddy_sweep_every_5_min',     'http', false),
      ('task_digest_weekday_morning', 'http', false)
    ) as e(name, kind, req);
    return;
  end if;

  return query
  select
    e.name,
    e.kind,
    e.req,
    (j.jobid is not null),
    coalesce(j.active, false),
    j.schedule::text,
    d.start_time,
    d.status::text,
    left(coalesce(d.return_message, ''), 200)
  from (values
    ('renewal_automation_daily',    'sql',  true),
    ('customer-status-daily-sweep', 'sql',  true),
    ('follow_up_due_daily',         'sql',  true),
    ('spawn_recurring_tasks_daily', 'sql',  true),
    ('import_runs_retention_daily', 'sql',  true),
    ('meddy-stale-agents',          'sql',  true),
    ('scheduled_job_watchdog_daily','sql',  true),
    ('email_sync_every_10_min',     'http', false),
    ('task_reminders_every_5_min',  'http', false),
    ('clickup_sf_id_sync_daily',    'http', false),
    ('clickup_services_sync_daily', 'http', false),
    ('meddy_sweep_every_5_min',     'http', false),
    ('task_digest_weekday_morning', 'http', false)
  ) as e(name, kind, req)
  left join cron.job j on j.jobname = e.name
  left join lateral (
    select r.status, r.return_message, r.start_time
    from cron.job_run_details r
    where r.jobid = j.jobid
    order by r.start_time desc
    limit 1
  ) d on true
  order by e.req desc, e.name;
end $$;

comment on function public.scheduled_jobs_status() is
  'Admin-only: every known pg_cron job with installed/active/last-run state. kind=sql jobs are installed by migrations and required on every env; kind=http jobs carry hand-pasted URL+key literals and may legitimately exist on prod only. Shown in Admin → System.';

revoke all on function public.scheduled_jobs_status() from public, anon;
grant execute on function public.scheduled_jobs_status() to authenticated;

create or replace function public.scheduled_job_watchdog()
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anomalies text[] := '{}';
  v_expected  record;
  v_job       record;
  v_last      record;
  v_run       record;
  v_msg       text;
begin
  -- Every known pg_cron job. required=true (pure-SQL, migration-installed)
  -- must exist on every env; required=false (hand-pasted URL+key literals,
  -- or not-yet-configured integrations like ClickUp) is only checked where
  -- it is actually installed, so environments that intentionally don't run
  -- a job stay quiet.
  if to_regclass('cron.job') is not null then
    for v_expected in
      select e.jobname, e.max_gap, e.required
      from (values
        ('renewal_automation_daily',    interval '26 hours',   true),
        ('customer-status-daily-sweep', interval '26 hours',   true),
        ('follow_up_due_daily',         interval '26 hours',   true),
        ('spawn_recurring_tasks_daily', interval '26 hours',   true),
        ('import_runs_retention_daily', interval '26 hours',   true),
        ('meddy-stale-agents',          interval '15 minutes', true),
        ('email_sync_every_10_min',     interval '40 minutes', false),
        ('task_reminders_every_5_min',  interval '30 minutes', false),
        ('clickup_sf_id_sync_daily',    interval '26 hours',   false),
        ('clickup_services_sync_daily', interval '26 hours',   false),
        ('meddy_sweep_every_5_min',     interval '30 minutes', false),
        -- weekday-only job: the Fri→Mon gap is ~72h, so allow 80
        ('task_digest_weekday_morning', interval '80 hours',   false)
      ) as e(jobname, max_gap, required)
    loop
      select j.jobid, j.active into v_job
      from cron.job j
      where j.jobname = v_expected.jobname;

      if not found then
        if v_expected.required then
          v_anomalies := v_anomalies || (v_expected.jobname
            || ': not installed in pg_cron (its migration''s schedule step may '
            || 'have been skipped — re-run it; see 20260711200000 for the pattern)');
        end if;
        -- optional job absent on this env: by design, stay quiet
        continue;
      end if;

      if not v_job.active then
        v_anomalies := v_anomalies || (v_expected.jobname
          || ': schedule exists but is disabled (cron.job.active = false)');
        continue;
      end if;

      select d.status, d.return_message, d.start_time into v_last
      from cron.job_run_details d
      where d.jobid = v_job.jobid
      order by d.start_time desc
      limit 1;

      if not found then
        continue;
      elsif v_last.start_time < now() - v_expected.max_gap then
        v_anomalies := v_anomalies || format(
          '%s: last run was %s (expected one within %s)',
          v_expected.jobname,
          to_char(v_last.start_time at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
          v_expected.max_gap);
      elsif v_last.status = 'failed' then
        v_anomalies := v_anomalies || format(
          '%s: last run failed — %s',
          v_expected.jobname,
          left(coalesce(v_last.return_message, 'no message'), 200));
      end if;
    end loop;
  end if;

  -- Run-log freshness — did the work actually happen?
  if to_regclass('public.renewal_automation_runs') is not null then
    select r.started_at, r.error_message into v_run
    from public.renewal_automation_runs r
    order by r.started_at desc
    limit 1;
    if found then
      if v_run.started_at < now() - interval '26 hours' then
        v_anomalies := v_anomalies || format(
          'renewal automation: no run logged since %s (renewal_automation_runs)',
          to_char(v_run.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
      elsif v_run.error_message is not null then
        v_anomalies := v_anomalies ||
          ('renewal automation: latest run errored — ' || left(v_run.error_message, 200));
      end if;
    end if;
  end if;

  if to_regclass('public.email_sync_runs') is not null
     and to_regclass('public.email_sync_connections') is not null
     and exists (select 1 from public.email_sync_connections c where c.is_active) then
    select max(r.started_at) as started_at into v_run
    from public.email_sync_runs r;
    if v_run.started_at is not null
       and v_run.started_at < now() - interval '2 hours' then
      v_anomalies := v_anomalies || format(
        'email sync: no run logged since %s despite active connections (email_sync_runs)',
        to_char(v_run.started_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
    end if;
  end if;

  -- ClickUp snapshot freshness — ONLY while the ClickUp sync is actually
  -- switched on (parked 2026-07-11 until ClickUp is configured).
  if to_regclass('public.clickup_services_snapshots') is not null
     and to_regclass('cron.job') is not null
     and exists (
       select 1 from cron.job
       where jobname = 'clickup_services_sync_daily' and active
     ) then
    select max(s.captured_at) as captured_at into v_run
    from public.clickup_services_snapshots s;
    if v_run.captured_at is not null
       and v_run.captured_at < now() - interval '26 hours' then
      v_anomalies := v_anomalies || format(
        'clickup services sync: no snapshot since %s (clickup_services_snapshots)',
        to_char(v_run.captured_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'));
    end if;
  end if;

  -- Notify admins (one aggregated notification each, deduped)
  if coalesce(array_length(v_anomalies, 1), 0) = 0 then
    return;
  end if;

  v_msg := left(
    'The daily watchdog found problems with scheduled background jobs: '
    || array_to_string(v_anomalies, '; ')
    || '. See Admin → System → Scheduled Jobs and the run-log tables.',
    1800);

  insert into public.notifications (user_id, type, title, message, link)
  select up.id, 'system', 'Scheduled jobs need attention', v_msg, '/admin?tab=system'
  from public.user_profiles up
  where up.role in ('admin', 'super_admin')
    and coalesce(up.is_active, true)
    and not exists (
      select 1 from public.notifications n
      where n.user_id = up.id
        and n.title = 'Scheduled jobs need attention'
        and (n.is_read = false or n.created_at > now() - interval '20 hours')
    );

  return query select unnest(v_anomalies);
end;
$$;

comment on function public.scheduled_job_watchdog() is
  'Daily anomaly sweep over pg_cron jobs + run-log freshness; notifies admins. '
  'ClickUp checks are gated on its cron job being installed+active (parked 2026-07-11). '
  'follow_up_due_daily added 2026-07-15 (account restructure Step 1).';

notify pgrst, 'reload schema';
