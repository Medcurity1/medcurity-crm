-- Storage stats: more accurate reporting so the Data Health card stops
-- contradicting Supabase Studio.
--
-- Why this exists:
--   The admin Data Health page was rendering "X MB / 500 MB" while
--   Supabase Studio showed the project at >200% capacity. Two things
--   were wrong:
--
--     1. The 500 MB constant is the FREE-tier Postgres cap. We're on a
--        paid plan now, so the denominator was simply wrong — making
--        the gauge look reasonable while reality was very different.
--
--     2. `pg_database_size(current_database())` only counts the Postgres
--        database (tables, indexes, sequences, TOAST). It does NOT
--        include Storage buckets, WAL files, or backups — all of which
--        Supabase counts toward "disk usage" in Studio. The big
--        consumer in our case is almost certainly `audit_logs` (every
--        row write captures full old/new JSON) and any file uploads in
--        Storage buckets.
--
-- What this migration does:
--   - Adds a per-schema size breakdown (public, auth, storage,
--     realtime, _supavisor, etc.) so we can see exactly which schema
--     is eating disk.
--   - Adds a `storage_objects_bytes` field that sums file sizes in
--     `storage.objects.metadata->>'size'` so the UI can show what
--     Storage is consuming.
--   - Returns the audit_logs table size separately — it's almost
--     always the biggest single table in a CRM and it's easy to
--     truncate-by-age if it gets out of hand.
--
-- IMPORTANT: this does NOT change any data and is safe to run any
-- time. It only rewrites a read-only RPC.

begin;

create or replace function public.get_database_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_audit_size_bytes bigint;
  v_storage_objects_bytes bigint;
begin
  -- Audit log table size (table + indexes + toast). Single biggest
  -- consumer in most CRM installs, so call it out explicitly.
  select pg_total_relation_size('public.audit_logs')
    into v_audit_size_bytes;

  -- Sum of Storage bucket bytes. Reads from storage.objects which
  -- stashes the file size in metadata.size. Wrapped in a coalesce so
  -- new projects with no uploads return 0 instead of null.
  begin
    select coalesce(
      sum(((metadata ->> 'size'))::bigint),
      0
    )
      into v_storage_objects_bytes
      from storage.objects;
  exception
    -- If the storage schema isn't readable (RLS or missing privilege),
    -- swallow the error and report 0 rather than failing the whole
    -- stats call.
    when others then
      v_storage_objects_bytes := 0;
  end;

  select jsonb_build_object(
    'total_rows', (
      select sum(n_live_tup)
      from pg_stat_user_tables
      where schemaname = 'public'
    ),
    'database_size', pg_size_pretty(pg_database_size(current_database())),
    'database_size_bytes', pg_database_size(current_database()),
    -- Per-schema breakdown so the UI can show where bytes are going.
    -- This is what makes the difference between "the public CRM data is
    -- tiny" vs "the audit_logs table is the elephant".
    'schema_sizes', (
      select jsonb_agg(jsonb_build_object(
        'schema', schema_name,
        'size_bytes', size_bytes,
        'size', pg_size_pretty(size_bytes)
      ) order by size_bytes desc)
      from (
        select
          n.nspname as schema_name,
          coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint as size_bytes
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'm', 'i', 't')
          and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
        group by n.nspname
        having coalesce(sum(pg_total_relation_size(c.oid)), 0) > 0
      ) s
    ),
    'audit_log_bytes', v_audit_size_bytes,
    'audit_log_size', pg_size_pretty(v_audit_size_bytes),
    'storage_objects_bytes', v_storage_objects_bytes,
    'storage_objects_size', pg_size_pretty(v_storage_objects_bytes),
    'largest_tables', (
      select jsonb_agg(jsonb_build_object(
        'table', relname,
        'rows', n_live_tup,
        'size', pg_size_pretty(pg_total_relation_size(relid)),
        'size_bytes', pg_total_relation_size(relid)
      ) order by pg_total_relation_size(relid) desc)
      from pg_stat_user_tables
      where schemaname = 'public'
      limit 10
    ),
    'audit_log_count', (select count(*) from public.audit_logs),
    'oldest_audit_log', (select min(changed_at) from public.audit_logs)
  ) into result;
  return result;
end;
$$;

grant execute on function public.get_database_stats() to authenticated;

commit;
