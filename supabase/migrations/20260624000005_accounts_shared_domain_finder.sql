-- ============================================================
-- Account dedup by SHARED EMAIL DOMAIN (Molly's case: different company
-- NAMES, but their contacts share an email domain => almost certainly the
-- same company). Complements the name-based finder. Same output shape so the
-- existing merge + dismiss + UI all work unchanged. Generic free-mail domains
-- (gmail, yahoo, …) are excluded so we don't lump unrelated companies.
-- Admin-only, security definer.
-- ============================================================

begin;

create or replace function public.find_accounts_sharing_email_domain(
  p_limit_groups integer default 500
)
returns table (
  group_key         text,   -- the shared email domain
  group_size        integer,
  account_id        uuid,
  name              text,
  account_number    text,
  lifecycle_status  public.account_lifecycle,
  account_status    public.account_status,
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
  -- one row per (account, non-generic email domain)
  acct_domain as (
    select distinct a.id as account_id, a.name, a.account_number, a.lifecycle_status,
           a.status as account_status, a.owner_user_id, a.created_at,
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
      -- honor the same "not a duplicate" dismissals (exact id-set match)
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
    ad.lifecycle_status,
    ad.account_status,
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
  -- de-dup the per-(account,domain) rows back to one row per account in a group
  group by ad.domain, k.group_size, ad.account_id, ad.name, ad.account_number,
           ad.lifecycle_status, ad.account_status, ad.owner_user_id, up.full_name, ad.created_at
  order by k.group_size desc, ad.domain,
           (exists (select 1 from public.opportunities o
                     where o.account_id = ad.account_id and o.archived_at is null
                       and o.stage = 'closed_won')) desc,
           ad.created_at asc;
$$;

grant execute on function public.find_accounts_sharing_email_domain(integer) to authenticated;

commit;

notify pgrst, 'reload schema';
