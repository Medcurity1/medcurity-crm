-- find_leads_duplicating_contact: restore name-tier speed.
--
-- 20260617000005 had the name tier exclude email-matched leads via
-- `not exists (... from email_matches ...)`. Because email_matches is then
-- referenced twice (output + exclusion), Postgres materializes it — window
-- function, 3x-contacts union and all — as a CTE barrier, which wrecks the
-- name-tier plan and times out at p_tier='all'/'name'.
--
-- Fix: derive a LIGHTWEIGHT id-only set (email_match_ids) straight off
-- contact_addrs (no window, no account join) for the exclusion, and keep
-- email_matches referenced exactly ONCE (so it inlines). contact_addrs is the
-- only thing referenced twice, and it's cheap to materialize. Add a functional
-- index on the contact name pair to back the name-tier join.

begin;

create index if not exists idx_contacts_lower_name_live
  on public.contacts (lower(btrim(first_name)), lower(btrim(last_name)))
  where archived_at is null;

create or replace function public.find_leads_duplicating_contact(
  p_tier   text default 'all',
  p_limit  int  default 500,
  p_offset int  default 0
)
returns table (
  match_tier           text,
  lead_id              uuid,
  lead_first_name      text,
  lead_last_name       text,
  lead_email           text,
  lead_company         text,
  lead_status          public.lead_status,
  lead_created_at      timestamptz,
  contact_id           uuid,
  contact_first_name   text,
  contact_last_name    text,
  contact_email        text,
  contact_account_id   uuid,
  contact_account_name text,
  contact_created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  return query
  with live_leads as (
    select l.id, l.first_name, l.last_name, l.email, l.company,
           l.status, l.created_at
      from public.leads l
     where l.archived_at is null
       and l.status is distinct from 'converted'
  ),
  contact_addrs as (
    select c.id, c.first_name, c.last_name, c.email, c.account_id, c.created_at,
           lower(btrim(c.email)) as norm
      from public.contacts c
     where c.archived_at is null and nullif(btrim(c.email), '') is not null
    union all
    select c.id, c.first_name, c.last_name, c.email, c.account_id, c.created_at,
           lower(btrim(c.email2))
      from public.contacts c
     where c.archived_at is null and nullif(btrim(c.email2), '') is not null
    union all
    select c.id, c.first_name, c.last_name, c.email, c.account_id, c.created_at,
           lower(btrim(c.email3))
      from public.contacts c
     where c.archived_at is null and nullif(btrim(c.email3), '') is not null
  ),
  -- Lightweight set of leads that have ANY email match (for the name-tier
  -- exclusion). No window, no account join, just ids — cheap to anti-join.
  email_match_ids as (
    select distinct ll.id
      from live_leads ll
      join contact_addrs ca on ca.norm = lower(btrim(ll.email))
     where nullif(btrim(ll.email), '') is not null
  ),
  email_matches as (
    select 'email'::text as match_tier,
           ll.id, ll.first_name, ll.last_name, ll.email, ll.company,
           ll.status, ll.created_at,
           ca.id as contact_id, ca.first_name as c_first, ca.last_name as c_last,
           ca.email as c_email, ca.account_id, a.name as account_name,
           ca.created_at as c_created,
           row_number() over (
             partition by ll.id order by ca.created_at asc, ca.id asc
           ) as rn
      from live_leads ll
      join contact_addrs ca on ca.norm = lower(btrim(ll.email))
      left join public.accounts a on a.id = ca.account_id
     where nullif(btrim(ll.email), '') is not null
  ),
  name_matches as (
    select 'name'::text as match_tier,
           ll.id, ll.first_name, ll.last_name, ll.email, ll.company,
           ll.status, ll.created_at,
           c.id   as contact_id, c.first_name as c_first, c.last_name as c_last,
           c.email as c_email, c.account_id, a.name as account_name,
           c.created_at as c_created,
           row_number() over (
             partition by ll.id order by c.created_at asc, c.id asc
           ) as rn
      from live_leads ll
      join public.contacts c
        on c.archived_at is null
       and nullif(btrim(c.first_name), '') is not null
       and nullif(btrim(c.last_name),  '') is not null
       and lower(btrim(c.first_name)) = lower(btrim(ll.first_name))
       and lower(btrim(c.last_name))  = lower(btrim(ll.last_name))
      left join public.accounts a on a.id = c.account_id
     where nullif(btrim(ll.first_name), '') is not null
       and nullif(btrim(ll.last_name),  '') is not null
       and not exists (select 1 from email_match_ids e where e.id = ll.id)
  ),
  unioned as (
    select em.match_tier, em.id, em.first_name, em.last_name, em.email,
           em.company, em.status, em.created_at, em.contact_id, em.c_first,
           em.c_last, em.c_email, em.account_id, em.account_name, em.c_created
      from email_matches em
     where em.rn = 1
       and (p_tier = 'all' or p_tier = 'email')
    union all
    select nm.match_tier, nm.id, nm.first_name, nm.last_name, nm.email,
           nm.company, nm.status, nm.created_at, nm.contact_id, nm.c_first,
           nm.c_last, nm.c_email, nm.account_id, nm.account_name, nm.c_created
      from name_matches nm
     where nm.rn = 1
       and (p_tier = 'all' or p_tier = 'name')
  )
  select u.match_tier, u.id, u.first_name, u.last_name, u.email, u.company,
         u.status, u.created_at, u.contact_id, u.c_first, u.c_last, u.c_email,
         u.account_id, u.account_name, u.c_created
    from unioned u
   order by (u.match_tier = 'email') desc, u.created_at desc, u.id
   limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

commit;

notify pgrst, 'reload schema';
