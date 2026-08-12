-- ============================================================
-- Guarded account pair-merge for non-admin CRM users (Nathan, 2026-08-11).
--
-- Plain English: any CRM user with write power (sales / renewals / admin /
-- super_admin — the same set has_crm_write_role() already defines; read_only
-- and NULL-role users are refused) can merge EXACTLY TWO duplicate accounts
-- through a guided review screen. They choose, field by field, which value
-- the kept record ends up with. Undo stays admin-only, and for merges made
-- through this tool undo ALSO restores the kept record's profile fields to
-- their pre-merge values (the June tool never could — it only moved
-- relationships back).
--
-- What this migration does:
--   1. _merge_accounts_core(...)  — the June merge body extracted into one
--      shared, PRIVATE function (EXECUTE revoked from everyone; only the two
--      SECURITY DEFINER wrappers below can reach it), extended with the five
--      account-FK tables built AFTER the June tool that it silently left
--      pointing at archived losers:
--        account_attachments      (files — moved)
--        contact_account_links    (multi-account contact links — moved,
--                                  collision-safe vs unique(contact,account))
--        campaign_enrollments     (account context — moved)
--        deal_wins                (wins feed history — moved)
--        partner_contract_summaries (derived per-account cache with
--                                  account_id as PRIMARY KEY — the loser's
--                                  row can't move onto the survivor, so it is
--                                  snapshotted + deleted; the nightly job
--                                  rebuilds it from the moved deals)
--      This upgrade applies to the ADMIN cleanup tool too, for free.
--   2. merge_accounts(...) re-emitted as a thin admin-only wrapper around the
--      core. Same signature, same behavior, same audit shape as before.
--   3. merge_account_pair(...) — the new guarded RPC. Write-role gate,
--      exactly two live accounts, row locks in stable order, optimistic
--      concurrency via required updated_at snapshots, a STRICT server-side
--      whitelist of choosable columns, compliance flags OR'd (never
--      choosable), full audit row incl. the survivor's pre-merge snapshot
--      and the caller's field choices. Single transaction; any failure
--      (bad cast, unknown column, stale snapshot) aborts the whole thing.
--   4. undo_account_merge(...) re-emitted: understands the five new moved
--      keys, and when the merge row carries survivor_before it restores the
--      whitelisted profile columns on the survivor (documented: this also
--      rolls back any post-merge edits to THOSE columns — the admin UI says
--      so before the click).
--
-- Style: security definer · search_path = public · NULL-safe role checks,
-- matching 20260616000013 + 20260624000004.
-- ============================================================

begin;

-- ── Audit columns for the new tool (nullable; legacy rows unaffected) ───
alter table public.account_merges
  add column if not exists survivor_before jsonb,
  add column if not exists field_choices   jsonb,
  add column if not exists merged_via      text;

-- ──────────────────────────────────────────────────────────────────────
-- 1. THE SHARED CORE — June body + the five newer tables.
--    PRIVATE: execute revoked from public/anon/authenticated below.
--    Returns everything the wrappers need to write the audit row.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public._merge_accounts_core(
  p_survivor_id uuid,
  p_loser_ids   uuid[],
  p_reason      text,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_losers           uuid[];
  v_loser_rows       jsonb;
  v_moved            jsonb := '{}'::jsonb;
  v_demoted          uuid[];
  v_partners_deleted jsonb := '[]'::jsonb;
  v_pcs_deleted      jsonb := '[]'::jsonb;
  v_total            int := 0;
  v_tmp              jsonb;
  v_cnt              int;
begin
  -- ── Validity guards (role guards live in the wrappers) ──────────────
  if p_survivor_id is null or p_loser_ids is null
     or array_length(p_loser_ids, 1) is null then
    raise exception 'A survivor and at least one other account are required';
  end if;

  select array_agg(distinct x) into v_losers
    from unnest(p_loser_ids) x
   where x is not null
     and x is distinct from p_survivor_id;
  if v_losers is null or array_length(v_losers, 1) is null then
    raise exception 'No accounts left to merge after removing the survivor';
  end if;

  perform 1 from public.accounts where id = p_survivor_id;
  if not found then
    raise exception 'Survivor account % not found', p_survivor_id;
  end if;
  if exists (select 1 from public.accounts
              where id = p_survivor_id and archived_at is not null) then
    raise exception 'Survivor account is archived';
  end if;
  if (select count(*) from public.accounts
        where id = any(v_losers) and archived_at is null)
       <> array_length(v_losers, 1) then
    raise exception 'One or more accounts to merge are missing or already archived';
  end if;

  -- ── Snapshot loser account rows (for undo/audit) ───────────────────
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_loser_rows
    from public.accounts a where a.id = any(v_losers);

  -- ── Reparent children (capture {id, from} BEFORE each update) ──────

  -- opportunities (RESTRICT FK)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb),
         count(*)
    into v_tmp, v_cnt
    from public.opportunities where account_id = any(v_losers);
  update public.opportunities set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('opportunities', v_tmp);
  v_total := v_total + v_cnt;

  -- contacts (record was_primary so undo can restore it)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id, 'was_primary', is_primary)), '[]'::jsonb),
         count(*)
    into v_tmp, v_cnt
    from public.contacts where account_id = any(v_losers);
  update public.contacts set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('contacts', v_tmp);
  v_total := v_total + v_cnt;

  -- is_primary collision: keep ONE primary on the survivor (oldest).
  with primaries as (
    select id, row_number() over (order by created_at asc, id asc) as rn
      from public.contacts
     where account_id = p_survivor_id and is_primary = true and archived_at is null
  ),
  demote as (
    update public.contacts c set is_primary = false
      from primaries p
     where c.id = p.id and p.rn > 1
    returning c.id
  )
  select coalesce(array_agg(id), '{}') into v_demoted from demote;

  -- activities
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb),
         count(*)
    into v_tmp, v_cnt
    from public.activities where account_id = any(v_losers);
  update public.activities set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('activities', v_tmp);
  v_total := v_total + v_cnt;

  -- leads.converted_account_id
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', converted_account_id)), '[]'::jsonb)
    into v_tmp
    from public.leads where converted_account_id = any(v_losers);
  update public.leads set converted_account_id = p_survivor_id where converted_account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('leads_converted_account', v_tmp);

  -- accounts.parent_account_id + self-loop guard
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', parent_account_id)), '[]'::jsonb)
    into v_tmp
    from public.accounts where parent_account_id = any(v_losers);
  update public.accounts set parent_account_id = p_survivor_id where parent_account_id = any(v_losers);
  update public.accounts set parent_account_id = null
   where id = p_survivor_id and parent_account_id = p_survivor_id;
  v_moved := v_moved || jsonb_build_object('accounts_parent', v_tmp);

  -- pandadoc_documents
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb)
    into v_tmp
    from public.pandadoc_documents where account_id = any(v_losers);
  update public.pandadoc_documents set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('pandadoc_documents', v_tmp);

  -- contract_files
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb)
    into v_tmp
    from public.contract_files where account_id = any(v_losers);
  update public.contract_files set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('contract_files', v_tmp);

  -- account_number_migrations
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb)
    into v_tmp
    from public.account_number_migrations where account_id = any(v_losers);
  update public.account_number_migrations set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('account_number_migrations', v_tmp);

  -- renewal_automation_config.test_account_id (singleton edge case)
  update public.renewal_automation_config set test_account_id = p_survivor_id
   where test_account_id = any(v_losers);

  -- account_attachments (NEW 2026-08-12: files must follow the company)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb),
         count(*)
    into v_tmp, v_cnt
    from public.account_attachments where account_id = any(v_losers);
  update public.account_attachments set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('account_attachments', v_tmp);
  v_total := v_total + v_cnt;

  -- campaign_enrollments.account_id (NEW: keep campaign context)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb)
    into v_tmp
    from public.campaign_enrollments where account_id = any(v_losers);
  update public.campaign_enrollments set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('campaign_enrollments', v_tmp);

  -- deal_wins.account_id (NEW: wins feed history)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb)
    into v_tmp
    from public.deal_wins where account_id = any(v_losers);
  update public.deal_wins set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('deal_wins', v_tmp);

  -- contact_account_links (NEW; unique(contact_id, account_id) is not
  -- deferrable, so mirror the account_partners approach: snapshot + delete
  -- rows that WOULD collide after substitution, then substitute).
  with sub as (
    select cal.id,
           (cal.account_id = any(v_losers)) as touches_loser,
           cal.contact_id,
           case when cal.account_id = any(v_losers) then p_survivor_id else cal.account_id end as na
      from public.contact_account_links cal
     where cal.account_id = any(v_losers) or cal.account_id = p_survivor_id
  ),
  ranked as (
    select id, touches_loser,
           row_number() over (partition by contact_id, na
                              order by touches_loser asc, id asc) as rn
      from sub
  ),
  del as (
    delete from public.contact_account_links cal
     using ranked r
     where cal.id = r.id and r.rn > 1 and r.touches_loser
    returning cal.*
  )
  select coalesce(jsonb_agg(to_jsonb(del)), '[]'::jsonb) into v_tmp from del;
  v_moved := v_moved || jsonb_build_object('contact_account_links_deleted', v_tmp);

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb)
    into v_tmp
    from public.contact_account_links where account_id = any(v_losers);
  update public.contact_account_links set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('contact_account_links', v_tmp);

  -- partner_contract_summaries (NEW; account_id is the PRIMARY KEY, so the
  -- loser's derived cache row cannot move — snapshot + delete; the summary
  -- job rebuilds the survivor's row from the deals that just moved).
  select coalesce(jsonb_agg(to_jsonb(pcs)), '[]'::jsonb)
    into v_pcs_deleted
    from public.partner_contract_summaries pcs where account_id = any(v_losers);
  delete from public.partner_contract_summaries where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('partner_contract_summaries_deleted', v_pcs_deleted);

  -- ── account_partners: collision-safe reparent (unchanged from June) ──
  with would_selflink as (
    select * from public.account_partners ap
     where (ap.partner_account_id = any(v_losers) or ap.partner_account_id = p_survivor_id)
       and (ap.member_account_id  = any(v_losers) or ap.member_account_id  = p_survivor_id)
  )
  select v_partners_deleted || coalesce(jsonb_agg(to_jsonb(would_selflink)), '[]'::jsonb)
    into v_partners_deleted from would_selflink;
  delete from public.account_partners ap
   where (ap.partner_account_id = any(v_losers) or ap.partner_account_id = p_survivor_id)
     and (ap.member_account_id  = any(v_losers) or ap.member_account_id  = p_survivor_id);

  with sub as (
    select ap.id, ap.created_at,
           (ap.partner_account_id = any(v_losers) or ap.member_account_id = any(v_losers)) as touches_loser,
           case when ap.partner_account_id = any(v_losers) then p_survivor_id else ap.partner_account_id end as np,
           case when ap.member_account_id  = any(v_losers) then p_survivor_id else ap.member_account_id  end as nm
      from public.account_partners ap
  ),
  ranked as (
    select id, touches_loser,
           row_number() over (partition by np, nm
                              order by touches_loser asc, created_at asc, id asc) as rn
      from sub
  ),
  del as (
    delete from public.account_partners ap
     using ranked r
     where ap.id = r.id and r.rn > 1 and r.touches_loser
    returning ap.*
  )
  select v_partners_deleted || coalesce(jsonb_agg(to_jsonb(del)), '[]'::jsonb)
    into v_partners_deleted from del;

  update public.account_partners
     set partner_account_id = case when partner_account_id = any(v_losers) then p_survivor_id else partner_account_id end,
         member_account_id  = case when member_account_id  = any(v_losers) then p_survivor_id else member_account_id  end
   where partner_account_id = any(v_losers) or member_account_id = any(v_losers);

  -- ── Soft-archive the losers (NEVER hard-delete) ─────────────────────
  update public.accounts
     set archived_at    = timezone('utc', now()),
         archived_by    = p_actor,
         archive_reason = coalesce(nullif(btrim(p_reason), ''),
                                   'Merged into ' || p_survivor_id::text)
   where id = any(v_losers)
     and archived_at is null;

  return jsonb_build_object(
    'losers',           to_jsonb(v_losers),
    'before_state', jsonb_build_object(
      'survivor_id',      p_survivor_id,
      'loser_rows',       v_loser_rows,
      'moved',            v_moved,
      'demoted_contacts', to_jsonb(coalesce(v_demoted, '{}')),
      'partners_deleted', v_partners_deleted,
      'reparented_total', v_total
    ),
    'reparented_total', v_total
  );
end;
$$;

-- PRIVATE: nobody calls the core directly. The wrappers are SECURITY
-- DEFINER, so they can still reach it as the function owner.
revoke all on function public._merge_accounts_core(uuid, uuid[], text, uuid) from public;
revoke all on function public._merge_accounts_core(uuid, uuid[], text, uuid) from anon;
revoke all on function public._merge_accounts_core(uuid, uuid[], text, uuid) from authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 2. ADMIN WRAPPER — same contract as the June merge_accounts.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.merge_accounts(
  p_survivor_id uuid,
  p_loser_ids   uuid[],
  p_reason      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_core     jsonb;
  v_merge_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Not authorized: account merge requires admin';
  end if;

  v_core := public._merge_accounts_core(p_survivor_id, p_loser_ids, p_reason, v_uid);

  insert into public.account_merges (survivor_id, loser_ids, reason, merged_by, before_state, merged_via)
  values (
    p_survivor_id,
    (select array_agg(x::uuid) from jsonb_array_elements_text(v_core->'losers') x),
    p_reason, v_uid,
    v_core->'before_state',
    'admin_cleanup'
  )
  returning id into v_merge_id;

  return jsonb_build_object(
    'merge_id',        v_merge_id,
    'survivor_id',     p_survivor_id,
    'losers_archived', jsonb_array_length(v_core->'losers'),
    'rows_reparented', (v_core->>'reparented_total')::int
  );
end;
$$;

grant execute on function public.merge_accounts(uuid, uuid[], text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 3. THE GUARDED PAIR MERGE — any CRM write role, exactly two accounts.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.merge_account_pair(
  p_survivor_id                 uuid,
  p_loser_id                    uuid,
  p_field_choices               jsonb,
  p_expected_survivor_updated_at timestamptz,
  p_expected_loser_updated_at    timestamptz,
  p_reason                      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The ONLY columns a caller may set through this tool. Everything else in
  -- p_field_choices is rejected outright (not skipped — rejected, so a
  -- tampered client fails loudly instead of silently doing less).
  -- Mirrors account_fill_blanks' profile-field boundary, plus name,
  -- owner_user_id and renewal_cadence_years, minus the geocode floats.
  -- Compliance flags (do_not_contact, partner_prospect) are NEVER choosable:
  -- they are OR'd from both records below.
  c_whitelist constant text[] := array[
    'name','account_type','website','industry','sic','sic_description',
    'description','phone','phone_extension','fax','timezone',
    'billing_street','billing_city','billing_state','billing_zip','billing_country',
    'shipping_street','shipping_city','shipping_state','shipping_zip','shipping_country',
    'employees','fte_count','fte_range','number_of_providers','locations','annual_revenue',
    'lead_source','lead_source_detail','rating','next_steps','project','site','ownership',
    'partner_account','referring_partner','owner_user_id','renewal_cadence_years'
  ];
  v_uid             uuid := auth.uid();
  v_survivor        public.accounts%rowtype;
  v_loser           public.accounts%rowtype;
  v_survivor_before jsonb;
  v_core            jsonb;
  v_merge_id        uuid;
  v_key             text;
  v_new_name        text;
begin
  -- ── Who may do this: any CRM write role (sales/renewals/admin/super_admin).
  --    NULL-safe: no profile row / NULL role / read_only all land false.
  if not coalesce(public.has_crm_write_role(), false) then
    raise exception 'Not authorized: merging accounts requires a CRM write role';
  end if;

  if p_survivor_id is null or p_loser_id is null then
    raise exception 'Pick both accounts before merging';
  end if;
  if p_survivor_id = p_loser_id then
    raise exception 'Those are the same account';
  end if;
  if p_expected_survivor_updated_at is null or p_expected_loser_updated_at is null then
    raise exception 'Stale review: reopen the merge tool and try again';
  end if;

  -- ── Lock both rows in stable id order (no deadlock against a concurrent
  --    merge locking the same pair the other way round).
  for v_survivor in
    select * from public.accounts
     where id in (p_survivor_id, p_loser_id)
     order by id
       for update
  loop
    if v_survivor.id = p_loser_id then
      v_loser := v_survivor;
    end if;
  end loop;
  select * into v_survivor from public.accounts where id = p_survivor_id;
  if v_survivor.id is null or v_loser.id is null then
    raise exception 'One of the accounts no longer exists';
  end if;
  if v_survivor.archived_at is not null then
    raise exception 'The account you chose to keep is archived';
  end if;
  if v_loser.archived_at is not null then
    raise exception 'The other account is already archived — it may have been merged by someone else';
  end if;

  -- ── Optimistic concurrency: the rows must be exactly as reviewed.
  if v_survivor.updated_at is distinct from p_expected_survivor_updated_at
     or v_loser.updated_at is distinct from p_expected_loser_updated_at then
    raise exception 'These accounts changed while you were reviewing — reopen the merge tool to see current values';
  end if;

  -- ── Whitelist enforcement: reject ANY unknown key.
  if p_field_choices is not null and jsonb_typeof(p_field_choices) <> 'object' then
    raise exception 'field_choices must be an object';
  end if;
  for v_key in select jsonb_object_keys(coalesce(p_field_choices, '{}'::jsonb)) loop
    if not (v_key = any(c_whitelist)) then
      raise exception 'Field % cannot be set through the merge tool', v_key;
    end if;
  end loop;

  -- Merged name must not be blank (accounts.name is not null + required).
  if p_field_choices ? 'name' then
    v_new_name := nullif(btrim(p_field_choices->>'name'), '');
    if v_new_name is null then
      raise exception 'The kept account needs a name';
    end if;
  end if;

  -- ── Snapshot the survivor BEFORE anything changes (undo restores this).
  v_survivor_before := to_jsonb(v_survivor);

  -- ── Move everything (shared core; also archives the loser).
  v_core := public._merge_accounts_core(
    p_survivor_id, array[p_loser_id],
    coalesce(nullif(btrim(p_reason), ''), 'Merged duplicate ' || v_loser.name),
    v_uid
  );

  -- ── Apply the reviewer's field choices. Each cast failure aborts the
  --    whole transaction (single-transaction guarantee: no partial merge).
  --    jsonb null / JSON null / '' all mean "clear the field" for text.
  update public.accounts s set
    name             = case when p_field_choices ? 'name' then v_new_name else s.name end,
    account_type     = case when p_field_choices ? 'account_type' then nullif(btrim(p_field_choices->>'account_type'), '') else s.account_type end,
    website          = case when p_field_choices ? 'website' then nullif(btrim(p_field_choices->>'website'), '') else s.website end,
    industry         = case when p_field_choices ? 'industry' then nullif(btrim(p_field_choices->>'industry'), '') else s.industry end,
    sic              = case when p_field_choices ? 'sic' then nullif(btrim(p_field_choices->>'sic'), '') else s.sic end,
    sic_description  = case when p_field_choices ? 'sic_description' then nullif(btrim(p_field_choices->>'sic_description'), '') else s.sic_description end,
    description      = case when p_field_choices ? 'description' then nullif(btrim(p_field_choices->>'description'), '') else s.description end,
    phone            = case when p_field_choices ? 'phone' then nullif(btrim(p_field_choices->>'phone'), '') else s.phone end,
    phone_extension  = case when p_field_choices ? 'phone_extension' then nullif(btrim(p_field_choices->>'phone_extension'), '') else s.phone_extension end,
    fax              = case when p_field_choices ? 'fax' then nullif(btrim(p_field_choices->>'fax'), '') else s.fax end,
    timezone         = case when p_field_choices ? 'timezone' then nullif(btrim(p_field_choices->>'timezone'), '') else s.timezone end,
    billing_street   = case when p_field_choices ? 'billing_street' then nullif(btrim(p_field_choices->>'billing_street'), '') else s.billing_street end,
    billing_city     = case when p_field_choices ? 'billing_city' then nullif(btrim(p_field_choices->>'billing_city'), '') else s.billing_city end,
    billing_state    = case when p_field_choices ? 'billing_state' then nullif(btrim(p_field_choices->>'billing_state'), '') else s.billing_state end,
    billing_zip      = case when p_field_choices ? 'billing_zip' then nullif(btrim(p_field_choices->>'billing_zip'), '') else s.billing_zip end,
    billing_country  = case when p_field_choices ? 'billing_country' then nullif(btrim(p_field_choices->>'billing_country'), '') else s.billing_country end,
    shipping_street  = case when p_field_choices ? 'shipping_street' then nullif(btrim(p_field_choices->>'shipping_street'), '') else s.shipping_street end,
    shipping_city    = case when p_field_choices ? 'shipping_city' then nullif(btrim(p_field_choices->>'shipping_city'), '') else s.shipping_city end,
    shipping_state   = case when p_field_choices ? 'shipping_state' then nullif(btrim(p_field_choices->>'shipping_state'), '') else s.shipping_state end,
    shipping_zip     = case when p_field_choices ? 'shipping_zip' then nullif(btrim(p_field_choices->>'shipping_zip'), '') else s.shipping_zip end,
    shipping_country = case when p_field_choices ? 'shipping_country' then nullif(btrim(p_field_choices->>'shipping_country'), '') else s.shipping_country end,
    employees        = case when p_field_choices ? 'employees' then nullif(p_field_choices->>'employees', '')::integer else s.employees end,
    fte_count        = case when p_field_choices ? 'fte_count' then nullif(p_field_choices->>'fte_count', '')::integer else s.fte_count end,
    fte_range        = case when p_field_choices ? 'fte_range' then nullif(btrim(p_field_choices->>'fte_range'), '') else s.fte_range end,
    number_of_providers = case when p_field_choices ? 'number_of_providers' then nullif(p_field_choices->>'number_of_providers', '')::integer else s.number_of_providers end,
    locations        = case when p_field_choices ? 'locations' then nullif(p_field_choices->>'locations', '')::integer else s.locations end,
    annual_revenue   = case when p_field_choices ? 'annual_revenue' then nullif(p_field_choices->>'annual_revenue', '')::numeric else s.annual_revenue end,
    lead_source      = case when p_field_choices ? 'lead_source' then nullif(p_field_choices->>'lead_source', '')::public.lead_source else s.lead_source end,
    lead_source_detail = case when p_field_choices ? 'lead_source_detail' then nullif(btrim(p_field_choices->>'lead_source_detail'), '') else s.lead_source_detail end,
    rating           = case when p_field_choices ? 'rating' then nullif(btrim(p_field_choices->>'rating'), '') else s.rating end,
    next_steps       = case when p_field_choices ? 'next_steps' then nullif(btrim(p_field_choices->>'next_steps'), '') else s.next_steps end,
    project          = case when p_field_choices ? 'project' then nullif(btrim(p_field_choices->>'project'), '') else s.project end,
    site             = case when p_field_choices ? 'site' then nullif(btrim(p_field_choices->>'site'), '') else s.site end,
    ownership        = case when p_field_choices ? 'ownership' then nullif(btrim(p_field_choices->>'ownership'), '') else s.ownership end,
    partner_account  = case when p_field_choices ? 'partner_account' then nullif(btrim(p_field_choices->>'partner_account'), '') else s.partner_account end,
    referring_partner = case when p_field_choices ? 'referring_partner' then nullif(btrim(p_field_choices->>'referring_partner'), '') else s.referring_partner end,
    owner_user_id    = case when p_field_choices ? 'owner_user_id' then nullif(p_field_choices->>'owner_user_id', '')::uuid else s.owner_user_id end,
    renewal_cadence_years = case when p_field_choices ? 'renewal_cadence_years' then nullif(p_field_choices->>'renewal_cadence_years', '')::integer else s.renewal_cadence_years end,
    -- Compliance flags: OR'd, never choosable. If either record said
    -- "don't contact", the merged record says it too.
    do_not_contact   = coalesce(s.do_not_contact, false) or coalesce(v_loser.do_not_contact, false),
    partner_prospect = coalesce(s.partner_prospect, false) or coalesce(v_loser.partner_prospect, false),
    updated_at       = timezone('utc', now())
  where s.id = p_survivor_id;

  -- Chosen owner must be a real, active profile (FK catches deleted ids;
  -- this catches deactivated ones so accounts don't land on ghosts).
  if p_field_choices ? 'owner_user_id'
     and nullif(p_field_choices->>'owner_user_id', '') is not null
     and not exists (select 1 from public.user_profiles up
                      where up.id = (p_field_choices->>'owner_user_id')::uuid
                        and up.is_active = true) then
    raise exception 'The chosen owner is not an active user';
  end if;

  -- ── Audit row: everything undo needs, plus what was chosen and by whom.
  insert into public.account_merges
    (survivor_id, loser_ids, reason, merged_by, before_state,
     survivor_before, field_choices, merged_via)
  values
    (p_survivor_id, array[p_loser_id], p_reason, v_uid,
     v_core->'before_state',
     v_survivor_before, coalesce(p_field_choices, '{}'::jsonb), 'pair_tool')
  returning id into v_merge_id;

  return jsonb_build_object(
    'merge_id',        v_merge_id,
    'survivor_id',     p_survivor_id,
    'loser_id',        p_loser_id,
    'rows_reparented', (v_core->>'reparented_total')::int
  );
end;
$$;

grant execute on function public.merge_account_pair(uuid, uuid, jsonb, timestamptz, timestamptz, text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- 4. UNDO — June behavior + the new moved keys + survivor field restore.
--    Still admin-only.
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.undo_account_merge(p_merge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_m       record;
  v_moved   jsonb;
  v_demoted uuid[];
  v_b       jsonb;
  r         jsonb;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Not authorized: undo requires admin';
  end if;

  select * into v_m from public.account_merges where id = p_merge_id;
  if not found then
    raise exception 'Merge % not found', p_merge_id;
  end if;
  if v_m.undone_at is not null then
    return jsonb_build_object('merge_id', p_merge_id, 'already_undone', true);
  end if;

  v_moved   := coalesce(v_m.before_state->'moved', '{}'::jsonb);
  v_demoted := coalesce(
    (select array_agg(x::uuid)
       from jsonb_array_elements_text(v_m.before_state->'demoted_contacts') x),
    '{}');

  update public.accounts set archived_at = null, archived_by = null, archive_reason = null
   where id = any(v_m.loser_ids);

  for r in select * from jsonb_array_elements(coalesce(v_moved->'opportunities','[]'::jsonb)) loop
    update public.opportunities set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'contacts','[]'::jsonb)) loop
    update public.contacts
       set account_id = (r->>'from')::uuid,
           is_primary = coalesce((r->>'was_primary')::boolean, is_primary)
     where id = (r->>'id')::uuid;
  end loop;
  if array_length(v_demoted, 1) is not null then
    update public.contacts set is_primary = true where id = any(v_demoted);
  end if;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'activities','[]'::jsonb)) loop
    update public.activities set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'leads_converted_account','[]'::jsonb)) loop
    update public.leads set converted_account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'accounts_parent','[]'::jsonb)) loop
    update public.accounts set parent_account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'pandadoc_documents','[]'::jsonb)) loop
    update public.pandadoc_documents set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'contract_files','[]'::jsonb)) loop
    update public.contract_files set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'account_number_migrations','[]'::jsonb)) loop
    update public.account_number_migrations set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  -- New tables (rows absent on legacy merges: loops are no-ops).
  for r in select * from jsonb_array_elements(coalesce(v_moved->'account_attachments','[]'::jsonb)) loop
    update public.account_attachments set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'campaign_enrollments','[]'::jsonb)) loop
    update public.campaign_enrollments set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'deal_wins','[]'::jsonb)) loop
    update public.deal_wins set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'contact_account_links','[]'::jsonb)) loop
    update public.contact_account_links set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  -- Deleted contact_account_links rows (collision cleanup): resurrect —
  -- unlike partner links (documented June limitation, kept), these have no
  -- side effects and restoring them keeps contact history whole.
  for r in select * from jsonb_array_elements(coalesce(v_moved->'contact_account_links_deleted','[]'::jsonb)) loop
    insert into public.contact_account_links
      select * from jsonb_populate_record(null::public.contact_account_links, r)
    on conflict do nothing;
  end loop;

  -- Loser's partner_contract_summaries cache rows: restore the snapshot
  -- (survivor's row, if the nightly job rebuilt it meanwhile, is untouched).
  for r in select * from jsonb_array_elements(coalesce(v_moved->'partner_contract_summaries_deleted','[]'::jsonb)) loop
    insert into public.partner_contract_summaries
      select * from jsonb_populate_record(null::public.partner_contract_summaries, r)
    on conflict (account_id) do nothing;
  end loop;

  -- ── Survivor field restore (pair-tool merges only): put every column the
  --    merge tool could have touched back to its pre-merge value. Explicit
  --    trade-off, stated in the admin UI: legitimate edits made to THOSE
  --    columns after the merge are rolled back too.
  v_b := v_m.survivor_before;
  if v_b is not null then
    update public.accounts s set
      name             = coalesce(v_b->>'name', s.name),  -- name is NOT NULL
      account_type     = v_b->>'account_type',
      website          = v_b->>'website',
      industry         = v_b->>'industry',
      sic              = v_b->>'sic',
      sic_description  = v_b->>'sic_description',
      description      = v_b->>'description',
      phone            = v_b->>'phone',
      phone_extension  = v_b->>'phone_extension',
      fax              = v_b->>'fax',
      timezone         = v_b->>'timezone',
      billing_street   = v_b->>'billing_street',
      billing_city     = v_b->>'billing_city',
      billing_state    = v_b->>'billing_state',
      billing_zip      = v_b->>'billing_zip',
      billing_country  = v_b->>'billing_country',
      shipping_street  = v_b->>'shipping_street',
      shipping_city    = v_b->>'shipping_city',
      shipping_state   = v_b->>'shipping_state',
      shipping_zip     = v_b->>'shipping_zip',
      shipping_country = v_b->>'shipping_country',
      employees        = (v_b->>'employees')::integer,
      fte_count        = (v_b->>'fte_count')::integer,
      fte_range        = v_b->>'fte_range',
      number_of_providers = (v_b->>'number_of_providers')::integer,
      locations        = (v_b->>'locations')::integer,
      annual_revenue   = (v_b->>'annual_revenue')::numeric,
      lead_source      = (v_b->>'lead_source')::public.lead_source,
      lead_source_detail = v_b->>'lead_source_detail',
      rating           = v_b->>'rating',
      next_steps       = v_b->>'next_steps',
      project          = v_b->>'project',
      site             = v_b->>'site',
      ownership        = v_b->>'ownership',
      partner_account  = v_b->>'partner_account',
      referring_partner = v_b->>'referring_partner',
      owner_user_id    = (v_b->>'owner_user_id')::uuid,
      renewal_cadence_years = coalesce((v_b->>'renewal_cadence_years')::integer, s.renewal_cadence_years),
      do_not_contact   = coalesce((v_b->>'do_not_contact')::boolean, false),
      partner_prospect = coalesce((v_b->>'partner_prospect')::boolean, false),
      updated_at       = timezone('utc', now())
    where s.id = v_m.survivor_id;
  end if;

  update public.account_merges
     set undone_at = timezone('utc', now()), undone_by = v_uid
   where id = p_merge_id;

  return jsonb_build_object('merge_id', p_merge_id, 'undone', true,
                            'losers_restored', array_length(v_m.loser_ids, 1),
                            'survivor_fields_restored', v_b is not null);
end;
$$;

grant execute on function public.undo_account_merge(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
