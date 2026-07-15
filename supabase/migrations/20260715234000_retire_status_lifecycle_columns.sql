-- ---------------------------------------------------------------------
-- Account Status Restructure, Step 3 (final) — retire accounts.status and
-- accounts.lifecycle_status entirely.
--
-- After Steps 1-2 the two old columns are unused by product logic (the
-- account form, renewal automation, reports, suppression and the Partners
-- page all read customer_status / sales_status now). This drops the
-- physical columns and every DB object that still reads them, so the CRM
-- ends with exactly two account-status concepts: Account Status
-- (customer_status, derived) and Sales Status (sales_active/sales_status).
--
-- The two ENUM TYPES (public.account_status, public.account_lifecycle) are
-- deliberately KEPT — they are harmless once the columns are gone, and a
-- couple of display columns (v_lost_customers_qtd.account_status,
-- v_marketing_suppression.lifecycle_status) keep their historical type via
-- a customer_status -> account_lifecycle mapping so their consumers and the
-- CREATE-OR-REPLACE contract are untouched.
--
-- Ordering (all in one transaction — Postgres DDL is transactional, so any
-- unforeseen dependency rolls the whole thing back cleanly):
--   0. correct Step-2's no-op drop of find_renewal_backfill_anchor(date)
--   1. redefine v_lost_customers_qtd OFF lifecycle_status (CREATE OR REPLACE,
--      type preserved) so the column is droppable without touching the
--      dashboard that depends on it
--   2. drop the a.*-snapshot / column-reading views (suppression -> partner
--      -> activity) so DROP COLUMN isn't blocked
--   3. re-emit the 3 dedup finders returning customer_status (was
--      lifecycle_status + account_status)
--   4. drop the accounts.status derivation machinery (trigger + fns)
--   5. re-emit execute_opportunity_automations without the (now dead,
--      column-writing) update_account_status action branch
--   6. DROP the two columns
--   7. recreate the three views (a.* now excludes the dropped columns;
--      suppression sourced off customer_status, behaviour-neutral)
-- ---------------------------------------------------------------------

begin;

-- 0. Step-2 left this (date)-arg diagnostic behind (its drop targeted the
--    no-arg overload). No consumers.
drop function if exists public.find_renewal_backfill_anchor(date);

-- 1. v_lost_customers_qtd off lifecycle_status, type preserved -------------
--    Only the account_status source line changes vs 20260715232000; column
--    list/order/types identical so CREATE OR REPLACE holds and
--    v_dashboard_metrics (count/sum consumer) is unaffected.
create or replace view public.v_lost_customers_qtd as
select
  o.id,
  a.name                             as account_name,
  o.name                             as opportunity_name,
  o.stage,
  (case a.customer_status
     when 'client'        then 'customer'
     when 'former_client' then 'former_customer'
     else                      'prospect'
   end)::public.account_lifecycle    as account_status,
  public.fiscal_period_label(o.close_date) as fiscal_period,
  o.amount,
  o.probability,
  case
    when o.close_date is not null then (current_date - o.close_date)
    else (current_date - o.created_at::date)
  end                                as age,
  o.close_date,
  o.created_at::date                 as created_date,
  o.next_step,
  o.lead_source,
  case o.kind
    when 'new_business' then 'New Business'
    when 'renewal'      then 'Existing Business'
    else ''
  end                                as type,
  o.account_id
from public.opportunities o
join public.accounts a on a.id = o.account_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage = 'closed_lost'
  and o.kind = 'renewal'
  and a.customer_status = 'former_client'
  and o.close_date between public.current_fiscal_quarter_start()
                       and public.current_fiscal_quarter_end();

comment on view public.v_lost_customers_qtd is
  'Existing Business closed-lost in the current fiscal quarter on former-client accounts. Dashboard churn metric. account_status column is customer_status mapped to the account_lifecycle type for contract stability.';

-- 1b. Two more column readers with no code consumers -----------------------
--     v_account_status_audit audits accounts.status vs deal history — it
--     audits the field being retired, so it is now meaningless. Drop it.
drop view if exists public.v_account_status_audit;

--     v_renewal_data_gaps exposes a lifecycle_status display column (no
--     filter, no consumer). Re-point it to customer_status (same name,
--     same text type => CREATE OR REPLACE holds) so the diagnostic survives
--     and stops reading the retiring column. One line changes vs
--     20260519000005 (the a.lifecycle_status source).
create or replace view public.v_renewal_data_gaps
  with (security_invoker = on)
as
with opp_product_counts as (
  select
    o.id                   as opportunity_id,
    count(op.id)           as line_item_count
  from public.opportunities o
  left join public.opportunity_products op on op.opportunity_id = o.id
  where o.archived_at is null
  group by o.id
)
select
  case
    when o.stage = 'closed_won'                                then 'closed_won_no_products'
    when o.kind = 'renewal' and o.stage not in ('closed_lost') then 'queued_renewal_no_products'
    else                                                            'open_opp_no_products'
  end                                                          as gap_category,
  o.id                                                         as opportunity_id,
  o.name                                                       as opportunity_name,
  o.kind::text                                                 as kind,
  o.stage::text                                                as stage,
  o.amount,
  o.close_date,
  o.expected_close_date,
  o.contract_end_date,
  o.contract_length_months,
  o.contract_year,
  o.renewal_from_opportunity_id                                as parent_opportunity_id,
  o.imported_at,
  o.account_id,
  a.name                                                       as account_name,
  a.customer_status::text                                      as lifecycle_status,
  o.owner_user_id,
  up.full_name                                                 as owner_name,
  case
    when o.imported_at is not null                             then 'sf_migrated'
    else                                                            'native'
  end                                                          as origin,
  o.created_at
from public.opportunities o
join opp_product_counts pc on pc.opportunity_id = o.id
join public.accounts a     on a.id = o.account_id
left join public.user_profiles up on up.id = o.owner_user_id
where o.archived_at is null
  and a.archived_at is null
  and pc.line_item_count = 0
  and o.stage not in ('closed_lost')
  and coalesce(o.one_time_project, false) = false
  and coalesce(o.amount, 0) > 0;

-- 2. Drop the views that snapshot a.* or read the columns (dependents first)
drop view if exists public.v_marketing_suppression;
drop view if exists public.v_partner_accounts;
drop view if exists public.v_accounts_with_activity;

-- 3. Dedup finders — return customer_status instead of lifecycle_status /
--    account_status (return-type change => DROP + recreate) ----------------
drop function if exists public.find_duplicate_accounts(text);
create or replace function public.find_duplicate_accounts(account_name text)
returns table (id uuid, name text, customer_status text, owner_user_id uuid, similarity_score float)
language plpgsql stable as $$
begin
  return query
  select a.id, a.name, a.customer_status, a.owner_user_id,
    case when lower(a.name) = lower(account_name) then 1.0::float
         when lower(a.name) like lower(account_name) || '%' then 0.9::float
         when lower(a.name) like '%' || lower(account_name) || '%' then 0.7::float
         else 0.5::float end as similarity_score
  from public.accounts a where a.archived_at is null
    and (lower(a.name) = lower(account_name) or lower(a.name) like '%' || lower(account_name) || '%' or lower(account_name) like '%' || lower(a.name) || '%')
  order by similarity_score desc limit 10;
end;
$$;

drop function if exists public.find_account_duplicate_groups(integer);
create or replace function public.find_account_duplicate_groups(
  p_limit_groups integer default 500
)
returns table (
  group_key         text,
  group_size        integer,
  account_id        uuid,
  name              text,
  account_number    text,
  customer_status   text,
  owner_user_id     uuid,
  owner_name        text,
  contact_count     integer,
  opportunity_count integer,
  has_closed_won    boolean,
  open_opp_count    integer,
  total_won_amount  numeric,
  created_at        timestamptz,
  last_activity_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with guard as (
    select coalesce(public.is_admin(), false) as ok
  ),
  live as (
    select a.id, a.name, a.account_number, a.customer_status,
           a.owner_user_id, a.created_at,
           public.norm_company(a.name) as nkey
      from public.accounts a, guard g
     where g.ok
       and a.archived_at is null
       and public.norm_company(a.name) is not null
  ),
  group_ids as (
    select nkey, array_agg(id order by id) as ids, count(*)::int as group_size
      from live
     group by nkey
    having count(*) > 1
  ),
  grouped as (
    select gi.nkey, gi.group_size
      from group_ids gi
     where not exists (
       select 1 from public.account_duplicate_dismissals d
        where d.group_account_ids = gi.ids
     )
     order by gi.group_size desc
     limit greatest(p_limit_groups, 0)
  )
  select
    l.nkey as group_key,
    g.group_size,
    l.id   as account_id,
    l.name,
    l.account_number,
    l.customer_status,
    l.owner_user_id,
    up.full_name as owner_name,
    (select count(*)::int from public.contacts c
       where c.account_id = l.id and c.archived_at is null)            as contact_count,
    (select count(*)::int from public.opportunities o
       where o.account_id = l.id and o.archived_at is null)            as opportunity_count,
    exists (select 1 from public.opportunities o
       where o.account_id = l.id and o.archived_at is null
         and o.stage = 'closed_won')                                   as has_closed_won,
    (select count(*)::int from public.opportunities o
       where o.account_id = l.id and o.archived_at is null
         and o.stage not in ('closed_won','closed_lost'))              as open_opp_count,
    coalesce((select sum(o.amount) from public.opportunities o
       where o.account_id = l.id and o.archived_at is null
         and o.stage = 'closed_won'), 0)                               as total_won_amount,
    l.created_at,
    (select max(coalesce(act.completed_at, act.due_at, act.created_at))
       from public.activities act where act.account_id = l.id)         as last_activity_at
    from live l
    join grouped g on g.nkey = l.nkey
    left join public.user_profiles up on up.id = l.owner_user_id
   order by g.group_size desc, l.nkey,
            (exists (select 1 from public.opportunities o
                      where o.account_id = l.id and o.archived_at is null
                        and o.stage = 'closed_won')) desc,
            l.created_at asc;
$$;
grant execute on function public.find_account_duplicate_groups(integer) to authenticated;

drop function if exists public.find_accounts_sharing_email_domain(integer);
create or replace function public.find_accounts_sharing_email_domain(
  p_limit_groups integer default 500
)
returns table (
  group_key         text,
  group_size        integer,
  account_id        uuid,
  name              text,
  account_number    text,
  customer_status   text,
  owner_user_id     uuid,
  owner_name        text,
  contact_count     integer,
  opportunity_count integer,
  has_closed_won    boolean,
  open_opp_count    integer,
  total_won_amount  numeric,
  created_at        timestamptz,
  last_activity_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with guard as (
    select coalesce(public.is_admin(), false) as ok
  ),
  acct_domain as (
    select distinct a.id as account_id, a.name, a.account_number, a.customer_status,
           a.owner_user_id, a.created_at,
           lower(split_part(c.email, '@', 2)) as domain
      from public.contacts c
      join public.accounts a on a.id = c.account_id
      cross join guard g
     where g.ok
       and a.archived_at is null
       and c.archived_at is null
       and c.email is not null
       and position('@' in c.email) > 0
       and lower(split_part(c.email, '@', 2)) <> ''
       and lower(split_part(c.email, '@', 2)) not in (
         'gmail.com','googlemail.com','yahoo.com','ymail.com','hotmail.com','outlook.com',
         'live.com','msn.com','aol.com','icloud.com','me.com','mac.com','comcast.net',
         'verizon.net','att.net','sbcglobal.net','cox.net','bellsouth.net','protonmail.com',
         'proton.me','zoho.com','mail.com','gmx.com','yandex.com','ymail.com'
       )
  ),
  dom_ids as (
    select domain, array_agg(distinct account_id) as ids_unsorted, count(distinct account_id)::int as group_size
      from acct_domain
     group by domain
    having count(distinct account_id) > 1
  ),
  dom_groups as (
    select d.domain,
           (select array_agg(x order by x) from unnest(d.ids_unsorted) x) as ids,
           d.group_size
      from dom_ids d
  ),
  kept as (
    select dg.domain, dg.group_size
      from dom_groups dg
     where not exists (
       select 1 from public.account_duplicate_dismissals ds
        where ds.group_account_ids = dg.ids
     )
     order by dg.group_size desc
     limit greatest(p_limit_groups, 0)
  )
  select
    ad.domain as group_key,
    k.group_size,
    ad.account_id,
    ad.name,
    ad.account_number,
    ad.customer_status,
    ad.owner_user_id,
    up.full_name as owner_name,
    (select count(*)::int from public.contacts c
       where c.account_id = ad.account_id and c.archived_at is null)            as contact_count,
    (select count(*)::int from public.opportunities o
       where o.account_id = ad.account_id and o.archived_at is null)            as opportunity_count,
    exists (select 1 from public.opportunities o
       where o.account_id = ad.account_id and o.archived_at is null
         and o.stage = 'closed_won')                                            as has_closed_won,
    (select count(*)::int from public.opportunities o
       where o.account_id = ad.account_id and o.archived_at is null
         and o.stage not in ('closed_won','closed_lost'))                       as open_opp_count,
    coalesce((select sum(o.amount) from public.opportunities o
       where o.account_id = ad.account_id and o.archived_at is null
         and o.stage = 'closed_won'), 0)                                        as total_won_amount,
    ad.created_at,
    (select max(coalesce(act.completed_at, act.due_at, act.created_at))
       from public.activities act where act.account_id = ad.account_id)         as last_activity_at
  from acct_domain ad
  join kept k on k.domain = ad.domain
  left join public.user_profiles up on up.id = ad.owner_user_id
  group by ad.domain, k.group_size, ad.account_id, ad.name, ad.account_number,
           ad.customer_status, ad.owner_user_id, up.full_name, ad.created_at
  order by k.group_size desc, ad.domain,
           (exists (select 1 from public.opportunities o
                     where o.account_id = ad.account_id and o.archived_at is null
                       and o.stage = 'closed_won')) desc,
           ad.created_at asc;
$$;
grant execute on function public.find_accounts_sharing_email_domain(integer) to authenticated;

-- 4. accounts.status derivation machinery — drop trigger before functions --
drop trigger if exists trg_recompute_account_status on public.opportunities;
drop function if exists public.recompute_account_status_from_opp();
drop function if exists public.derive_account_status(uuid);
drop function if exists public.recompute_all_account_statuses();

-- 5. Re-emit the opp automation executor without the update_account_status
--    action (it wrote accounts.status w/ an enum cast; the column is gone
--    and no active rule uses it — Step 2 deactivated the templates). Rest
--    verbatim from 20260405000001.
create or replace function public.execute_opportunity_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rule record;
  action jsonb;
  condition jsonb;
  conditions_match boolean;
begin
  if tg_op != 'UPDATE' or new.stage is not distinct from old.stage then
    return new;
  end if;

  for rule in
    select * from public.automation_rules
    where is_active = true
      and trigger_entity = 'opportunities'
      and trigger_event in ('stage_changed', 'updated')
  loop
    conditions_match := true;

    for condition in select * from jsonb_array_elements(rule.trigger_conditions)
    loop
      declare
        field_name text := condition->>'field';
        op text := condition->>'operator';
        expected text := condition->>'value';
        actual text;
      begin
        if field_name = 'stage' then
          actual := new.stage::text;
          if op = 'eq' and actual != expected then
            conditions_match := false;
          elsif op = 'neq' and actual = expected then
            conditions_match := false;
          end if;
        end if;
      end;
    end loop;

    if conditions_match then
      for action in select * from jsonb_array_elements(rule.actions)
      loop
        declare
          action_type text := action->>'type';
        begin
          if action_type = 'create_task' then
            insert into public.activities (
              activity_type, subject, body,
              account_id, opportunity_id, owner_user_id,
              due_at
            )
            values (
              'task',
              action->>'subject',
              action->>'body',
              new.account_id,
              new.id,
              new.owner_user_id,
              case
                when action->>'due_days_from_now' is not null
                then timezone('utc', now()) + ((action->>'due_days_from_now')::int || ' days')::interval
                else null
              end
            );

          elsif action_type = 'send_notification' then
            insert into public.notifications (
              user_id, type, title, message, link
            )
            values (
              new.owner_user_id,
              'deal_stage_change',
              action->>'title',
              action->>'message',
              '/opportunities/' || new.id
            );
          end if;
        end;
      end loop;

      insert into public.automation_log (
        rule_id, trigger_record_id, trigger_entity, actions_executed, success
      )
      values (rule.id, new.id, 'opportunities', rule.actions, true);
    end if;
  end loop;

  return new;
end;
$$;

-- 6. Drop the columns. (Enum TYPES kept — harmless; a couple of display
--    columns still cast to account_lifecycle.) -----------------------------
alter table public.accounts
  drop column if exists status,
  drop column if exists lifecycle_status;

-- 7. Recreate the three dropped views without the retired columns ----------
-- 7a. v_accounts_with_activity — verbatim from 20260715120000 (a.* now
--     excludes status/lifecycle_status).
create view public.v_accounts_with_activity
with (security_invoker = on) as
select
  a.*,
  la.last_activity_at,
  coalesce(la.last_activity_at, a.created_at) as effective_last_touch
from public.accounts a
left join public.v_account_last_activity la on la.account_id = a.id;

comment on view public.v_accounts_with_activity is
  'accounts + last_activity_at (v_account_last_activity) + never-null effective_last_touch. Mirrors v_opportunities_with_activity.';

grant select on public.v_accounts_with_activity to authenticated;
revoke all on public.v_accounts_with_activity from anon;

-- 7b. v_partner_accounts — verbatim from 20260715120000 (a.* re-snapshot).
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
  'Partner-flagged accounts with member_count + umbrella/member/top_level flags + partner_type. Powers /partners server-side.';

grant select on public.v_partner_accounts to authenticated;
revoke all on public.v_partner_accounts from anon;

-- 7c. v_marketing_suppression — off lifecycle_status. The exposed
--     lifecycle_status column is kept (customer_status mapped to the
--     account_lifecycle type) for the do-not-email report contract; the
--     customer/former legs now key on customer_status (behaviour-neutral —
--     they are subsets of active_won / ever_won). Lead branches keep the
--     null::account_lifecycle cast (enum type retained).
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
         a.name as account_name, a.account_type,
         (case a.customer_status
            when 'client'        then 'customer'
            when 'former_client' then 'former_customer'
            else                      'prospect'
          end)::public.account_lifecycle as lifecycle_status,
         a.customer_status,
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
 where (c.active_won or c.customer_status = 'client')
union all
select 'contact', c.id, 'former_customer_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where not (c.active_won or c.customer_status = 'client')
   and (c.ever_won or c.customer_status = 'former_client')
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

commit;

notify pgrst, 'reload schema';
