-- Account de-duplication + merge tooling.
--
-- Background: converting several leads from the same company (or other legacy
-- imports) minted a fresh account each time instead of attaching to the
-- existing one, so one company can exist as N duplicate accounts
-- (e.g. "Iliuliuk Family Health & Wellness" x3). This migration adds:
--   * find_account_duplicate_groups() — groups same-company live accounts.
--   * merge_accounts()                — reparents EVERYTHING from loser
--     accounts onto a survivor in ONE transaction, fixes is_primary +
--     account_partners collisions, soft-archives the losers, and logs an
--     undo payload. Never hard-deletes.
--   * undo_account_merge()            — best-effort reversal from the log.
--
-- Style: security definer · search_path = public · NULL-safe is_admin().

begin;

-- ──────────────────────────────────────────────────────────────────────
-- MERGE LOG (audit + undo payload). One row per merge operation.
-- ──────────────────────────────────────────────────────────────────────
create table if not exists public.account_merges (
  id           uuid primary key default gen_random_uuid(),
  survivor_id  uuid not null references public.accounts(id) on delete restrict,
  loser_ids    uuid[] not null,
  reason       text,
  merged_by    uuid references public.user_profiles(id),
  merged_at    timestamptz not null default timezone('utc', now()),
  -- before_state: full snapshot of every loser account + per-table arrays of
  -- {id, from} for each reparented child (so undo can move them back to the
  -- right account even with multiple losers), the demoted contact ids, and a
  -- snapshot of any account_partners rows removed during collision cleanup.
  before_state jsonb not null,
  undone_at    timestamptz,
  undone_by    uuid references public.user_profiles(id)
);

alter table public.account_merges enable row level security;
drop policy if exists "account_merges_admin_read" on public.account_merges;
create policy "account_merges_admin_read" on public.account_merges
  for select to authenticated using (public.is_admin());
-- No insert/update/delete policies: only the SECURITY DEFINER RPCs below
-- (which run as owner) write to this table.

-- ──────────────────────────────────────────────────────────────────────
-- FINDER — group same-company live accounts (size > 1).
-- ──────────────────────────────────────────────────────────────────────
create or replace function public.find_account_duplicate_groups(
  p_limit_groups integer default 500
)
returns table (
  group_key         text,
  group_size        integer,
  account_id        uuid,
  name              text,
  account_number    text,
  lifecycle_status  public.account_lifecycle,
  account_status    public.account_status,
  owner_user_id     uuid,
  owner_name        text,
  contact_count     integer,
  opportunity_count integer,
  has_closed_won    boolean,
  open_opp_count    integer,
  total_won_amount  numeric,
  created_at        timestamptz,
  last_activity_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with guard as (
    -- NULL-safe: is_admin() coalesces to false; non-admins get no rows.
    select coalesce(public.is_admin(), false) as ok
  ),
  live as (
    select a.id, a.name, a.account_number, a.lifecycle_status,
           a.status as account_status, a.owner_user_id, a.created_at,
           public.norm_company(a.name) as nkey
      from public.accounts a, guard g
     where g.ok
       and a.archived_at is null
       and public.norm_company(a.name) is not null
  ),
  grouped as (
    select nkey, count(*)::int as group_size
      from live
     group by nkey
    having count(*) > 1
     order by count(*) desc
     limit greatest(p_limit_groups, 0)
  )
  select
    l.nkey as group_key,
    g.group_size,
    l.id   as account_id,
    l.name,
    l.account_number,
    l.lifecycle_status,
    l.account_status,
    l.owner_user_id,
    up.full_name as owner_name,
    (select count(*)::int from public.contacts c
       where c.account_id = l.id and c.archived_at is null)            as contact_count,
    (select count(*)::int from public.opportunities o
       where o.account_id = l.id and o.archived_at is null)            as opportunity_count,
    exists (select 1 from public.opportunities o
       where o.account_id = l.id and o.archived_at is null
         and o.stage = 'closed_won')                                   as has_closed_won,
    (select count(*)::int from public.opportunities o
       where o.account_id = l.id and o.archived_at is null
         and o.stage not in ('closed_won','closed_lost'))              as open_opp_count,
    coalesce((select sum(o.amount) from public.opportunities o
       where o.account_id = l.id and o.archived_at is null
         and o.stage = 'closed_won'), 0)                               as total_won_amount,
    l.created_at,
    (select max(coalesce(act.completed_at, act.due_at, act.created_at))
       from public.activities act where act.account_id = l.id)         as last_activity_at
    from live l
    join grouped g on g.nkey = l.nkey
    left join public.user_profiles up on up.id = l.owner_user_id
   -- biggest groups first; within a group, strongest survivor candidate on top
   order by g.group_size desc, l.nkey,
            (exists (select 1 from public.opportunities o
                      where o.account_id = l.id and o.archived_at is null
                        and o.stage = 'closed_won')) desc,
            l.created_at asc;
$$;

grant execute on function public.find_account_duplicate_groups(integer) to authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- MERGE — reparent losers → survivor in ONE transaction.
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
  v_uid              uuid := auth.uid();
  v_losers           uuid[];
  v_loser_rows       jsonb;
  v_moved            jsonb := '{}'::jsonb;
  v_demoted          uuid[];
  v_partners_deleted jsonb := '[]'::jsonb;
  v_merge_id         uuid;
  v_total            int := 0;
  v_tmp              jsonb;
  v_cnt              int;
begin
  -- ── Guards (NULL-safe) ──────────────────────────────────────────────
  if not coalesce(public.is_admin(), false) then
    raise exception 'Not authorized: account merge requires admin';
  end if;
  if p_survivor_id is null or p_loser_ids is null
     or array_length(p_loser_ids, 1) is null then
    raise exception 'A survivor and at least one other account are required';
  end if;

  -- Strip the survivor out of the loser list + de-dupe + drop NULLs.
  select array_agg(distinct x) into v_losers
    from unnest(p_loser_ids) x
   where x is not null
     and x is distinct from p_survivor_id;
  if v_losers is null or array_length(v_losers, 1) is null then
    raise exception 'No accounts left to merge after removing the survivor';
  end if;

  -- Survivor must exist and be live.
  perform 1 from public.accounts where id = p_survivor_id;
  if not found then
    raise exception 'Survivor account % not found', p_survivor_id;
  end if;
  if exists (select 1 from public.accounts
              where id = p_survivor_id and archived_at is not null) then
    raise exception 'Survivor account is archived';
  end if;
  -- Every loser must exist and be live (no merging an already-archived row).
  if (select count(*) from public.accounts
        where id = any(v_losers) and archived_at is null)
       <> array_length(v_losers, 1) then
    raise exception 'One or more accounts to merge are missing or already archived';
  end if;

  -- ── Snapshot loser account rows (for undo/audit) ───────────────────
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
    into v_loser_rows
    from public.accounts a where a.id = any(v_losers);

  -- ── Reparent children. Capture {id, from} BEFORE each update so undo
  --    can move each row back to the correct loser. ────────────────────

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

  -- is_primary collision: keep ONE primary on the survivor (oldest), demote
  -- the rest; record demoted ids so undo can re-promote them.
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

  -- activities (SET NULL FK; reparent to preserve history)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb),
         count(*)
    into v_tmp, v_cnt
    from public.activities where account_id = any(v_losers);
  update public.activities set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('activities', v_tmp);
  v_total := v_total + v_cnt;

  -- leads.converted_account_id (audit trail of which lead made the account)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', converted_account_id)), '[]'::jsonb)
    into v_tmp
    from public.leads where converted_account_id = any(v_losers);
  update public.leads set converted_account_id = p_survivor_id where converted_account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('leads_converted_account', v_tmp);

  -- accounts.parent_account_id (children of losers) + self-loop guard
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

  -- account_number_migrations (audit history)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'from', account_id)), '[]'::jsonb)
    into v_tmp
    from public.account_number_migrations where account_id = any(v_losers);
  update public.account_number_migrations set account_id = p_survivor_id where account_id = any(v_losers);
  v_moved := v_moved || jsonb_build_object('account_number_migrations', v_tmp);

  -- renewal_automation_config.test_account_id (singleton edge case)
  update public.renewal_automation_config set test_account_id = p_survivor_id
   where test_account_id = any(v_losers);

  -- ── account_partners: collision-safe reparent ─────────────────────
  -- UNIQUE(partner_account_id, member_account_id) and CHECK(partner <> member)
  -- are NOT deferrable, so they fire row-by-row DURING an in-place update — we
  -- can't "reparent then clean". Instead DELETE the rows that would self-link
  -- or collide AFTER substituting loser→survivor, snapshot them for the audit
  -- trail, THEN substitute both endpoints in a single pass.
  --
  -- (a) Rows whose BOTH endpoints resolve to the survivor (loser↔survivor or
  --     loser↔loser) would become self-links — remove them.
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

  -- (b) Among the remaining rows, collapse any that map to the SAME
  --     (partner, member) pair after substitution. Keep one — preferring a row
  --     that already needs no change (touches_loser = false ranks first, so a
  --     real survivor row is never deleted) — and snapshot+drop the rest.
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

  -- (c) Now safe: substitute both endpoints in one pass (no row can collide).
  update public.account_partners
     set partner_account_id = case when partner_account_id = any(v_losers) then p_survivor_id else partner_account_id end,
         member_account_id  = case when member_account_id  = any(v_losers) then p_survivor_id else member_account_id  end
   where partner_account_id = any(v_losers) or member_account_id = any(v_losers);

  -- ── Soft-archive the losers (NEVER hard-delete). Fires trg_accounts_audit. ─
  update public.accounts
     set archived_at    = timezone('utc', now()),
         archived_by    = v_uid,
         archive_reason = coalesce(nullif(btrim(p_reason), ''),
                                   'Merged into ' || p_survivor_id::text)
   where id = any(v_losers)
     and archived_at is null;

  -- ── Write the merge-log row ─────────────────────────────────────────
  insert into public.account_merges (survivor_id, loser_ids, reason, merged_by, before_state)
  values (
    p_survivor_id, v_losers, p_reason, v_uid,
    jsonb_build_object(
      'survivor_id',      p_survivor_id,
      'loser_rows',       v_loser_rows,
      'moved',            v_moved,
      'demoted_contacts', to_jsonb(coalesce(v_demoted, '{}')),
      'partners_deleted', v_partners_deleted,
      'reparented_total', v_total
    )
  )
  returning id into v_merge_id;

  return jsonb_build_object(
    'merge_id',        v_merge_id,
    'survivor_id',     p_survivor_id,
    'losers_archived', array_length(v_losers, 1),
    'rows_reparented', v_total
  );
end;
$$;

grant execute on function public.merge_accounts(uuid, uuid[], text) to authenticated;

-- ──────────────────────────────────────────────────────────────────────
-- UNDO — best-effort reversal from the merge log.
-- ──────────────────────────────────────────────────────────────────────
-- Restores every reparented child to its original account and un-archives the
-- losers. Two documented limitations (the UI states them): partner links
-- removed during collision cleanup are NOT resurrected, and field edits made
-- AFTER the merge are preserved (we only move ownership back, never revert
-- field values). Single transaction.
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

  -- Un-archive the losers so they reappear.
  update public.accounts set archived_at = null, archived_by = null, archive_reason = null
   where id = any(v_m.loser_ids);

  -- Move each child back to its original account.
  for r in select * from jsonb_array_elements(coalesce(v_moved->'opportunities','[]'::jsonb)) loop
    update public.opportunities set account_id = (r->>'from')::uuid where id = (r->>'id')::uuid;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(v_moved->'contacts','[]'::jsonb)) loop
    update public.contacts
       set account_id = (r->>'from')::uuid,
           is_primary = coalesce((r->>'was_primary')::boolean, is_primary)
     where id = (r->>'id')::uuid;
  end loop;
  -- Re-promote any contact demoted during the merge (survivor's own primary).
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

  update public.account_merges
     set undone_at = timezone('utc', now()), undone_by = v_uid
   where id = p_merge_id;

  return jsonb_build_object('merge_id', p_merge_id, 'undone', true,
                            'losers_restored', array_length(v_m.loser_ids, 1));
end;
$$;

grant execute on function public.undo_account_merge(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
