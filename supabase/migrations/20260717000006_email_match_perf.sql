-- ---------------------------------------------------------------------
-- Fix: "Bulk promote from file" preview times out on real-size files
-- (Nathan, 2026-07-17 — Jordan's 13k-row clean list; "canceling statement
-- due to statement timeout").
--
-- ROOT CAUSE: 20260706000006 swapped count_promotable_leads' dedup check
-- to contact_matches_email(c, l.email). That helper compares
-- lower(btrim(col)) — an expression NO index covers (the only email index,
-- idx_contacts_lower_email_live, is on lower(email), and email2/email3
-- have no indexes at all). Result: a sequential scan of contacts for
-- EVERY lead in a 2,000-id preview chunk. bulk_promote_imports' dedup
-- EXISTS has the same shape.
--
-- FIX, three layers:
--   1. Expression indexes that EXACTLY match contact_matches_email's
--      lower(btrim(...)) expressions (live rows only) — also lets the
--      planner index the helper wherever it inlines (convert_lead,
--      email_dup_status, dedup finder).
--   2. Re-emit count_promotable_leads + bulk_promote_imports with the
--      predicate written out sargably (identical semantics to
--      contact_matches_email) so the fast plan never depends on
--      function inlining.
--   3. (Client) smaller preview/promote chunks for headroom.
-- ---------------------------------------------------------------------

begin;

-- ── 1. Matching expression indexes ───────────────────────────────────
create index if not exists idx_contacts_btrim_email_live
  on public.contacts (lower(btrim(email)))
  where archived_at is null and email is not null;
create index if not exists idx_contacts_btrim_email2_live
  on public.contacts (lower(btrim(email2)))
  where archived_at is null and email2 is not null;
create index if not exists idx_contacts_btrim_email3_live
  on public.contacts (lower(btrim(email3)))
  where archived_at is null and email3 is not null;

-- Email→lead resolution (resolve_lead_ids_by_email) probes leads by
-- lower(email); give it an index too.
create index if not exists idx_leads_lower_email
  on public.leads (lower(email))
  where email is not null;

-- ── 2a. count_promotable_leads: sargable dedup predicate ─────────────
-- Verbatim from 20260706000006 except the is_contact EXISTS, which now
-- spells out contact_matches_email's logic so it hits the three partial
-- indexes above (BitmapOr) instead of seq-scanning contacts per lead.
create or replace function public.count_promotable_leads(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v jsonb;
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  select jsonb_build_object(
    'matched',         count(*),
    'promotable',      count(*) filter (where eligible and not is_contact),
    'already_done',    count(*) filter (where not eligible),
    'already_contact', count(*) filter (where eligible and is_contact)
  )
  into v
  from (
    select
      (l.status is distinct from 'converted'::public.lead_status
        and l.converted_account_id is null
        and l.archived_at is null) as eligible,
      (l.email is not null and btrim(l.email) <> '' and exists (
        select 1 from public.contacts c
         where c.archived_at is null
           and (   (c.email  is not null and lower(btrim(c.email))  = lower(btrim(l.email)))
                or (c.email2 is not null and lower(btrim(c.email2)) = lower(btrim(l.email)))
                or (c.email3 is not null and lower(btrim(c.email3)) = lower(btrim(l.email))))
      )) as is_contact
    from public.leads l
    where l.id = any(coalesce(p_ids, '{}'::uuid[]))
  ) t;

  return v;
end;
$$;

-- ── 2b. bulk_promote_imports: same sargable predicate in its dedup ───
-- Verbatim from 20260717000005 except the skipped-duplicate EXISTS.
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

commit;

notify pgrst, 'reload schema';
