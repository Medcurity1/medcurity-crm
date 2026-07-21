-- ---------------------------------------------------------------------
-- Pen cutover (lead-type retirement pieces 3+4, docs/imports-tab-plan.md):
-- imports become CONTACTS with a pen flag instead of rows in `leads`.
--
--  1. import_contacts_rows gains a pen mode (p_options.pen = true): new
--     people land as PENDING contacts (import_status='pending', raw
--     company string kept on import_company, NO account resolution).
--     Rows matching an existing live contact behave exactly as before
--     (skip / fill-blanks) — they're already "promoted". Non-pen calls
--     are byte-identical to 20260707000002 behavior.
--  2. promote_pending_imports — account match/create at promote time,
--     mirroring bulk_promote_imports' semantics (exact-one attaches,
--     zero creates, placeholder/companyless promote ACCOUNT-LESS per the
--     2026-06-16 decision, multiple-match skips unless the ambiguous
--     account-less opt-in is passed) and its result shape.
--  3. archive_pending_imports — set-based archive of pending rows, with
--     an optional do-not-contact flag for the Avoid flow.
--
-- The old-pen (leads) machinery is untouched: legacy rows keep working
-- through the existing tools until the one-time sweep empties them.
-- ---------------------------------------------------------------------

begin;

create or replace function public.import_contacts_rows(
  p_rows jsonb,
  p_options jsonb default '{}'::jsonb,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_dup_mode text := coalesce(nullif(p_options->>'dup_mode', ''), 'skip');   -- 'update' | 'skip'
  v_pen boolean := coalesce((p_options->>'pen')::boolean, false);
  v_event_on boolean := coalesce((p_options->'event'->>'enabled')::boolean, false);
  v_event_type text := coalesce(nullif(p_options->'event'->>'type', ''), 'webinar');
  v_event_subject text := nullif(btrim(p_options->'event'->>'subject'), '');
  v_event_date timestamptz;

  v_row jsonb;
  v_first text; v_last text; v_title text; v_phone text; v_mobile text;
  v_company text; v_industry text; v_website text; v_linkedin text; v_department text;
  v_street text; v_city text; v_state text; v_zip text; v_country text; v_notes text;
  v_dnc boolean;
  v_cred text; v_source text;
  v_emails text[]; v_primary text;
  v_norm text; v_acct_count int; v_acct_id uuid;
  v_match_id uuid; v_match_acct uuid;
  v_contact_id uuid; v_contact_acct uuid;
  v_stamp_ext text; v_stamp_rc int;
  v_action text;  -- what the real run did to this row; counted only after
                  -- the row's LAST statement so an error can't inflate counts

  -- classification (populated in both modes)
  v_will_create int := 0;
  v_will_update int := 0;
  v_will_skip int := 0;
  v_invalid int := 0;
  v_ambiguous int := 0;
  v_will_stamp int := 0;
  -- actuals (only on real run)
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_events int := 0;
  v_errors int := 0;
  v_last_error text := null;
begin
  if v_uid is null
     or public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  v_owner := coalesce(nullif(p_options->>'owner_user_id', '')::uuid, v_uid);
  if v_dup_mode not in ('update', 'skip') then v_dup_mode := 'skip'; end if;
  if v_event_type not in ('webinar','conference','meeting','call','email','note') then
    v_event_type := 'webinar';
  end if;
  begin
    v_event_date := coalesce(nullif(p_options->'event'->>'date','')::timestamptz, now());
  exception when others then
    v_event_date := now();
  end;
  -- An event with no subject can't be stamped meaningfully.
  if v_event_on and v_event_subject is null then v_event_on := false; end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
  loop
    begin
      v_action  := null;
      v_first   := nullif(btrim(v_row->>'first_name'), '');
      v_last    := nullif(btrim(v_row->>'last_name'), '');
      v_title   := nullif(btrim(v_row->>'title'), '');
      v_phone   := nullif(btrim(v_row->>'phone'), '');
      v_mobile  := nullif(btrim(v_row->>'mobile_phone'), '');
      v_company := nullif(btrim(v_row->>'company'), '');
      v_industry:= nullif(btrim(v_row->>'industry'), '');
      v_website := nullif(btrim(v_row->>'website'), '');
      v_linkedin:= nullif(btrim(v_row->>'linkedin_url'), '');
      v_department := nullif(btrim(v_row->>'department'), '');
      v_street  := nullif(btrim(v_row->>'mailing_street'), '');
      v_city    := nullif(btrim(v_row->>'mailing_city'), '');
      v_state   := nullif(btrim(v_row->>'mailing_state'), '');
      v_zip     := nullif(btrim(v_row->>'mailing_zip'), '');
      v_country := nullif(btrim(v_row->>'mailing_country'), '');
      v_notes   := nullif(btrim(v_row->>'notes'), '');
      v_dnc     := coalesce((v_row->>'do_not_contact')::boolean, false);

      -- validate optional enum fields; unknown values become null, not errors
      v_cred := nullif(btrim(v_row->>'credential'), '');
      if v_cred is not null and not (v_cred = any (enum_range(null::public.credential_type)::text[])) then
        v_cred := null;
      end if;
      v_source := nullif(btrim(v_row->>'lead_source'), '');
      if v_source is not null and not (v_source = any (enum_range(null::public.lead_source)::text[])) then
        v_source := null;
      end if;

      -- distinct, order-preserving list of the up-to-3 emails on this row.
      -- Malformed entries (failing the contacts_email*_format CHECKs) are
      -- treated as absent so neither pass can hit a constraint error.
      select array_agg(e order by ord) into v_emails
      from (
        select lower(btrim(x)) as e, min(ord) as ord
        from unnest(array[v_row->>'email', v_row->>'email2', v_row->>'email3'])
             with ordinality as t(x, ord)
        where nullif(btrim(x), '') is not null
          and position('@' in btrim(x)) > 1
        group by lower(btrim(x))
      ) s;
      v_primary := case when v_emails is not null and array_length(v_emails,1) >= 1 then v_emails[1] else null end;

      -- must have a last name (NOT NULL column)
      if v_last is null then
        v_invalid := v_invalid + 1;
        continue;
      end if;

      -- dedup against a live contact by primary email (canonical predicate).
      -- Pen mode included: a pending row with this email is a live contact
      -- too, so re-importing the same list skips instead of duplicating.
      v_match_id := null; v_match_acct := null;
      if v_primary is not null then
        select c.id, c.account_id into v_match_id, v_match_acct
        from public.contacts c
        where c.archived_at is null
          and public.contact_matches_email(c, v_primary)
        order by c.created_at asc, c.id asc
        limit 1;
      end if;

      if v_match_id is not null then
        -- EXISTING contact
        v_contact_id := v_match_id;
        v_contact_acct := v_match_acct;
        if v_dup_mode = 'update' then
          v_will_update := v_will_update + 1;
          if not p_dry_run then
            update public.contacts c set
              first_name    = coalesce(nullif(btrim(c.first_name), ''), v_first),
              title         = coalesce(nullif(btrim(c.title), ''), v_title),
              phone         = coalesce(nullif(btrim(c.phone), ''), v_phone),
              mobile_phone  = coalesce(nullif(btrim(c.mobile_phone), ''), v_mobile),
              department    = coalesce(nullif(btrim(c.department), ''), v_department),
              linkedin_url  = coalesce(nullif(btrim(c.linkedin_url), ''), v_linkedin),
              credential    = coalesce(c.credential, v_cred::public.credential_type),
              lead_source   = coalesce(c.lead_source, v_source::public.lead_source),
              mailing_street= coalesce(nullif(btrim(c.mailing_street), ''), v_street),
              mailing_city  = coalesce(nullif(btrim(c.mailing_city), ''), v_city),
              mailing_state = coalesce(nullif(btrim(c.mailing_state), ''), v_state),
              mailing_zip   = coalesce(nullif(btrim(c.mailing_zip), ''), v_zip),
              mailing_country = coalesce(nullif(btrim(c.mailing_country), ''), v_country),
              notes         = coalesce(nullif(btrim(c.notes), ''), v_notes),
              do_not_contact = c.do_not_contact or v_dnc,
              updated_by    = v_uid
            where c.id = v_match_id;
            v_action := 'updated';
          end if;
        else
          v_will_skip := v_will_skip + 1;
          if not p_dry_run then v_action := 'skipped'; end if;
        end if;
      else
        -- NEW contact.
        -- Pen mode: NO account resolution — the row lands as a PENDING
        -- import (import_status='pending', raw company kept on
        -- import_company); matching happens at promote time via
        -- promote_pending_imports. Non-pen: resolve account by normalized
        -- company name exactly as before.
        v_acct_id := null;
        v_acct_count := 0;
        v_norm := case when v_pen then null else public.norm_company(v_company) end;
        if v_norm is not null then
          select count(*) into v_acct_count
          from public.accounts a
          where a.archived_at is null and public.norm_company(a.name) = v_norm;
          if v_acct_count = 1 then
            select a.id into v_acct_id
            from public.accounts a
            where a.archived_at is null and public.norm_company(a.name) = v_norm
            limit 1;
          elsif v_acct_count > 1 then
            v_ambiguous := v_ambiguous + 1;   -- created account-less; never guess
          end if;
        end if;

        v_will_create := v_will_create + 1;

        if not p_dry_run then
          -- create the account when the company is unambiguously new
          if not v_pen and v_acct_id is null and v_norm is not null and v_acct_count = 0 then
            insert into public.accounts (name, owner_user_id, industry, website,
              billing_street, billing_city, billing_state, billing_zip, billing_country,
              created_by, updated_by)
            values (btrim(v_company), v_owner, v_industry, v_website,
              v_street, v_city, v_state, v_zip, v_country, v_uid, v_uid)
            returning id into v_acct_id;
          end if;

          insert into public.contacts (
            account_id, owner_user_id, first_name, last_name,
            email, email2, email3, title, phone, mobile_phone,
            department, linkedin_url, credential, lead_source,
            mailing_street, mailing_city, mailing_state, mailing_zip, mailing_country,
            notes, do_not_contact, is_primary, imported_at, created_by, updated_by,
            import_status, import_company
          ) values (
            v_acct_id, v_owner, v_first, v_last,
            v_emails[1], v_emails[2], v_emails[3], v_title, v_phone, v_mobile,
            v_department, v_linkedin, v_cred::public.credential_type, v_source::public.lead_source,
            v_street, v_city, v_state, v_zip, v_country,
            v_notes, v_dnc, false, now(), v_uid, v_uid,
            case when v_pen then 'pending' else null end,
            case when v_pen then btrim(v_company) else null end
          ) returning id, account_id into v_contact_id, v_contact_acct;
          v_action := 'created';
        else
          v_contact_id := null;   -- nothing created in dry run
        end if;
      end if;

      -- optional event stamp on the resolved contact (idempotent)
      if v_event_on then
        v_will_stamp := v_will_stamp + 1;
        if not p_dry_run and v_contact_id is not null then
          v_stamp_ext := 'evt:' || md5(v_event_type || '|' || coalesce(v_event_subject,'') || '|' || v_event_date::text)
                         || ':' || v_contact_id::text;
          insert into public.activities (
            contact_id, account_id, owner_user_id, activity_type, subject,
            activity_date, source, external_id
          ) values (
            v_contact_id, v_contact_acct, v_owner, v_event_type::public.activity_type, v_event_subject,
            v_event_date, 'contact_import', v_stamp_ext
          )
          -- The unique index is PARTIAL (where source/external_id not null);
          -- the arbiter must restate its predicate or Postgres can't infer
          -- it and raises 42P10 (which would roll back the whole row).
          on conflict (source, external_id)
            where source is not null and external_id is not null
            do nothing;
          get diagnostics v_stamp_rc = row_count;
          if v_stamp_rc > 0 then v_events := v_events + 1; end if;
        end if;
      end if;

      -- Tally actuals LAST: if anything above raised, the row's writes
      -- rolled back and these counters must not claim otherwise.
      if v_action = 'created' then v_created := v_created + 1;
      elsif v_action = 'updated' then v_updated := v_updated + 1;
      elsif v_action = 'skipped' then v_skipped := v_skipped + 1;
      end if;

    exception when others then
      v_errors := v_errors + 1;
      v_last_error := SQLERRM;
    end;
  end loop;

  return jsonb_build_object(
    'total', coalesce(jsonb_array_length(p_rows), 0),
    'will_create', v_will_create,
    'will_update', v_will_update,
    'will_skip', v_will_skip,
    'invalid', v_invalid,
    'ambiguous_account', v_ambiguous,
    'will_stamp', v_will_stamp,
    'created', v_created,
    'updated', v_updated,
    'skipped', v_skipped,
    'events_stamped', v_events,
    'errors', v_errors,
    'last_error', v_last_error,
    'dry_run', p_dry_run
  );
end;
$$;

revoke execute on function public.import_contacts_rows(jsonb, jsonb, boolean) from public;
revoke execute on function public.import_contacts_rows(jsonb, jsonb, boolean) from anon;
grant execute on function public.import_contacts_rows(jsonb, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- promote_pending_imports — clear the pen flag, resolving the account
-- from the raw import_company at promote time. Result-shape parity with
-- bulk_promote_imports (the legacy leads promoter) so the UI reads both.
-- ---------------------------------------------------------------------

create or replace function public.promote_pending_imports(
  p_ids uuid[],
  p_promote_ambiguous_accountless boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  c record;
  v_norm text; v_acct_count int; v_acct_id uuid;
  v_found int := 0;
  v_promoted int := 0;
  v_promoted_ambiguous_accountless int := 0;
  v_skipped_ambiguous int := 0;
  v_errors int := 0;
  v_ambiguous_detail jsonb := '[]'::jsonb;
  v_error_detail jsonb := '[]'::jsonb;
begin
  if v_uid is null
     or public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  for c in
    select ct.id, ct.import_company, ct.first_name, ct.last_name
    from public.contacts ct
    where ct.id = any(p_ids)
      and ct.import_status = 'pending'
      and ct.archived_at is null
  loop
    begin
      v_found := v_found + 1;
      v_acct_id := null;
      v_acct_count := 0;
      v_norm := public.norm_company(c.import_company);

      -- Placeholder orgs (unknown/n-a/none/tbd/self/retired) promote
      -- ACCOUNT-LESS, same as no company at all (2026-06-16 decision,
      -- restored in 20260717000010).
      if v_norm in ('unknown', 'n a', 'na', 'none', 'tbd', 'self', 'retired') then
        v_norm := null;
      end if;

      if v_norm is not null then
        select count(*) into v_acct_count
        from public.accounts a
        where a.archived_at is null and public.norm_company(a.name) = v_norm;
        if v_acct_count = 1 then
          select a.id into v_acct_id
          from public.accounts a
          where a.archived_at is null and public.norm_company(a.name) = v_norm
          limit 1;
        elsif v_acct_count > 1 and not p_promote_ambiguous_accountless then
          -- multiple accounts match — never guess; skip unless the
          -- account-less opt-in was passed
          v_skipped_ambiguous := v_skipped_ambiguous + 1;
          if jsonb_array_length(v_ambiguous_detail) < 25 then
            v_ambiguous_detail := v_ambiguous_detail || jsonb_build_object(
              'contact_id', c.id,
              'name', btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')),
              'company', c.import_company,
              'matches', v_acct_count);
          end if;
          continue;
        end if;
      end if;

      if v_norm is not null and v_acct_id is null and v_acct_count = 0 then
        insert into public.accounts (name, owner_user_id, created_by, updated_by)
        values (btrim(c.import_company), v_uid, v_uid, v_uid)
        returning id into v_acct_id;
      end if;

      update public.contacts ct
         set account_id = coalesce(v_acct_id, ct.account_id),
             import_status = null,
             updated_by = v_uid
       where ct.id = c.id;

      if v_norm is not null and v_acct_count > 1 then
        -- opted-in ambiguous promote: account-less, itemized
        v_promoted_ambiguous_accountless := v_promoted_ambiguous_accountless + 1;
        if jsonb_array_length(v_ambiguous_detail) < 25 then
          v_ambiguous_detail := v_ambiguous_detail || jsonb_build_object(
            'contact_id', c.id,
            'name', btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')),
            'company', c.import_company,
            'matches', v_acct_count);
        end if;
      end if;
      v_promoted := v_promoted + 1;

    exception when others then
      v_errors := v_errors + 1;
      if jsonb_array_length(v_error_detail) < 25 then
        v_error_detail := v_error_detail || jsonb_build_object(
          'contact_id', c.id, 'error', SQLERRM, 'code', SQLSTATE);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'promoted', v_promoted,
    'skipped_duplicate', 0,
    'skipped_ambiguous', v_skipped_ambiguous,
    'skipped_other', greatest(coalesce(cardinality(p_ids), 0) - v_found, 0),
    'errors', v_errors,
    'promoted_ambiguous_accountless', v_promoted_ambiguous_accountless,
    'ambiguous_detail', v_ambiguous_detail,
    'error_detail', v_error_detail
  );
end;
$$;

revoke execute on function public.promote_pending_imports(uuid[], boolean) from public;
revoke execute on function public.promote_pending_imports(uuid[], boolean) from anon;
grant execute on function public.promote_pending_imports(uuid[], boolean) to authenticated;

-- ---------------------------------------------------------------------
-- archive_pending_imports — set aside pending rows (bad/bounced/junk).
-- p_mark_do_not_contact=true is the Avoid flow: the row is archived AND
-- flagged so future outreach/import passes keep skipping the address.
-- ---------------------------------------------------------------------

create or replace function public.archive_pending_imports(
  p_ids uuid[],
  p_reason text default 'import cleanup',
  p_mark_do_not_contact boolean default false
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null
     or public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  update public.contacts ct
     set archived_at = timezone('utc', now()),
         archived_by = v_uid,
         archive_reason = p_reason,
         do_not_contact = ct.do_not_contact or p_mark_do_not_contact,
         updated_by = v_uid
   where ct.id = any(p_ids)
     and ct.import_status = 'pending'
     and ct.archived_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.archive_pending_imports(uuid[], text, boolean) from public;
revoke execute on function public.archive_pending_imports(uuid[], text, boolean) from anon;
grant execute on function public.archive_pending_imports(uuid[], text, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
