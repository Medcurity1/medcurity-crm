-- find_leads_duplicating_contact: trim emails before comparing.
--
-- The "email (certain)" tier matched on lower(c.email) = lower(ll.email) — it
-- lowercased but did NOT trim whitespace. So a lead and contact with the SAME
-- address but a stray leading/trailing space (" carmela@x.com" vs
-- "carmela@x.com") failed the email match and fell through to the weaker
-- "name (review)" tier. Trimming both sides (lower(btrim(...))) puts those
-- genuine same-email pairs back in the certain tier.
--
-- Re-creates the function from 20260616000014 with btrim added to both email
-- comparisons (the email-tier join and the name-tier exclusion). Everything
-- else is unchanged.

begin;

create or replace function public.find_leads_duplicating_contact(
  p_tier   text default 'all',   -- 'email' | 'name' | 'all'
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
  email_matches as (
    select 'email'::text as match_tier,
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
       and c.email is not null
       and lower(btrim(c.email)) = lower(btrim(ll.email))
      left join public.accounts a on a.id = c.account_id
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
       and not exists (
         select 1 from public.contacts c2
          where c2.archived_at is null and c2.email is not null
            and ll.email is not null
            and lower(btrim(c2.email)) = lower(btrim(ll.email))
       )
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
