-- ============================================================
-- Account dedup upgrades (Molly's feedback):
--   1. Smart field-fill on merge — the merged account keeps the survivor's
--      values but fills its BLANK profile fields from the losers (so phone
--      from one + address from the other both survive). account_fill_blanks
--      is called by the client right after merge_accounts (losers are only
--      soft-archived, so their field values are still readable).
--   2. Dismiss false-positive duplicate groups ("not a duplicate") — hidden
--      from the finder but restorable. find_account_duplicate_groups now
--      excludes any group whose exact account-id set was dismissed.
-- Admin-only, security definer, NULL-safe is_admin().
-- ============================================================

begin;

-- ── Dismissals table ────────────────────────────────────────────────────
create table if not exists public.account_duplicate_dismissals (
  id                  uuid primary key default gen_random_uuid(),
  group_account_ids   uuid[] not null,       -- sorted set of account ids
  group_key           text,                  -- the norm_company key, for display
  reason              text,
  dismissed_by        uuid references public.user_profiles (id) default auth.uid(),
  dismissed_at        timestamptz not null default timezone('utc', now())
);
create unique index if not exists ux_acct_dup_dismissal_ids
  on public.account_duplicate_dismissals (group_account_ids);

alter table public.account_duplicate_dismissals enable row level security;
drop policy if exists account_duplicate_dismissals_admin_all on public.account_duplicate_dismissals;
create policy account_duplicate_dismissals_admin_all
  on public.account_duplicate_dismissals for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── Smart field-fill ────────────────────────────────────────────────────
-- Fill the survivor's blank profile fields from the losers. The survivor's
-- own non-blank values always win; among losers, the strongest (closed-won,
-- then oldest) wins. Identity/financial/audit/SF-sync fields are untouched.
-- do_not_contact is OR'd (compliance: if anyone said don't contact, honor it).
create or replace function public.account_fill_blanks(
  p_survivor_id uuid,
  p_loser_ids   uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_filled integer := 0;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'not authorized';
  end if;

  with ranked as (
    select a.*,
      row_number() over (
        order by exists (
                   select 1 from public.opportunities o
                    where o.account_id = a.id and o.archived_at is null
                      and o.stage = 'closed_won') desc,
                 a.created_at asc
      ) as rn
    from public.accounts a
    where a.id = any(p_loser_ids)
  ),
  src as (
    select
      (array_remove(array_agg(nullif(trim(phone),'')          order by rn), null))[1] as phone,
      (array_remove(array_agg(nullif(trim(fax),'')            order by rn), null))[1] as fax,
      (array_remove(array_agg(nullif(trim(phone_extension),'') order by rn), null))[1] as phone_extension,
      (array_remove(array_agg(nullif(trim(website),'')        order by rn), null))[1] as website,
      (array_remove(array_agg(nullif(trim(industry),'')       order by rn), null))[1] as industry,
      (array_remove(array_agg(nullif(trim(sic),'')            order by rn), null))[1] as sic,
      (array_remove(array_agg(nullif(trim(sic_description),'') order by rn), null))[1] as sic_description,
      (array_remove(array_agg(nullif(trim(billing_street),'') order by rn), null))[1] as billing_street,
      (array_remove(array_agg(nullif(trim(billing_city),'')   order by rn), null))[1] as billing_city,
      (array_remove(array_agg(nullif(trim(billing_state),'')  order by rn), null))[1] as billing_state,
      (array_remove(array_agg(nullif(trim(billing_zip),'')    order by rn), null))[1] as billing_zip,
      (array_remove(array_agg(nullif(trim(billing_country),'') order by rn), null))[1] as billing_country,
      (array_remove(array_agg(nullif(trim(shipping_street),'') order by rn), null))[1] as shipping_street,
      (array_remove(array_agg(nullif(trim(shipping_city),'')  order by rn), null))[1] as shipping_city,
      (array_remove(array_agg(nullif(trim(shipping_state),'') order by rn), null))[1] as shipping_state,
      (array_remove(array_agg(nullif(trim(shipping_zip),'')   order by rn), null))[1] as shipping_zip,
      (array_remove(array_agg(nullif(trim(shipping_country),'') order by rn), null))[1] as shipping_country,
      (array_remove(array_agg(nullif(trim(timezone),'')       order by rn), null))[1] as timezone,
      (array_remove(array_agg(nullif(trim(description),'')    order by rn), null))[1] as description,
      (array_remove(array_agg(nullif(trim(next_steps),'')     order by rn), null))[1] as next_steps,
      (array_remove(array_agg(nullif(trim(project),'')        order by rn), null))[1] as project,
      (array_remove(array_agg(nullif(trim(rating),'')         order by rn), null))[1] as rating,
      (array_remove(array_agg(nullif(trim(ownership),'')      order by rn), null))[1] as ownership,
      (array_remove(array_agg(nullif(trim(site),'')           order by rn), null))[1] as site,
      (array_remove(array_agg(nullif(trim(account_type),'')   order by rn), null))[1] as account_type,
      (array_remove(array_agg(nullif(trim(fte_range),'')      order by rn), null))[1] as fte_range,
      (array_remove(array_agg(nullif(trim(lead_source_detail),'') order by rn), null))[1] as lead_source_detail,
      (array_remove(array_agg(nullif(trim(partner_account),'') order by rn), null))[1] as partner_account,
      (array_remove(array_agg(nullif(trim(referring_partner),'') order by rn), null))[1] as referring_partner,
      (array_remove(array_agg(annual_revenue     order by rn), null))[1] as annual_revenue,
      (array_remove(array_agg(employees          order by rn), null))[1] as employees,
      (array_remove(array_agg(fte_count          order by rn), null))[1] as fte_count,
      (array_remove(array_agg(number_of_providers order by rn), null))[1] as number_of_providers,
      (array_remove(array_agg(locations          order by rn), null))[1] as locations,
      (array_remove(array_agg(billing_latitude   order by rn), null))[1] as billing_latitude,
      (array_remove(array_agg(billing_longitude  order by rn), null))[1] as billing_longitude,
      (array_remove(array_agg(lead_source        order by rn), null))[1] as lead_source,
      bool_or(coalesce(do_not_contact, false)) as any_dnc,
      bool_or(coalesce(partner_prospect, false)) as any_partner_prospect
    from ranked
  )
  update public.accounts s set
    phone              = coalesce(nullif(trim(s.phone),''), src.phone),
    fax                = coalesce(nullif(trim(s.fax),''), src.fax),
    phone_extension    = coalesce(nullif(trim(s.phone_extension),''), src.phone_extension),
    website            = coalesce(nullif(trim(s.website),''), src.website),
    industry           = coalesce(nullif(trim(s.industry),''), src.industry),
    sic                = coalesce(nullif(trim(s.sic),''), src.sic),
    sic_description    = coalesce(nullif(trim(s.sic_description),''), src.sic_description),
    billing_street     = coalesce(nullif(trim(s.billing_street),''), src.billing_street),
    billing_city       = coalesce(nullif(trim(s.billing_city),''), src.billing_city),
    billing_state      = coalesce(nullif(trim(s.billing_state),''), src.billing_state),
    billing_zip        = coalesce(nullif(trim(s.billing_zip),''), src.billing_zip),
    billing_country    = coalesce(nullif(trim(s.billing_country),''), src.billing_country),
    shipping_street    = coalesce(nullif(trim(s.shipping_street),''), src.shipping_street),
    shipping_city      = coalesce(nullif(trim(s.shipping_city),''), src.shipping_city),
    shipping_state     = coalesce(nullif(trim(s.shipping_state),''), src.shipping_state),
    shipping_zip       = coalesce(nullif(trim(s.shipping_zip),''), src.shipping_zip),
    shipping_country   = coalesce(nullif(trim(s.shipping_country),''), src.shipping_country),
    timezone           = coalesce(nullif(trim(s.timezone),''), src.timezone),
    description        = coalesce(nullif(trim(s.description),''), src.description),
    next_steps         = coalesce(nullif(trim(s.next_steps),''), src.next_steps),
    project            = coalesce(nullif(trim(s.project),''), src.project),
    rating             = coalesce(nullif(trim(s.rating),''), src.rating),
    ownership          = coalesce(nullif(trim(s.ownership),''), src.ownership),
    site               = coalesce(nullif(trim(s.site),''), src.site),
    account_type       = coalesce(nullif(trim(s.account_type),''), src.account_type),
    fte_range          = coalesce(nullif(trim(s.fte_range),''), src.fte_range),
    lead_source_detail = coalesce(nullif(trim(s.lead_source_detail),''), src.lead_source_detail),
    partner_account    = coalesce(nullif(trim(s.partner_account),''), src.partner_account),
    referring_partner  = coalesce(nullif(trim(s.referring_partner),''), src.referring_partner),
    annual_revenue     = coalesce(s.annual_revenue, src.annual_revenue),
    employees          = coalesce(s.employees, src.employees),
    fte_count          = coalesce(s.fte_count, src.fte_count),
    number_of_providers = coalesce(s.number_of_providers, src.number_of_providers),
    locations          = coalesce(s.locations, src.locations),
    billing_latitude   = coalesce(s.billing_latitude, src.billing_latitude),
    billing_longitude  = coalesce(s.billing_longitude, src.billing_longitude),
    lead_source        = coalesce(s.lead_source, src.lead_source),
    do_not_contact     = coalesce(s.do_not_contact, false) or src.any_dnc,
    partner_prospect   = coalesce(s.partner_prospect, false) or src.any_partner_prospect,
    updated_at         = timezone('utc', now())
  from src
  where s.id = p_survivor_id;

  get diagnostics v_filled = row_count;
  return v_filled;  -- 1 if the survivor row was updated, else 0
end;
$$;

grant execute on function public.account_fill_blanks(uuid, uuid[]) to authenticated;

-- ── Dismiss / restore / list ────────────────────────────────────────────
create or replace function public.dismiss_account_duplicate_group(
  p_account_ids uuid[],
  p_reason      text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_ids  uuid[];
  v_key  text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'not authorized';
  end if;
  -- Normalize: distinct + sorted so the set matches the finder's grouping.
  select array_agg(x order by x) into v_ids
    from (select distinct unnest(p_account_ids) as x) s;
  if v_ids is null or array_length(v_ids, 1) < 2 then
    raise exception 'a duplicate group needs at least two accounts';
  end if;
  select public.norm_company(name) into v_key
    from public.accounts where id = v_ids[1];

  insert into public.account_duplicate_dismissals (group_account_ids, group_key, reason)
  values (v_ids, v_key, p_reason)
  on conflict (group_account_ids)
    do update set reason = excluded.reason, dismissed_at = timezone('utc', now()), dismissed_by = auth.uid()
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.dismiss_account_duplicate_group(uuid[], text) to authenticated;

create or replace function public.restore_account_duplicate_dismissal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'not authorized';
  end if;
  delete from public.account_duplicate_dismissals where id = p_id;
end;
$$;
grant execute on function public.restore_account_duplicate_dismissal(uuid) to authenticated;

create or replace function public.list_account_duplicate_dismissals()
returns table (
  id uuid, group_account_ids uuid[], group_key text, account_names text[],
  reason text, dismissed_by_name text, dismissed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.group_account_ids, d.group_key,
         (select array_agg(a.name order by a.name) from public.accounts a where a.id = any(d.group_account_ids)),
         d.reason, up.full_name, d.dismissed_at
    from public.account_duplicate_dismissals d, (select coalesce(public.is_admin(), false) ok) g
    left join public.user_profiles up on up.id = d.dismissed_by
   where g.ok
   order by d.dismissed_at desc;
$$;
grant execute on function public.list_account_duplicate_dismissals() to authenticated;

-- ── Finder: exclude dismissed groups ────────────────────────────────────
create or replace function public.find_account_duplicate_groups(
  p_limit_groups integer default 500
)
returns table (
  group_key         text,
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
  live as (
    select a.id, a.name, a.account_number, a.lifecycle_status,
           a.status as account_status, a.owner_user_id, a.created_at,
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
      -- Skip groups an admin marked "not a duplicate" (exact same id set).
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
    l.lifecycle_status,
    l.account_status,
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

commit;

notify pgrst, 'reload schema';
