-- ============================================================
-- Joe (2026-07-14): carry Source forward when a lead is promoted.
--
-- Source died at the Lead → Contact → Opportunity promotion: convert_lead
-- copied the lead's source onto the new CONTACT only. The opportunity it
-- creates got no lead_source, and a newly-created account got none either —
-- which also starved OpportunityForm's "auto-fill Source from the account"
-- behavior (OpportunityForm.tsx:370) for every future deal on that account.
-- That's why opportunities.lead_source reads overwhelmingly 'other'/blank.
--
-- Changes (bodies otherwise verbatim from 20260617000003, the latest defs):
--   • convert_lead: the created opportunity AND a newly-created account now
--     get the lead's (validated) source. An EXISTING account picked at
--     convert time is left untouched — its source predates this lead.
--   • bulk_promote_imports: an account auto-created from a promoted lead
--     gets the lead's (validated) source too. (Bulk promote never creates
--     opportunities, so nothing else to carry there.)
--
-- Downstream: the renewal generator already copies lead_source from the
-- parent opportunity (20260711210000), so renewals inherit the channel
-- automatically once new business carries it.
-- ============================================================

begin;

-- ── 1. convert_lead ────────────────────────────────────────────────────────
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
      name, owner_user_id, industry, website, lead_source,
      billing_street, billing_city, billing_state, billing_zip, billing_country
    ) values (
      p_account_name, v_lead.owner_user_id, p_industry, p_website, v_lead_source,
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
      account_id, primary_contact_id, name, amount, stage, team, kind, owner_user_id,
      lead_source
    ) values (
      v_account_id, v_contact_id, p_opportunity_name, coalesce(p_opportunity_amount, 0),
      coalesce(nullif(p_opportunity_stage, ''), 'details_analysis')::public.opportunity_stage,
      'sales', 'new_business', v_lead.owner_user_id,
      v_lead_source
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

-- ── 2. bulk_promote_imports ────────────────────────────────────────────────
-- The v_lead_source validation moved ABOVE the account-matching block so the
-- auto-created account can be stamped with the lead's source.
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

grant execute on function public.bulk_promote_imports(uuid[]) to authenticated;

commit;

notify pgrst, 'reload schema';
