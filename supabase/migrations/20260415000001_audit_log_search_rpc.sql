-- Audit log search RPC — supports free-text across record_id, table_name,
-- changer full_name, and the JSONB old/new data. Admin-only via the existing
-- RLS on audit_logs (security invoker).

create or replace function public.search_audit_logs(
  search_term text default null,
  entity_filter text default null,
  action_filter text default null,
  record_id_filter uuid default null,
  date_cutoff timestamptz default null,
  page_offset int default 0,
  page_limit int default 25
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
  total_count bigint
)
language sql
stable
security invoker
as $$
  with filtered as (
    select
      al.id,
      al.table_name,
      al.record_id,
      al.action,
      al.changed_by,
      al.changed_at,
      al.old_data,
      al.new_data,
      up.full_name as changer_full_name
    from public.audit_logs al
    left join public.user_profiles up on up.id = al.changed_by
    where
      (entity_filter is null or al.table_name = entity_filter)
      and (action_filter is null or al.action = action_filter)
      and (record_id_filter is null or al.record_id = record_id_filter)
      and (date_cutoff is null or al.changed_at >= date_cutoff)
      and (
        search_term is null
        or search_term = ''
        or al.record_id::text ilike '%' || search_term || '%'
        or al.table_name ilike '%' || search_term || '%'
        or coalesce(up.full_name, '') ilike '%' || search_term || '%'
        or coalesce(al.old_data::text, '') ilike '%' || search_term || '%'
        or coalesce(al.new_data::text, '') ilike '%' || search_term || '%'
      )
  ),
  total as (select count(*) as c from filtered)
  select f.*, (select c from total)
  from filtered f
  order by f.changed_at desc
  offset page_offset
  limit page_limit;
$$;

grant execute on function public.search_audit_logs(
  text, text, text, uuid, timestamptz, int, int
) to authenticated;

-- Indexes to make this fast on larger logs
create index if not exists idx_audit_logs_record_id on public.audit_logs (record_id);
create index if not exists idx_audit_logs_changed_at_desc on public.audit_logs (changed_at desc);
create index if not exists idx_audit_logs_table_name on public.audit_logs (table_name);
