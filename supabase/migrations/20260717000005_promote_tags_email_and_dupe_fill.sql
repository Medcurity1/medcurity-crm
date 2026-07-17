-- ---------------------------------------------------------------------
-- Jordan-list promotion prep (Nathan, 2026-07-17). Three pieces:
--   1. resolve_lead_ids_by_email() — lets Bulk Promote From File accept a
--      CSV with emails instead of (or alongside) lead ids, matching the
--      Bulk Archive tool's ergonomics.
--   2. bulk_promote_imports(p_lead_ids, p_tag_ids) — same battle-tested
--      promote, now optionally applying contact tags to every contact it
--      creates ("Jordan Clean Jul 2026"-style batch tracking).
--   3. archive_lead_as_duplicate() field-fill — before tombstoning a
--      duplicate lead onto its keeper contact, copy the lead's details
--      onto the keeper WHEREVER THE KEEPER IS BLANK (never overwrites),
--      and OR the compliance flags so do-not-contact can't be lost.
-- ---------------------------------------------------------------------

begin;

-- ── 1. Email → lead-id resolver (admin-only, case-insensitive) ───────
create or replace function public.resolve_lead_ids_by_email(p_emails text[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct l.id
    from public.leads l
    join unnest(coalesce(p_emails, '{}'::text[])) e(email)
      on lower(l.email) = lower(btrim(e.email))
   where public.current_app_role() in ('admin', 'super_admin');
$$;
grant execute on function public.resolve_lead_ids_by_email(text[]) to authenticated;

-- ── 2. bulk_promote_imports with optional tags ───────────────────────
-- Body re-emitted VERBATIM from the canonical 20260715151000 version
-- (contact_matches_email dedup incl. secondary emails, source-stamped
-- auto-created accounts, ambiguous-company skip, last_error surfacing,
-- NULL-safe role guard) with ONE addition: optional p_tag_ids applied to
-- every contact the run creates. Signature change: drop the old one
-- first so we don't leave an ambiguous overload behind.
drop function if exists public.bulk_promote_imports(uuid[]);

create or replace function public.bulk_promote_imports(
  p_lead_ids uuid[],
  p_tag_ids  uuid[] default null
)
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

      -- Keep source only if valid for the lead_source enum (validated BEFORE
      -- account matching so a newly-created account gets it too).
      if nullif(v_lead.source::text, '') is not null
         and v_lead.source::text = any (enum_range(null::public.lead_source)::text[]) then
        v_lead_source := v_lead.source::text::public.lead_source;
      else
        v_lead_source := null;
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
            name, owner_user_id, industry, website, lead_source,
            billing_street, billing_city, billing_state, billing_zip, billing_country
          ) values (
            btrim(v_lead.company), v_lead.owner_user_id, v_lead.industry, v_lead.website,
            v_lead_source,
            v_lead.street, v_lead.city, v_lead.state, v_lead.zip, v_lead.country
          )
          returning id into v_account_id;
        end if;
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

      -- NEW (2026-07-17): batch-tracking tags on every contact this run
      -- creates (e.g. "Jordan Clean Jul 2026").
      if p_tag_ids is not null and array_length(p_tag_ids, 1) > 0 then
        insert into public.contact_tags (contact_id, tag_id, tagged_by)
        select v_contact_id, t, v_uid
          from unnest(p_tag_ids) t
        on conflict do nothing;
      end if;

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
grant execute on function public.bulk_promote_imports(uuid[], uuid[]) to authenticated;

-- ── 3. archive_lead_as_duplicate: fill keeper's blanks from the lead ──
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
  v_lead_source public.lead_source;
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  select * into v_lead from public.leads where id = p_lead_id;
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

  select id, account_id, original_lead_id
    into v_contact
    from public.contacts
   where id = p_contact_id
     and archived_at is null;
  if not found then
    raise exception 'Keeper contact % not found or archived', p_contact_id;
  end if;
  v_account_id := v_contact.account_id;

  -- Enum-safe lead_source (same guard as bulk_promote_imports).
  if nullif(v_lead.source::text, '') is not null
     and v_lead.source::text = any (enum_range(null::public.lead_source)::text[]) then
    v_lead_source := v_lead.source::text::public.lead_source;
  else
    v_lead_source := null;
  end if;

  -- NEW (Nathan 2026-07-17): before retiring the duplicate, carry its
  -- details onto the keeper wherever the keeper is blank. Never
  -- overwrites existing data; compliance flags are OR'd so a
  -- do-not-contact on either record survives. (lead.type is skipped —
  -- different enum than contacts.type.)
  update public.contacts c
     set phone         = coalesce(nullif(btrim(c.phone), ''), v_lead.phone),
         phone_ext     = coalesce(nullif(btrim(c.phone_ext), ''), v_lead.phone_ext),
         mobile_phone  = coalesce(nullif(btrim(c.mobile_phone), ''), v_lead.mobile_phone),
         title         = coalesce(nullif(btrim(c.title), ''), v_lead.title),
         linkedin_url  = coalesce(nullif(btrim(c.linkedin_url), ''), v_lead.linkedin_url),
         credential    = coalesce(c.credential, v_lead.credential),
         time_zone     = coalesce(c.time_zone, v_lead.time_zone),
         business_relationship_tag
                       = coalesce(c.business_relationship_tag, v_lead.business_relationship_tag),
         partner_source = coalesce(nullif(btrim(c.partner_source), ''), v_lead.partner_source),
         lead_source   = coalesce(c.lead_source, v_lead_source),
         lead_source_detail
                       = coalesce(nullif(btrim(c.lead_source_detail), ''), v_lead.lead_source_detail),
         mql_date      = coalesce(c.mql_date, v_lead.mql_date),
         sql_date      = coalesce(
                           c.sql_date,
                           case when v_lead.qualification in ('sql', 'sal')
                                 and v_lead.qualification_date is not null
                                then v_lead.qualification_date::date end),
         mailing_street  = coalesce(nullif(btrim(c.mailing_street), ''), v_lead.street),
         mailing_city    = coalesce(nullif(btrim(c.mailing_city), ''), v_lead.city),
         mailing_state   = coalesce(nullif(btrim(c.mailing_state), ''), v_lead.state),
         mailing_zip     = coalesce(nullif(btrim(c.mailing_zip), ''), v_lead.zip),
         mailing_country = coalesce(nullif(btrim(c.mailing_country), ''), v_lead.country),
         do_not_contact  = c.do_not_contact
                           or coalesce(v_lead.do_not_contact, false)
                           or coalesce(v_lead.do_not_market_to, false)
   where c.id = p_contact_id;

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

-- ── 4. Tag usage counts (Admin → Tags manager) ───────────────────────
-- Counts can exceed PostgREST's row cap if fetched as raw join rows, so
-- aggregate server-side. Read-only.
create or replace function public.tag_usage_counts()
returns table (tag_id uuid, uses bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, count(ct.contact_id)::bigint
    from public.tags t
    left join public.contact_tags ct on ct.tag_id = t.id
   group by t.id;
$$;
grant execute on function public.tag_usage_counts() to authenticated;

commit;

notify pgrst, 'reload schema';
