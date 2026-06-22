-- Multiple emails per contact (hard cap 3): primary contacts.email + up to 2
-- additional (email2, email3). One person, several addresses, ONE contact —
-- so email sync, dedup, and search all treat any of a contact's addresses as
-- that contact (Molly/Summer request; the Justine Soller two-address case).
--
-- Design (see deep-dive): two scalar columns, not a child table — every
-- consumer is a flat single-column predicate, the cap is a hard 3, and a
-- reusable contact_matches_email(c, email) helper keeps each call site a
-- one-line widening. Additive + reversible.

begin;

-- ── Columns ────────────────────────────────────────────────────────────
alter table public.contacts add column if not exists email2 text;
alter table public.contacts add column if not exists email3 text;

-- @ format, mirroring contacts_email_format (initial_schema.sql:108)
alter table public.contacts drop constraint if exists contacts_email2_format;
alter table public.contacts add constraint contacts_email2_format
  check (email2 is null or position('@' in email2) > 1);
alter table public.contacts drop constraint if exists contacts_email3_format;
alter table public.contacts add constraint contacts_email3_format
  check (email3 is null or position('@' in email3) > 1);

-- No address may equal the primary or each other (case-insensitive, NULL-tolerant).
alter table public.contacts drop constraint if exists contacts_additional_emails_distinct;
alter table public.contacts add constraint contacts_additional_emails_distinct
  check (
        (email2 is null or email  is null or lower(btrim(email2)) <> lower(btrim(email)))
    and (email3 is null or email  is null or lower(btrim(email3)) <> lower(btrim(email)))
    and (email3 is null or email2 is null or lower(btrim(email3)) <> lower(btrim(email2)))
  );

-- Fill slot 2 before slot 3 (so the cap reads cleanly as primary + email2 + email3).
alter table public.contacts drop constraint if exists contacts_additional_emails_ordered;
alter table public.contacts add constraint contacts_additional_emails_ordered
  check (email2 is not null or email3 is null);

-- Lookup indexes parallel to idx_contacts_lower_email_live (20260616000012).
create index if not exists idx_contacts_lower_email2_live
  on public.contacts (lower(btrim(email2)))
  where archived_at is null and email2 is not null;
create index if not exists idx_contacts_lower_email3_live
  on public.contacts (lower(btrim(email3)))
  where archived_at is null and email3 is not null;

-- ── Reusable match predicate (one-line widening at every call site) ─────
-- True when p_email (case-insensitively, trimmed) equals ANY of the contact's
-- up-to-3 addresses. Pure function over the row — safe in any query.
create or replace function public.contact_matches_email(c public.contacts, p_email text)
returns boolean
language sql
immutable
as $$
  select p_email is not null and btrim(p_email) <> '' and (
       (c.email  is not null and lower(btrim(c.email))  = lower(btrim(p_email)))
    or (c.email2 is not null and lower(btrim(c.email2)) = lower(btrim(p_email)))
    or (c.email3 is not null and lower(btrim(c.email3)) = lower(btrim(p_email)))
  );
$$;
grant execute on function public.contact_matches_email(public.contacts, text) to authenticated;

-- ── Re-create the 5 email-aware functions: verbatim bodies, with the one
--    email predicate swapped to contact_matches_email(...). ───────────────

-- 1. convert_lead (from 20260616000009) — dedup guard now honors all 3 addresses.
create or replace function public.convert_lead(
  p_lead_id              uuid,
  p_first_name           text,
  p_last_name            text,
  p_existing_account_id  uuid    default null,
  p_account_name         text    default null,
  p_industry             text    default null,
  p_website              text    default null,
  p_street               text    default null,
  p_city                 text    default null,
  p_state                text    default null,
  p_zip                  text    default null,
  p_country              text    default null,
  p_email                text    default null,
  p_phone                text    default null,
  p_title                text    default null,
  p_lead_source          text    default null,
  p_create_opportunity   boolean default false,
  p_opportunity_name     text    default null,
  p_opportunity_amount   numeric default 0,
  p_opportunity_stage    text    default 'details_analysis'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_lead          record;
  v_account_id    uuid;
  v_account_name  text;
  v_contact_id    uuid;
  v_opp_id        uuid;
  v_mql           date;
  v_sql           date;
  v_lead_source   public.lead_source;
  v_dupe_name     text;
  v_is_primary    boolean;
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized to convert leads';
  end if;

  select owner_user_id, mql_date, qualification, qualification_date,
         status, converted_account_id, converted_contact_id, converted_opportunity_id,
         do_not_market_to, do_not_contact, archived_at, avoid_reason
    into v_lead
    from public.leads
   where id = p_lead_id;
  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;

  if v_lead.status = 'converted' or v_lead.converted_account_id is not null then
    select name into v_account_name
      from public.accounts where id = v_lead.converted_account_id;
    return jsonb_build_object(
      'account_id',     v_lead.converted_account_id,
      'account_name',   v_account_name,
      'contact_id',     v_lead.converted_contact_id,
      'opportunity_id', v_lead.converted_opportunity_id,
      'already_converted', true
    );
  end if;

  if v_lead.archived_at is not null or v_lead.avoid_reason is not null then
    raise exception 'This import was marked Avoid (%) and archived; it cannot be promoted.',
      coalesce(v_lead.avoid_reason, 'archived');
  end if;

  if p_existing_account_id is not null and p_account_name is not null then
    raise exception 'Provide either an existing account or a new account name, not both';
  end if;

  -- EMAIL DEDUP: refuse to create a second live contact for the same email
  -- (any of the contact's up-to-3 addresses).
  if nullif(btrim(p_email), '') is not null then
    select trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))
      into v_dupe_name
      from public.contacts c
     where public.contact_matches_email(c, p_email)
       and c.archived_at is null
     order by c.created_at asc
     limit 1;
    if v_dupe_name is not null then
      raise exception
        'A contact with this email already exists (%). Use or merge that contact instead of converting a duplicate.',
        nullif(v_dupe_name, '');
    end if;
  end if;

  if nullif(p_lead_source, '') is not null
     and p_lead_source = any (enum_range(null::public.lead_source)::text[]) then
    v_lead_source := p_lead_source::public.lead_source;
  else
    v_lead_source := null;
  end if;

  v_mql := v_lead.mql_date;
  v_sql := case
    when v_lead.qualification in ('sql', 'sal') and v_lead.qualification_date is not null
      then v_lead.qualification_date::date
    else null
  end;

  if p_existing_account_id is not null then
    select id, name into v_account_id, v_account_name
      from public.accounts where id = p_existing_account_id;
    if not found then raise exception 'Account % not found', p_existing_account_id; end if;
  elsif p_account_name is not null and btrim(p_account_name) <> '' then
    insert into public.accounts (
      name, owner_user_id, industry, website,
      billing_street, billing_city, billing_state, billing_zip, billing_country
    ) values (
      p_account_name, v_lead.owner_user_id, p_industry, p_website,
      p_street, p_city, p_state, p_zip, p_country
    )
    returning id, name into v_account_id, v_account_name;
  else
    v_account_id := null;
    v_account_name := null;
  end if;

  v_is_primary := v_account_id is not null
    and not exists (
      select 1 from public.contacts c
       where c.account_id = v_account_id
         and c.is_primary = true
         and c.archived_at is null
    );

  insert into public.contacts (
    account_id, first_name, last_name, email, phone, title,
    is_primary, lead_source, original_lead_id, owner_user_id, mql_date, sql_date,
    do_not_contact
  ) values (
    v_account_id, p_first_name, p_last_name, p_email, p_phone, p_title,
    v_is_primary, v_lead_source, p_lead_id, v_lead.owner_user_id, v_mql, v_sql,
    coalesce(v_lead.do_not_market_to, false) or coalesce(v_lead.do_not_contact, false)
  )
  returning id into v_contact_id;

  if p_create_opportunity and v_account_id is not null
     and p_opportunity_name is not null and btrim(p_opportunity_name) <> '' then
    insert into public.opportunities (
      account_id, primary_contact_id, name, amount, stage, team, kind, owner_user_id
    ) values (
      v_account_id, v_contact_id, p_opportunity_name, coalesce(p_opportunity_amount, 0),
      coalesce(nullif(p_opportunity_stage, ''), 'details_analysis')::public.opportunity_stage,
      'sales', 'new_business', v_lead.owner_user_id
    )
    returning id into v_opp_id;
  end if;

  update public.leads
     set status = 'converted',
         converted_at = timezone('utc', now()),
         converted_account_id = v_account_id,
         converted_contact_id = v_contact_id,
         converted_opportunity_id = v_opp_id,
         archived_at = timezone('utc', now()),
         archived_by = v_uid
   where id = p_lead_id
     and status is distinct from 'converted';

  return jsonb_build_object(
    'account_id',     v_account_id,
    'account_name',   v_account_name,
    'contact_id',     v_contact_id,
    'opportunity_id', v_opp_id
  );
end;
$$;

grant execute on function public.convert_lead(
  uuid, text, text, uuid, text, text, text, text, text, text, text, text,
  text, text, text, text, boolean, text, numeric, text
) to authenticated;

-- 2. bulk_promote_imports (from 20260616000005) — dup skip honors all 3 addresses.
create or replace function public.bulk_promote_imports(p_lead_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_lead public.leads%rowtype;
  v_account_id uuid;
  v_contact_id uuid;
  v_norm text;
  v_match_count int;
  v_lead_source public.lead_source;
  v_promoted int := 0;
  v_skipped_duplicate int := 0;
  v_skipped_ambiguous int := 0;
  v_skipped_other int := 0;
  v_errors int := 0;
  v_last_error text := null;
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  foreach v_id in array p_lead_ids loop
    begin
      select * into v_lead from public.leads where id = v_id;
      if not found then v_skipped_other := v_skipped_other + 1; continue; end if;
      if v_lead.status = 'converted' or v_lead.converted_account_id is not null
         or v_lead.archived_at is not null then
        v_skipped_other := v_skipped_other + 1; continue;
      end if;

      if v_lead.email is not null and exists (
        select 1 from public.contacts c
         where public.contact_matches_email(c, v_lead.email) and c.archived_at is null
      ) then
        v_skipped_duplicate := v_skipped_duplicate + 1; continue;
      end if;

      v_account_id := null;
      v_norm := public.norm_company(v_lead.company);
      if v_norm is not null then
        select count(*) into v_match_count
          from public.accounts
         where public.norm_company(name) = v_norm and archived_at is null;
        if v_match_count > 1 then
          v_skipped_ambiguous := v_skipped_ambiguous + 1; continue;
        elsif v_match_count = 1 then
          select id into v_account_id
            from public.accounts
           where public.norm_company(name) = v_norm and archived_at is null
           limit 1;
        else
          insert into public.accounts (
            name, owner_user_id, industry, website,
            billing_street, billing_city, billing_state, billing_zip, billing_country
          ) values (
            btrim(v_lead.company), v_lead.owner_user_id, v_lead.industry, v_lead.website,
            v_lead.street, v_lead.city, v_lead.state, v_lead.zip, v_lead.country
          )
          returning id into v_account_id;
        end if;
      end if;

      if nullif(v_lead.source::text, '') is not null
         and v_lead.source::text = any (enum_range(null::public.lead_source)::text[]) then
        v_lead_source := v_lead.source::text::public.lead_source;
      else
        v_lead_source := null;
      end if;

      insert into public.contacts (
        account_id, first_name, last_name, email, phone, title,
        is_primary, lead_source, original_lead_id, owner_user_id,
        mql_date, sql_date, do_not_contact
      ) values (
        v_account_id, coalesce(v_lead.first_name, ''), coalesce(v_lead.last_name, ''),
        v_lead.email, v_lead.phone, v_lead.title,
        false, v_lead_source, v_id, v_lead.owner_user_id,
        v_lead.mql_date,
        case when v_lead.qualification in ('sql', 'sal') and v_lead.qualification_date is not null
             then v_lead.qualification_date::date else null end,
        coalesce(v_lead.do_not_market_to, false) or coalesce(v_lead.do_not_contact, false)
      )
      returning id into v_contact_id;

      update public.leads
         set status = 'converted',
             converted_at = timezone('utc', now()),
             converted_account_id = v_account_id,
             converted_contact_id = v_contact_id,
             archived_at = timezone('utc', now()),
             archived_by = v_uid
       where id = v_id and status is distinct from 'converted';

      v_promoted := v_promoted + 1;
    exception when others then
      v_errors := v_errors + 1;
      if v_last_error is null then v_last_error := sqlerrm; end if;
    end;
  end loop;

  return jsonb_build_object(
    'promoted', v_promoted,
    'skipped_duplicate', v_skipped_duplicate,
    'skipped_ambiguous', v_skipped_ambiguous,
    'skipped_other', v_skipped_other,
    'errors', v_errors,
    'last_error', v_last_error
  );
end;
$$;

-- 3. email_dup_status (from 20260616000001) — both contact branches honor all 3.
create or replace function public.email_dup_status(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_email is null or btrim(p_email) = '' then 'none'
    when exists (select 1 from public.contacts c
                  where public.contact_matches_email(c, p_email) and c.archived_at is null) then 'contact'
    when exists (select 1 from public.leads l
                  where lower(l.email) = lower(p_email) and l.archived_at is null
                    and coalesce(l.status::text, '') <> 'converted') then 'import'
    when exists (select 1 from public.leads l
                  where lower(l.email) = lower(p_email) and l.archived_at is not null
                    and l.avoid_reason is not null) then 'avoid'
    when exists (select 1 from public.leads l
                  where lower(l.email) = lower(p_email) and l.archived_at is not null) then 'archived'
    when exists (select 1 from public.contacts c
                  where public.contact_matches_email(c, p_email) and c.archived_at is not null) then 'archived'
    else 'none'
  end;
$$;

-- 4. find_duplicate_contacts (from 20260403000004) — score + filter honor all 3.
create or replace function public.find_duplicate_contacts(contact_email text, contact_first_name text default null, contact_last_name text default null)
returns table (id uuid, first_name text, last_name text, email text, account_id uuid, similarity_score float)
language plpgsql stable as $$
begin
  return query
  select c.id, c.first_name, c.last_name, c.email, c.account_id,
    case when public.contact_matches_email(c, contact_email) then 1.0::float
         when lower(c.first_name) = lower(coalesce(contact_first_name,'')) and lower(c.last_name) = lower(coalesce(contact_last_name,'')) then 0.9::float
         else 0.6::float end as similarity_score
  from public.contacts c where c.archived_at is null
    and (public.contact_matches_email(c, contact_email)
      or (contact_first_name is not null and contact_last_name is not null and lower(c.first_name) = lower(contact_first_name) and lower(c.last_name) = lower(contact_last_name)))
  order by similarity_score desc limit 10;
end;
$$;

-- 5. find_leads_duplicating_contact (from 20260617000002) — email + name tiers honor all 3.
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
       and public.contact_matches_email(c, ll.email)
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
          where c2.archived_at is null
            and public.contact_matches_email(c2, ll.email)
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
