-- Lead↔Contact de-duplication tooling.
--
-- Background: before the convert_lead email-dedup guard landed
-- (20260616000009), people converted leads to contacts by manually
-- re-creating them, leaving the original lead row live. The same person now
-- exists as BOTH a live lead and a live contact. The guard only blocks NEW
-- conversions; it can't retroactively clean these up.
--
-- This migration adds:
--   * find_leads_duplicating_contact()  — lists every live lead that
--     duplicates a live contact, in two confidence tiers.
--   * count_leads_duplicating_contact() — tier badge counts for the UI.
--   * archive_lead_as_duplicate()       — retire one duplicate lead as a
--     tombstone pointing at the keeper contact. NEVER deletes.
--
-- Style carried verbatim from the import RPCs (20260616000001):
--   security definer · set search_path = public · NULL-safe role guard.

begin;

-- Case-insensitive email lookup on live contacts (mirrors
-- idx_accounts_norm_company from 20260616000001). Speeds the email tier.
create index if not exists idx_contacts_lower_email_live
  on public.contacts (lower(email))
  where archived_at is null and email is not null;

-- ──────────────────────────────────────────────────────────────────────
-- FINDER
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.find_leads_duplicating_contact(
  p_tier   text default 'all',   -- 'email' | 'name' | 'all'
  p_limit  int  default 500,
  p_offset int  default 0
)
returns table (
  match_tier           text,        -- 'email' (certain) | 'name' (needs review)
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
begin
  -- Admin-only. NULL-safe (current_app_role() is NULL for a profile-less
  -- user, and "NULL not in (...)" is NULL, which would silently pass).
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
  -- TIER 1 (certain): email equals a live contact's email.
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
       and lower(c.email) = lower(ll.email)
      left join public.accounts a on a.id = c.account_id
     where nullif(btrim(ll.email), '') is not null
  ),
  -- TIER 2 (needs review): first+last name match a live contact AND this
  -- lead is NOT already an email match (don't double-list; email wins).
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
            and lower(c2.email) = lower(ll.email)
       )
  ),
  unioned as (
    select match_tier, id, first_name, last_name, email, company, status,
           created_at, contact_id, c_first, c_last, c_email, account_id,
           account_name, c_created
      from email_matches where rn = 1
       and (p_tier = 'all' or p_tier = 'email')
    union all
    select match_tier, id, first_name, last_name, email, company, status,
           created_at, contact_id, c_first, c_last, c_email, account_id,
           account_name, c_created
      from name_matches where rn = 1
       and (p_tier = 'all' or p_tier = 'name')
  )
  select u.match_tier, u.id, u.first_name, u.last_name, u.email, u.company,
         u.status, u.created_at, u.contact_id, u.c_first, u.c_last, u.c_email,
         u.account_id, u.account_name, u.c_created
    from unioned u
   -- certain first, then most-recently-created lead (likeliest the dup)
   order by (u.match_tier = 'email') desc, u.created_at desc, u.id
   limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
end;
$$;

grant execute on function public.find_leads_duplicating_contact(text, int, int)
  to authenticated;

-- Count helper for the tier tab badges (avoids paging the full set).
create or replace function public.count_leads_duplicating_contact()
returns table (email_certain bigint, name_review bigint)
language sql stable security definer set search_path = public as $$
  select
    count(*) filter (where match_tier = 'email'),
    count(*) filter (where match_tier = 'name')
  from public.find_leads_duplicating_contact('all', 1000000, 0);
$$;
grant execute on function public.count_leads_duplicating_contact() to authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- RETIRE (tombstone, never delete)
-- ──────────────────────────────────────────────────────────────────────
-- Retire a live lead AS A TOMBSTONE pointing at the keeper contact. Reuses
-- the EXACT tombstone column pattern convert_lead writes (20260616000009):
-- status='converted', converted_contact_id + converted_account_id set,
-- archived_at/archived_by stamped. The one difference vs convert_lead: NO new
-- contact/account is created — we attach to the EXISTING keeper. Back-fills
-- contact.original_lead_id when empty so the keeper records its lead
-- provenance. avoid_reason left NULL — this is a benign de-dup, NOT a
-- bounce/unsub "never re-add". Idempotent.
create or replace function public.archive_lead_as_duplicate(
  p_lead_id    uuid,
  p_contact_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_lead       record;
  v_contact    record;
  v_account_id uuid;
begin
  -- Admin-only, NULL-safe (parity with convert_lead 20260616000009).
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  select id, status, converted_account_id, converted_contact_id, archived_at
    into v_lead
    from public.leads
   where id = p_lead_id;
  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;

  -- IDEMPOTENT: if already a tombstone, return the existing pointers and stop.
  if v_lead.status = 'converted' or v_lead.converted_contact_id is not null then
    return jsonb_build_object(
      'lead_id',          p_lead_id,
      'contact_id',       v_lead.converted_contact_id,
      'account_id',       v_lead.converted_account_id,
      'already_archived', true
    );
  end if;

  -- Keeper must be a real, LIVE contact (never tombstone onto an archived one).
  select id, account_id, original_lead_id
    into v_contact
    from public.contacts
   where id = p_contact_id
     and archived_at is null;
  if not found then
    raise exception 'Keeper contact % not found or archived', p_contact_id;
  end if;
  v_account_id := v_contact.account_id;   -- may be NULL (account-less contact)

  -- Tombstone the lead onto the existing keeper (no new contact/account).
  update public.leads
     set status               = 'converted',
         converted_at         = timezone('utc', now()),
         converted_contact_id = p_contact_id,
         converted_account_id = v_account_id,
         archived_at          = timezone('utc', now()),
         archived_by          = v_uid,
         archive_reason       = coalesce(
           archive_reason,
           'Duplicate of contact ' || p_contact_id::text)
   where id = p_lead_id
     and status is distinct from 'converted';

  -- Record provenance on the keeper if it has none yet (don't clobber).
  update public.contacts
     set original_lead_id = p_lead_id
   where id = p_contact_id
     and original_lead_id is null;

  return jsonb_build_object(
    'lead_id',    p_lead_id,
    'contact_id', p_contact_id,
    'account_id', v_account_id
  );
end;
$$;

grant execute on function public.archive_lead_as_duplicate(uuid, uuid)
  to authenticated;

commit;

notify pgrst, 'reload schema';
