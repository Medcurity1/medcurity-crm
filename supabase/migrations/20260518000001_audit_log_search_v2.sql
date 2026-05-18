-- Rev 2 of search_audit_logs.
--
-- Two real problems this addresses:
--
-- 1. Scope — clicking "View audit history" on an Account previously passed
--    the account UUID as record_id, which only matched direct edits to the
--    accounts row itself. Child activities/contacts/opps that *belong* to
--    the account never showed up (their record_id is the child's own UUID).
--    Reps reported "the filters aren't including activity logs". New
--    parameter `related_account_id` does the right thing: matches the
--    account itself OR any child row whose JSONB payload references it.
--
-- 2. Export timeout — the prior RPC always computed count(*) inside the
--    same CTE that also detoasts old_data + new_data jsonb for every
--    matched row. With 164k rows in the table and "All time" filters,
--    re-running this on every paginated export call blew the 8s statement
--    timeout. Now `include_count` and `include_data` let the export
--    pipeline skip the expensive parts when it doesn't need them.
--
-- Backwards-compat: old call sites that don't pass the new params get the
-- same behavior as before (count included, data included, no related-to
-- scoping).

begin;

-- Functional indexes so the related_account_id match doesn't seq-scan.
-- jsonb ->> returns text; cast to uuid in the predicate via the index too.
create index if not exists idx_audit_logs_new_account_id
  on public.audit_logs ((new_data->>'account_id'))
  where new_data ? 'account_id';

create index if not exists idx_audit_logs_old_account_id
  on public.audit_logs ((old_data->>'account_id'))
  where old_data ? 'account_id';

-- opportunity_products rows don't carry account_id in their JSONB, so we
-- need to resolve via opportunities. Index supports the subquery.
create index if not exists idx_audit_logs_op_products_opp
  on public.audit_logs ((new_data->>'opportunity_id'))
  where table_name = 'opportunity_products' and new_data ? 'opportunity_id';

drop function if exists public.search_audit_logs(
  text, text, text, uuid, timestamptz, int, int
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
  include_data boolean default true
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
language plpgsql
stable
security invoker
as $$
declare
  v_total bigint;
begin
  -- Compute count separately so the page query doesn't have to materialize
  -- a CTE just to feed count(*). Skipped entirely when caller opts out.
  if include_count then
    select count(*) into v_total
    from public.audit_logs al
    where
      (entity_filter is null or al.table_name = entity_filter)
      and (action_filter is null or al.action = action_filter)
      and (record_id_filter is null or al.record_id = record_id_filter)
      and (date_cutoff is null or al.changed_at >= date_cutoff)
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
    v_total as total_count
  from public.audit_logs al
  left join public.user_profiles up on up.id = al.changed_by
  where
    (entity_filter is null or al.table_name = entity_filter)
    and (action_filter is null or al.action = action_filter)
    and (record_id_filter is null or al.record_id = record_id_filter)
    and (date_cutoff is null or al.changed_at >= date_cutoff)
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
  text, text, text, uuid, timestamptz, int, int, uuid, boolean, boolean
) to authenticated;

commit;
