-- Fix bulk_promote_imports: every WITH-company import was erroring (the
-- account-match step the review-fix added used min(id) over uuid +
-- swallowed the error, so it surfaced only as errors:1). Rewrite the
-- match without min(uuid) — count first, then fetch the single match —
-- and surface the first error message in the result for diagnosis. Keeps
-- every other behavior from 20260616000004 (account-optional path, dedup,
-- ambiguous-skip, do_not_contact carry).

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
         where lower(c.email) = lower(v_lead.email) and c.archived_at is null
      ) then
        v_skipped_duplicate := v_skipped_duplicate + 1; continue;
      end if;

      -- Account match (only when the import has a company). Count first;
      -- if exactly one, fetch it; if many, ambiguous (skip); if none,
      -- create. No company at all -> account-less contact.
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

notify pgrst, 'reload schema';
