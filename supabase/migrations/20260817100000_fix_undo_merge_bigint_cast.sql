-- ============================================================
-- FIX (survey T4, 2026-08-17): undo_account_merge aborted whole when the
-- merge had moved account_number_migrations rows.
--
-- That table's PK is BIGSERIAL (20260514000006), but the undo loop cast
-- `(r->>'id')::uuid` — `operator does not exist: bigint = uuid` — and
-- because undo is one plpgsql transaction, the ENTIRE restore rolled
-- back. Every other table in the loop has a uuid PK, which is how the
-- copy-paste survived review. Affects merges touching any account whose
-- short number was reassigned by the 20260514 backfill.
--
-- This re-emits undo_account_merge from 20260812000002 with the ONE
-- cast corrected (`::bigint`); everything else is byte-identical.
-- _merge_accounts_core is unchanged and not re-emitted.
-- ============================================================

begin;

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

  -- THE FIX: this table's PK is bigserial, not uuid.
  for r in select * from jsonb_array_elements(coalesce(v_moved->'account_number_migrations','[]'::jsonb)) loop
    update public.account_number_migrations set account_id = (r->>'from')::uuid where id = (r->>'id')::bigint;
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
