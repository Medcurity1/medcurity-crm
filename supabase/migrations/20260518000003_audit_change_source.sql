-- Audit log "Changed By" investigation follow-up.
--
-- Problem: most rows in audit_logs show changed_by = NULL, which the
-- viewer renders as "System". Root cause is that the audit trigger
-- captures `auth.uid()`, which returns NULL whenever the change comes
-- from something without a JWT — the SF migration importers
-- (scripts/migration/*.mjs run with the service-role key), the Outlook
-- and PandaDoc edge functions, the ClickUp sync, etc. None of those
-- are bugs; they're legitimately "not a user". But they're all
-- collapsed into a single opaque "System" label, which makes it look
-- like the audit log is broken when really we just lost the source
-- attribution.
--
-- Fix:
--
--   1. Add a `change_source` text column.
--   2. Trigger reads a session-scoped GUC (`app.change_source`) so
--      backend callers can label themselves. Migration scripts and
--      edge functions just `set local app.change_source = 'sf_import';`
--      at the top of their session and the trigger picks it up.
--   3. Extend search_audit_logs with `changed_by_filter` (single user)
--      and return the new column so the viewer can show
--      "Salesforce Import" / "Outlook Sync" / etc. instead of an
--      undifferentiated "System".
--
-- Backwards-compat: existing rows have NULL change_source and continue
-- to display as "System" in the UI. New rows from authenticated users
-- still get changed_by populated and change_source = null (the user IS
-- the source). Only service-role / backend writes pick up a non-null
-- change_source.

begin;

-- 1. Column
alter table public.audit_logs
  add column if not exists change_source text;

create index if not exists idx_audit_logs_changed_by
  on public.audit_logs (changed_by, changed_at desc)
  where changed_by is not null;

create index if not exists idx_audit_logs_change_source
  on public.audit_logs (change_source, changed_at desc)
  where change_source is not null;

-- 2. Trigger
create or replace function public.log_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  v_source text;
  v_role text;
begin
  target_id := coalesce(new.id, old.id);

  -- Resolve change source in priority order:
  --   1. Explicit `app.change_source` GUC set by the caller (an
  --      importer or edge function says `set local app.change_source
  --      = 'sf_import'` before doing work). This is the most precise.
  --   2. JWT role — anything coming in as `service_role` is a
  --      backend caller without an authenticated user. We fall back
  --      to labeling those rows 'service_role' so they no longer
  --      look like an undifferentiated "System". Individual callers
  --      can still override with a richer label via (1).
  --   3. NULL — authenticated user writes (changed_by carries the
  --      user identity instead).
  v_source := nullif(current_setting('app.change_source', true), '');

  if v_source is null then
    v_role := nullif(current_setting('request.jwt.claim.role', true), '');
    if v_role = 'service_role' then
      v_source := 'service_role';
    end if;
  end if;

  insert into public.audit_logs (
    table_name,
    record_id,
    action,
    changed_by,
    change_source,
    old_data,
    new_data
  )
  values (
    tg_table_name,
    target_id,
    tg_op,
    auth.uid(),
    v_source,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

-- 3. Rev 3 of search_audit_logs.
-- Adds `changed_by_filter` (single-user) + returns `change_source`.
-- Drops the old signature so PostgREST picks up the new one.
drop function if exists public.search_audit_logs(
  text, text, text, uuid, timestamptz, int, int, uuid, boolean, boolean
);

create or replace function public.search_audit_logs(
  search_term text default null,
  entity_filter text default null,
  action_filter text default null,
  record_id_filter uuid default null,
  date_cutoff timestamptz default null,
  page_offset int default 0,
  page_limit int default 25,
  related_account_id uuid default null,
  include_count boolean default true,
  include_data boolean default true,
  changed_by_filter uuid default null,
  source_filter text default null
)
returns table (
  id bigint,
  table_name text,
  record_id uuid,
  action text,
  changed_by uuid,
  changed_at timestamptz,
  old_data jsonb,
  new_data jsonb,
  changer_full_name text,
  change_source text,
  total_count bigint
)
language plpgsql
stable
security invoker
as $$
declare
  v_total bigint;
begin
  if include_count then
    select count(*) into v_total
    from public.audit_logs al
    where
      (entity_filter is null or al.table_name = entity_filter)
      and (action_filter is null or al.action = action_filter)
      and (record_id_filter is null or al.record_id = record_id_filter)
      and (date_cutoff is null or al.changed_at >= date_cutoff)
      and (
        changed_by_filter is null
        or al.changed_by = changed_by_filter
      )
      and (
        source_filter is null
        or (source_filter = '__system__'
            and al.changed_by is null
            and al.change_source is null)
        or al.change_source = source_filter
      )
      and (
        related_account_id is null
        or al.record_id = related_account_id
        or (
          al.table_name in ('activities','contacts','opportunities')
          and coalesce(
            al.new_data->>'account_id',
            al.old_data->>'account_id'
          ) = related_account_id::text
        )
        or (
          al.table_name = 'opportunity_products'
          and coalesce(
            al.new_data->>'opportunity_id',
            al.old_data->>'opportunity_id'
          )::uuid in (
            select o.id from public.opportunities o
            where o.account_id = related_account_id
          )
        )
      )
      and (
        search_term is null
        or search_term = ''
        or al.record_id::text ilike '%' || search_term || '%'
        or al.table_name ilike '%' || search_term || '%'
        or coalesce(al.change_source, '') ilike '%' || search_term || '%'
        or exists (
          select 1 from public.user_profiles up
          where up.id = al.changed_by
            and coalesce(up.full_name, '') ilike '%' || search_term || '%'
        )
        or coalesce(al.old_data::text, '') ilike '%' || search_term || '%'
        or coalesce(al.new_data::text, '') ilike '%' || search_term || '%'
      );
  end if;

  return query
  select
    al.id,
    al.table_name,
    al.record_id,
    al.action,
    al.changed_by,
    al.changed_at,
    case when include_data then al.old_data else null::jsonb end as old_data,
    case when include_data then al.new_data else null::jsonb end as new_data,
    up.full_name as changer_full_name,
    al.change_source,
    v_total as total_count
  from public.audit_logs al
  left join public.user_profiles up on up.id = al.changed_by
  where
    (entity_filter is null or al.table_name = entity_filter)
    and (action_filter is null or al.action = action_filter)
    and (record_id_filter is null or al.record_id = record_id_filter)
    and (date_cutoff is null or al.changed_at >= date_cutoff)
    and (
      changed_by_filter is null
      or al.changed_by = changed_by_filter
    )
    and (
      source_filter is null
      or (source_filter = '__system__'
          and al.changed_by is null
          and al.change_source is null)
      or al.change_source = source_filter
    )
    and (
      related_account_id is null
      or al.record_id = related_account_id
      or (
        al.table_name in ('activities','contacts','opportunities')
        and coalesce(
          al.new_data->>'account_id',
          al.old_data->>'account_id'
        ) = related_account_id::text
      )
      or (
        al.table_name = 'opportunity_products'
        and coalesce(
          al.new_data->>'opportunity_id',
          al.old_data->>'opportunity_id'
        )::uuid in (
          select o.id from public.opportunities o
          where o.account_id = related_account_id
        )
      )
    )
    and (
      search_term is null
      or search_term = ''
      or al.record_id::text ilike '%' || search_term || '%'
      or al.table_name ilike '%' || search_term || '%'
      or coalesce(al.change_source, '') ilike '%' || search_term || '%'
      or coalesce(up.full_name, '') ilike '%' || search_term || '%'
      or coalesce(al.old_data::text, '') ilike '%' || search_term || '%'
      or coalesce(al.new_data::text, '') ilike '%' || search_term || '%'
    )
  order by al.changed_at desc
  offset page_offset
  limit page_limit;
end;
$$;

grant execute on function public.search_audit_logs(
  text, text, text, uuid, timestamptz, int, int, uuid, boolean, boolean, uuid, text
) to authenticated;

-- 4. Companion RPC: list distinct (user, source) tuples that actually
--    appear in audit_logs, so the viewer's "Changed By" filter dropdown
--    only shows entries that will yield results. Returning users via
--    a separate RPC (rather than a plain user_profiles select) keeps
--    the dropdown scoped to people who have actually touched data —
--    deactivated accounts with audit history still show up, brand-new
--    users with no edits don't pollute the list.
create or replace function public.audit_log_changers()
returns table (
  changed_by uuid,
  full_name text,
  is_system boolean,
  change_source text,
  entry_count bigint
)
language sql
stable
security invoker
as $$
  with combined as (
    -- Real users (have a changed_by)
    select
      al.changed_by,
      coalesce(up.full_name, '(unknown user)') as full_name,
      false as is_system,
      null::text as change_source,
      count(*) as entry_count
    from public.audit_logs al
    left join public.user_profiles up on up.id = al.changed_by
    where al.changed_by is not null
    group by al.changed_by, up.full_name

    union all

    -- Distinct system sources (edge functions / importers that stamp
    -- app.change_source).
    select
      null::uuid as changed_by,
      al.change_source as full_name,
      true as is_system,
      al.change_source,
      count(*) as entry_count
    from public.audit_logs al
    where al.changed_by is null and al.change_source is not null
    group by al.change_source

    union all

    -- Catch-all "System (unlabeled)" bucket for legacy NULL+NULL rows.
    select
      null::uuid as changed_by,
      'System (unlabeled)' as full_name,
      true as is_system,
      '__system__'::text as change_source,
      count(*) as entry_count
    from public.audit_logs al
    where al.changed_by is null and al.change_source is null
    group by 1, 2, 3, 4
    having count(*) > 0
  )
  select * from combined order by full_name nulls last;
$$;

grant execute on function public.audit_log_changers() to authenticated;

commit;
