-- Audit log: support a custom date range (not just "last N days").
--
-- The viewer previously only had preset windows (24h / 7d / 30d /
-- all). On a 164k-row audit table that's not enough — a user looking
-- for "what did I change last Tuesday afternoon" had to either
-- paginate through 30 days or accept "all time" and scroll. This
-- migration adds an upper-bound parameter so the UI can pass an
-- explicit From/To window.
--
-- Old: date_cutoff acts as ">= cutoff" (lower bound only)
-- New: date_cutoff is still the lower bound; date_until is the
--      optional upper bound. Either can be null for an open-ended
--      side.
--
-- Function signature is changing so we have to drop + recreate.
-- Wrapped in a single transaction; viewer is unaffected during the
-- swap.

begin;

drop function if exists public.search_audit_logs(
  text, text, text, uuid, timestamptz, int, int, uuid, boolean, boolean, uuid, text
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
  source_filter text default null,
  date_until timestamptz default null
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
      and (date_until is null or al.changed_at < date_until)
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
    and (date_until is null or al.changed_at < date_until)
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
  text, text, text, uuid, timestamptz, int, int, uuid, boolean, boolean, uuid, text, timestamptz
) to authenticated;

notify pgrst, 'reload schema';

commit;
