-- Imports migration, Chunk 3: the integrity + automation backbone.
--   1. norm_company()        — aggressive company-name normalization so
--      account auto-matching survives "&"/"and", suffixes, punctuation.
--   2. leads.avoid_reason     — the new "Avoid" concept (bounced / unsub /
--      auto-reply / manual). Set + archived => kept forever for dedup.
--   3. mark_import_avoid()    — admin action: tag avoid + archive.
--   4. email_dup_status()     — dedup helper: is this email already a
--      contact / live import / archived record?
--   5. bulk_promote_imports() — one-click "move these imports to Contacts"
--      (account match-or-create + contact create + dedup + activity carry).
--   6. convert_lead()         — re-emitted to ALSO carry the compliance
--      flag (do_not_contact) onto the promoted contact.

begin;

-- ── 1. norm_company ──────────────────────────────────────────────────
-- Lowercase, "&"->"and", strip punctuation, collapse whitespace, drop a
-- single trailing legal suffix. Immutable so it can be used in matching.
create or replace function public.norm_company(p text)
returns text language sql immutable as $$
  with base as (
    select regexp_replace(
             regexp_replace(lower(coalesce(p, '')), '&', ' and ', 'g'),
             '[^a-z0-9 ]', ' ', 'g') as s
  ),
  collapsed as (select btrim(regexp_replace(s, '\s+', ' ', 'g')) as s from base),
  desuffixed as (
    select btrim(regexp_replace(
      s, ' (inc|llc|llp|ltd|co|corp|corporation|company|group|pllc|pc|pa|incorporated)$', '', 'g')) as s
    from collapsed
  )
  select nullif(s, '') from desuffixed;
$$;

-- ── 2. avoid_reason ──────────────────────────────────────────────────
alter table public.leads add column if not exists avoid_reason text;
comment on column public.leads.avoid_reason is
  'Imports migration: when set, this import was marked Avoid (bounced / unsubscribed / auto_reply / manual) and archived. Distinct from do_not_contact (a valid person we just do not market to); Avoid means "never re-add", and the record is kept archived so dedup catches it.';

-- ── 3. mark_import_avoid ─────────────────────────────────────────────
create or replace function public.mark_import_avoid(p_lead_id uuid, p_reason text default 'manual')
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;
  update public.leads
     set avoid_reason  = coalesce(nullif(btrim(p_reason), ''), 'manual'),
         archived_at   = coalesce(archived_at, timezone('utc', now())),
         archived_by   = coalesce(archived_by, v_uid),
         archive_reason = coalesce(archive_reason, 'Avoid: ' || coalesce(nullif(btrim(p_reason), ''), 'manual'))
   where id = p_lead_id;
end;
$$;
grant execute on function public.mark_import_avoid(uuid, text) to authenticated;

-- ── 4. email_dup_status ──────────────────────────────────────────────
-- Returns the first matching bucket for a candidate email. SECURITY
-- DEFINER so reps' contact-create dedup warning can see admin-only
-- imports/archives WITHOUT exposing the records (it returns only a
-- category string). Case-insensitive.
create or replace function public.email_dup_status(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_email is null or btrim(p_email) = '' then 'none'
    when exists (select 1 from public.contacts c
                  where lower(c.email) = lower(p_email) and c.archived_at is null) then 'contact'
    when exists (select 1 from public.leads l
                  where lower(l.email) = lower(p_email) and l.archived_at is null
                    and coalesce(l.status::text, '') <> 'converted') then 'import'
    when exists (select 1 from public.leads l
                  where lower(l.email) = lower(p_email) and l.archived_at is not null) then 'archived'
    when exists (select 1 from public.contacts c
                  where lower(c.email) = lower(p_email) and c.archived_at is not null) then 'archived'
    else 'none'
  end;
$$;
grant execute on function public.email_dup_status(text) to authenticated;

-- ── 5. bulk_promote_imports ──────────────────────────────────────────
-- One-click "move these imports into Contacts". Per import: skip if
-- already promoted / archived / a duplicate of a live contact; otherwise
-- match an existing account by normalized company (or create one), create
-- the contact (carrying source, owner, MQL/SQL, and the compliance flag),
-- then mark the import converted (which fires the existing activity-carry
-- trigger so its history follows it). Returns a counts summary.
create or replace function public.bulk_promote_imports(p_lead_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_lead public.leads%rowtype;
  v_account_id uuid;
  v_contact_id uuid;
  v_norm text;
  v_lead_source public.lead_source;
  v_promoted int := 0;
  v_skipped_duplicate int := 0;
  v_skipped_other int := 0;
  v_errors int := 0;
begin
  if public.current_app_role() not in ('admin', 'super_admin') then
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

      -- Dedup: never create a second contact for an email that already
      -- has a live contact.
      if v_lead.email is not null and exists (
        select 1 from public.contacts c
         where lower(c.email) = lower(v_lead.email) and c.archived_at is null
      ) then
        v_skipped_duplicate := v_skipped_duplicate + 1; continue;
      end if;

      -- Account: match by normalized company, else create.
      v_norm := public.norm_company(v_lead.company);
      v_account_id := null;
      if v_norm is not null then
        select id into v_account_id from public.accounts
         where public.norm_company(name) = v_norm and archived_at is null
         order by created_at asc limit 1;
      end if;
      if v_account_id is null then
        insert into public.accounts (
          name, owner_user_id, industry, website,
          billing_street, billing_city, billing_state, billing_zip, billing_country
        ) values (
          coalesce(nullif(btrim(v_lead.company), ''),
                   nullif(btrim(coalesce(v_lead.first_name, '') || ' ' || coalesce(v_lead.last_name, '')), '')
                   || ' (import)'),
          v_lead.owner_user_id, v_lead.industry, v_lead.website,
          v_lead.street, v_lead.city, v_lead.state, v_lead.zip, v_lead.country
        )
        returning id into v_account_id;
      end if;

      -- Keep source only if valid for the contact lead_source enum.
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
    end;
  end loop;

  return jsonb_build_object(
    'promoted', v_promoted,
    'skipped_duplicate', v_skipped_duplicate,
    'skipped_other', v_skipped_other,
    'errors', v_errors
  );
end;
$$;
grant execute on function public.bulk_promote_imports(uuid[]) to authenticated;

-- ── 6. convert_lead: carry the compliance flag onto the contact ──────
-- Re-emits 20260610000011 (the latest) verbatim except: also load the
-- import's do_not_market_to / do_not_contact and set the contact's
-- do_not_contact from them, so promoting a "do not contact" import does
-- not silently drop that flag.
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
  v_uid          uuid := auth.uid();
  v_lead         record;
  v_account_id   uuid;
  v_account_name text;
  v_contact_id   uuid;
  v_opp_id       uuid;
  v_mql          date;
  v_sql          date;
  v_lead_source  public.lead_source;
begin
  if public.current_app_role() not in ('sales', 'renewals', 'admin', 'super_admin') then
    raise exception 'Not authorized to convert leads';
  end if;

  select owner_user_id, mql_date, qualification, qualification_date,
         status, converted_account_id, converted_contact_id, converted_opportunity_id,
         do_not_market_to, do_not_contact
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

  if p_existing_account_id is null and (p_account_name is null or btrim(p_account_name) = '') then
    raise exception 'Pick an existing account or provide a new account name';
  end if;
  if p_existing_account_id is not null and p_account_name is not null then
    raise exception 'Provide either an existing account or a new account name, not both';
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
    else current_date
  end;

  if p_existing_account_id is not null then
    select id, name into v_account_id, v_account_name
      from public.accounts where id = p_existing_account_id;
    if not found then raise exception 'Account % not found', p_existing_account_id; end if;
  else
    insert into public.accounts (
      name, owner_user_id, industry, website,
      billing_street, billing_city, billing_state, billing_zip, billing_country
    ) values (
      p_account_name, v_lead.owner_user_id, p_industry, p_website,
      p_street, p_city, p_state, p_zip, p_country
    )
    returning id, name into v_account_id, v_account_name;
  end if;

  insert into public.contacts (
    account_id, first_name, last_name, email, phone, title,
    is_primary, lead_source, original_lead_id, owner_user_id, mql_date, sql_date,
    do_not_contact
  ) values (
    v_account_id, p_first_name, p_last_name, p_email, p_phone, p_title,
    true, v_lead_source, p_lead_id, v_lead.owner_user_id, v_mql, v_sql,
    coalesce(v_lead.do_not_market_to, false) or coalesce(v_lead.do_not_contact, false)
  )
  returning id into v_contact_id;

  if p_create_opportunity and p_opportunity_name is not null and btrim(p_opportunity_name) <> '' then
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

commit;

notify pgrst, 'reload schema';
