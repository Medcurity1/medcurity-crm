-- convert_lead hardening (two fixes the audit surfaced):
--
--   1. EMAIL DEDUP. bulk_promote_imports already skips an import whose email
--      matches a live contact, but the single-lead convert path never checked.
--      Converting a lead whose email is already a contact silently created a
--      duplicate. Now it raises a clear, actionable error so the admin can
--      merge / use the existing contact instead. (Guard runs BEFORE any
--      account/contact is created, so a rejected convert leaves nothing behind.)
--
--   2. is_primary MULTI-PRIMARY. The previous version set is_primary = true on
--      EVERY account-ed converted contact, so converting a second/third lead
--      into an existing account created multiple "primary" contacts. Now the
--      new contact is primary only when the account has no primary yet.
--
-- Everything else is carried verbatim from 20260616000004 (account-optional
-- logic, Avoid/archived guard, lead_source cast, MQL/SQL + do_not_contact
-- carry, opp-only-when-account).

begin;

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
  -- Leads are admin-only now (re-locked in 20260616000006), and the convert
  -- dialog is admin-gated, so match the RPC to that. (Previously this allowed
  -- sales/renewals from when reps worked their own leads; with leads hidden
  -- from non-admins, a rep has no legitimate path here.)
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

  -- EMAIL DEDUP: refuse to create a second live contact for the same email.
  if nullif(btrim(p_email), '') is not null then
    select trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''))
      into v_dupe_name
      from public.contacts c
     where lower(c.email) = lower(btrim(p_email))
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

  -- Account is OPTIONAL: pick existing, create new, or leave null.
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

  -- Primary only when there's an account AND it has no primary contact yet.
  -- Otherwise converting more leads into an existing account would stack up
  -- multiple "primary" contacts.
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
