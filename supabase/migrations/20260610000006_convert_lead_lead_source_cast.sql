-- ---------------------------------------------------------------------
-- Fix convert_lead: cast lead_source text -> lead_source enum.
--
-- contacts.lead_source is the enum public.lead_source. The web client
-- inserts auto-cast text -> enum at the PostgREST layer, but inside a
-- plpgsql function a text parameter must be cast explicitly, so the
-- first version failed with:
--   column "lead_source" is of type lead_source but expression is of
--   type text (42804).
--
-- Only change vs 20260610000004: nullif(p_lead_source,'')::lead_source
-- in the contact insert. (industry is plain text; team/kind/stage are
-- set from literals/explicit casts, so they were already fine.)
-- ---------------------------------------------------------------------

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
  v_uid          uuid := auth.uid();
  v_lead         record;
  v_account_id   uuid;
  v_account_name text;
  v_contact_id   uuid;
  v_opp_id       uuid;
  v_mql          date;
  v_sql          date;
  v_lead_source  public.lead_source := nullif(p_lead_source, '')::public.lead_source;
begin
  if public.current_app_role() not in ('sales', 'renewals', 'admin', 'super_admin') then
    raise exception 'Not authorized to convert leads';
  end if;
  if p_existing_account_id is null and (p_account_name is null or btrim(p_account_name) = '') then
    raise exception 'Pick an existing account or provide a new account name';
  end if;
  if p_existing_account_id is not null and p_account_name is not null then
    raise exception 'Provide either an existing account or a new account name, not both';
  end if;

  select owner_user_id, mql_date, qualification, qualification_date
    into v_lead
    from public.leads
   where id = p_lead_id;
  if not found then
    raise exception 'Lead % not found', p_lead_id;
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
    is_primary, lead_source, original_lead_id, owner_user_id, mql_date, sql_date
  ) values (
    v_account_id, p_first_name, p_last_name, p_email, p_phone, p_title,
    true, v_lead_source, p_lead_id, v_lead.owner_user_id, v_mql, v_sql
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
   where id = p_lead_id;

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
