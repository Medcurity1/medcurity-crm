-- ---------------------------------------------------------------------
-- Ambiguous-company bulk clearing (Nathan 2026-07-17, follow-up to the
-- 232 investigation): new optional p_ambiguous_accountless flag. When a
-- lead's company matches MORE THAN ONE live account, the default is
-- still to skip (never guess). With the flag, the lead promotes as an
-- ACCOUNT-LESS contact instead — reported separately in the result as
-- promoted_ambiguous_accountless, with the same ambiguous_detail lead
-- links so the batch stays reviewable. Everything else verbatim from
-- 20260717000010.
-- ---------------------------------------------------------------------

begin;

-- Signature change: (uuid[], uuid[]) -> (uuid[], uuid[], boolean default).
drop function if exists public.bulk_promote_imports(uuid[], uuid[]);

create or replace function public.bulk_promote_imports(
  p_lead_ids uuid[],
  p_tag_ids  uuid[] default null,
  p_ambiguous_accountless boolean default false
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
  v_promoted_ambiguous_accountless int := 0;
  v_last_error text := null;
  v_error_detail jsonb := '[]'::jsonb;
  v_ambiguous_detail jsonb := '[]'::jsonb;
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

      if v_lead.email is not null and btrim(v_lead.email) <> '' and exists (
        select 1 from public.contacts c
         where c.archived_at is null
           and (   (c.email  is not null and lower(btrim(c.email))  = lower(btrim(v_lead.email)))
                or (c.email2 is not null and lower(btrim(c.email2)) = lower(btrim(v_lead.email)))
                or (c.email3 is not null and lower(btrim(c.email3)) = lower(btrim(v_lead.email))))
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
      -- Placeholder org names mean "no company" — don't build accounts from them.
      v_norm := public.norm_company(v_lead.company);
      if v_norm in ('unknown', 'n a', 'na', 'none', 'tbd', 'self', 'retired') then
        v_norm := null;
      end if;
      if v_norm is not null then
        select count(*) into v_match_count
          from public.accounts
         where public.norm_company(name) = v_norm and archived_at is null;
        if v_match_count > 1 then
          -- Ambiguous company. Default: skip (never guess an account).
          -- With p_ambiguous_accountless (Nathan 2026-07-17): promote
          -- anyway as an ACCOUNT-LESS contact — the company name stays
          -- on the linked lead tombstone; sales attaches the right
          -- account when they work the person.
          if p_ambiguous_accountless then
            v_promoted_ambiguous_accountless := v_promoted_ambiguous_accountless + 1;
            if jsonb_array_length(v_ambiguous_detail) < 25 then
              v_ambiguous_detail := v_ambiguous_detail || jsonb_build_object(
                'lead_id', v_id, 'company', btrim(v_lead.company));
            end if;
            v_account_id := null;
          else
            v_skipped_ambiguous := v_skipped_ambiguous + 1;
            if jsonb_array_length(v_ambiguous_detail) < 25 then
              v_ambiguous_detail := v_ambiguous_detail || jsonb_build_object(
                'lead_id', v_id, 'company', btrim(v_lead.company));
            end if;
            continue;
          end if;
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

      -- No usable company -> ACCOUNT-LESS contact (the 2026-06-16 decision:
      -- contacts.account_id is nullable; no fabricated "(import)" accounts).
      -- v_account_id simply stays NULL here.

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

      -- Batch-tracking tags on every contact this run creates.
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
      -- Per-row detail (capped): every failure names its lead and error,
      -- so a failing batch is diagnosable instead of an opaque count
      -- (the 2026-07-17 lesson: 205 silent errors, zero ids, one message).
      if jsonb_array_length(v_error_detail) < 25 then
        v_error_detail := v_error_detail || jsonb_build_object(
          'lead_id', v_id, 'error', sqlerrm, 'code', sqlstate);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'promoted', v_promoted,
    'skipped_duplicate', v_skipped_duplicate,
    'skipped_ambiguous', v_skipped_ambiguous,
    'skipped_other', v_skipped_other,
    'errors', v_errors,
    'promoted_ambiguous_accountless', v_promoted_ambiguous_accountless,
    'last_error', v_last_error,
    'error_detail', v_error_detail,
    'ambiguous_detail', v_ambiguous_detail
  );
end;
$$;
grant execute on function public.bulk_promote_imports(uuid[], uuid[], boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
