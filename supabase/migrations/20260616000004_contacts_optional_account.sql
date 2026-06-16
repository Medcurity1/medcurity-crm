-- Contacts no longer REQUIRE an account. Reps need to add verified people
-- (e.g. a webinar list where we only have a gmail and don't know the
-- company) directly as contacts, and to promote a company-less lead into
-- a contact, without inventing a placeholder account.
--
--   1. contacts.account_id becomes nullable.
--   2. bulk_promote_imports: a company-LESS import becomes an account-less
--      contact (no more fabricated "First Last (import)" account). A
--      company that doesn't match an existing account still creates one.
--   3. convert_lead: account becomes optional — if no existing account is
--      picked and no new account name is given, the contact is created
--      with no account. (An opportunity still needs an account, so it's
--      only created when there is one.)
-- Everything else in both functions is carried verbatim from
-- 20260616000001 (null-safe guards, Avoid/archived guard, dedup, exact
-- account match, do_not_contact carry).

begin;

alter table public.contacts alter column account_id drop not null;
comment on column public.contacts.account_id is
  'Optional. A contact may be account-less (e.g. an individual added from a webinar list before their company is known). Opportunities still require an account.';

-- ── bulk_promote_imports: company-less -> account-less ───────────────
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
         where lower(c.email) = lower(v_lead.email) and c.archived_at is null
      ) then
        v_skipped_duplicate := v_skipped_duplicate + 1; continue;
      end if;

      -- Account: only when the import HAS a company. Exactly-one match ->
      -- attach; zero matches -> create that account; many -> ambiguous,
      -- skip for manual handling. No company at all -> account-less contact.
      v_norm := public.norm_company(v_lead.company);
      v_account_id := null;
      if v_norm is not null then
        select count(*), min(id) into v_match_count, v_account_id
          from public.accounts
         where public.norm_company(name) = v_norm and archived_at is null;
        if v_match_count > 1 then
          v_skipped_ambiguous := v_skipped_ambiguous + 1; continue;
        elsif v_match_count = 0 then
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
      raise warning 'bulk_promote_imports: lead % failed: %', v_id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'promoted', v_promoted,
    'skipped_duplicate', v_skipped_duplicate,
    'skipped_ambiguous', v_skipped_ambiguous,
    'skipped_other', v_skipped_other,
    'errors', v_errors
  );
end;
$$;

-- ── convert_lead: account becomes optional ───────────────────────────
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
  if public.current_app_role() is null
     or public.current_app_role() not in ('sales', 'renewals', 'admin', 'super_admin') then
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

  -- Account is OPTIONAL now: pick existing, create new, or leave null.
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
    v_account_id := null;     -- account-less contact (unknown company)
    v_account_name := null;
  end if;

  insert into public.contacts (
    account_id, first_name, last_name, email, phone, title,
    is_primary, lead_source, original_lead_id, owner_user_id, mql_date, sql_date,
    do_not_contact
  ) values (
    v_account_id, p_first_name, p_last_name, p_email, p_phone, p_title,
    v_account_id is not null, v_lead_source, p_lead_id, v_lead.owner_user_id, v_mql, v_sql,
    coalesce(v_lead.do_not_market_to, false) or coalesce(v_lead.do_not_contact, false)
  )
  returning id into v_contact_id;

  -- Opportunities require an account, so only when there is one.
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

commit;

notify pgrst, 'reload schema';
