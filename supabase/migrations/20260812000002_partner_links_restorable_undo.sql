-- ============================================================
-- Partner links fully reversible on undo (Nathan, 2026-08-12).
--
-- The merge touches account_partners three ways; undo previously reversed
-- NONE of them ("partner links removed during the merge aren't restored"
-- was the June tool's documented limitation — not acceptable for the
-- user-facing pair merge, which promises a complete reversal):
--   (a) would-be self-links      -> DELETED (snapshotted since June)
--   (b) post-substitution dupes  -> DELETED (snapshotted since June)
--   (c) surviving loser links    -> endpoints SUBSTITUTED loser->survivor
--                                   (original endpoints NOT captured until now)
--
-- This migration re-emits BOTH functions from 20260812000001:
--   * _merge_accounts_core additionally records (c) rows' original
--     endpoints under moved.account_partners_substituted.
--   * undo_account_merge reverses (c) then resurrects (a)+(b):
--       - original ids and timestamps kept
--       - skips (counted, returned) only links unrestorable by
--         definition: endpoint account hard-deleted since, would-be
--         self-link, or identical pair already present — `on conflict
--         do nothing` + WHERE guards mean no duplicate or constraint
--         violation is possible on the happy path
--       - anything unexpected raises and rolls back the ENTIRE undo
--         (plpgsql single-transaction semantics; the same guarantee that
--         visibly aborted the first staging test merge whole on 8/12)
--       - return payload gains partner_links_reverted / _restored /
--         _skipped
--   * June-era audit rows carry the same partners_deleted key, so LEGACY
--     merges gain (a)+(b) restoration retroactively; they lack the
--     substitution key, so (c) reversal simply no-ops for them.
-- ============================================================

begin;

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

  -- Record which rows phase (c) is about to substitute, with their
  -- ORIGINAL endpoints, so undo can put each link back on the restored
  -- account (2026-08-12: undo now reverses these; legacy merges lack the
  -- key and their undo simply skips the loop).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'partner_from', partner_account_id, 'member_from', member_account_id)), '[]'::jsonb)
    into v_tmp
    from public.account_partners
   where partner_account_id = any(v_losers) or member_account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('account_partners_substituted', v_tmp);

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

revoke all on function public._merge_accounts_core(uuid, uuid[], text, uuid) from public;
revoke all on function public._merge_accounts_core(uuid, uuid[], text, uuid) from anon;
revoke all on function public._merge_accounts_core(uuid, uuid[], text, uuid) from authenticated;

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
  v_pl_restored int := 0;
  v_pl_skipped  int := 0;
  v_pl_reverted int := 0;
  v_cnt         int;
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


  -- Loser's partner_contract_summaries cache rows: restore the snapshot
  -- (survivor's row, if the nightly job rebuilt it meanwhile, is untouched).
  for r in select * from jsonb_array_elements(coalesce(v_moved->'partner_contract_summaries_deleted','[]'::jsonb)) loop
    insert into public.partner_contract_summaries
      select * from jsonb_populate_record(null::public.partner_contract_summaries, r)
    on conflict (account_id) do nothing;
  end loop;

  -- account_partners, part 1 — reverse the endpoint substitutions: every
  -- link the merge rewrote from loser to survivor goes back to the
  -- restored account. Skipped (and counted) when the row is gone, an
  -- endpoint no longer exists, or an identical link already sits at the
  -- original pair (someone re-created it after the merge) — `where` is
  -- the guard, so no unique/self-link violation can fire. Legacy June
  -- merges have no 'account_partners_substituted' key: loop no-ops.
  for r in select * from jsonb_array_elements(coalesce(v_moved->'account_partners_substituted','[]'::jsonb)) loop
    update public.account_partners ap
       set partner_account_id = (r->>'partner_from')::uuid,
           member_account_id  = (r->>'member_from')::uuid
     where ap.id = (r->>'id')::uuid
       and (r->>'partner_from') is distinct from (r->>'member_from')
       and exists (select 1 from public.accounts a where a.id = (r->>'partner_from')::uuid)
       and exists (select 1 from public.accounts a where a.id = (r->>'member_from')::uuid)
       and not exists (select 1 from public.account_partners x
                        where x.partner_account_id = (r->>'partner_from')::uuid
                          and x.member_account_id  = (r->>'member_from')::uuid
                          and x.id <> ap.id);
    get diagnostics v_cnt = row_count;
    if v_cnt > 0 then v_pl_reverted := v_pl_reverted + 1; end if;
  end loop;

  -- account_partners, part 2 — resurrect the rows the merge DELETED
  -- (would-be self-links and post-substitution duplicates). Snapshot rows
  -- keep their original ids and timestamps. Skips are links unrestorable
  -- by definition: an endpoint hard-deleted since, or the identical pair
  -- already present (`on conflict do nothing` covers both the unique
  -- pair and the id, so a duplicate can never be created). Any other
  -- error raises and rolls back the WHOLE undo — nothing partial. The
  -- snapshot key exists on JUNE-era rows too, so legacy merges gain
  -- restoration retroactively.
  for r in select * from jsonb_array_elements(coalesce(v_m.before_state->'partners_deleted','[]'::jsonb)) loop
    if (r->>'partner_account_id') is null
       or (r->>'member_account_id') is null
       or (r->>'partner_account_id') = (r->>'member_account_id')
       or not exists (select 1 from public.accounts a where a.id = (r->>'partner_account_id')::uuid)
       or not exists (select 1 from public.accounts a where a.id = (r->>'member_account_id')::uuid)
    then
      v_pl_skipped := v_pl_skipped + 1;
      continue;
    end if;
    insert into public.account_partners
      select * from jsonb_populate_record(null::public.account_partners, r)
    on conflict do nothing;
    get diagnostics v_cnt = row_count;
    if v_cnt > 0 then v_pl_restored := v_pl_restored + 1;
    else v_pl_skipped := v_pl_skipped + 1;
    end if;
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
                            'survivor_fields_restored', v_b is not null,
                            'partner_links_reverted', v_pl_reverted,
                            'partner_links_restored', v_pl_restored,
                            'partner_links_skipped', v_pl_skipped);
end;
$$;

grant execute on function public.undo_account_merge(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
