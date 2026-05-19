-- audit_log_changers: accept the same filter params as search_audit_logs.
--
-- Why: in the audit viewer the "Changed By" dropdown shows entry counts
-- next to each user/source ("Brayden Frost (151,949)"). Those counts
-- previously came from an unfiltered aggregate, so they kept showing
-- the lifetime total even when the user had narrowed the view by
-- entity/action/date. That makes the dropdown confusing — pick "Last
-- 30 days" and Brayden still shows 151,949 instead of however-many
-- edits actually fall in the window.
--
-- Fix: take the filter params and apply them to the same aggregate
-- scan. Still one scan over audit_logs; the partial indexes from
-- 20260518000003 + the (changed_at desc) coverage from the regular
-- audit_logs index keep this fast.
--
-- IMPORTANT: we deliberately DO NOT take `changed_by_filter` or
-- `source_filter` from the caller. Those are the dropdown's own
-- selection — if we filtered the count query by the selected user,
-- every option would show its own total again and the rest would
-- show 0, which is useless. The dropdown shows everyone matching the
-- OTHER filters.
--
-- Function signature changes, so drop + recreate. security definer
-- preserved from the perf rewrite.

begin;

drop function if exists public.audit_log_changers();

create or replace function public.audit_log_changers(
  entity_filter text default null,
  action_filter text default null,
  date_cutoff timestamptz default null,
  date_until timestamptz default null,
  record_id_filter uuid default null,
  related_account_id uuid default null,
  search_term text default null
)
returns table (
  changed_by uuid,
  full_name text,
  is_system boolean,
  change_source text,
  entry_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with buckets as (
    -- Single scan: group all rows matching the active filters by
    -- (user, source). Same `where` clause structure as
    -- search_audit_logs so counts and results stay in sync.
    select
      al.changed_by,
      al.change_source,
      count(*) as n
    from public.audit_logs al
    where
      (entity_filter is null or al.table_name = entity_filter)
      and (action_filter is null or al.action = action_filter)
      and (record_id_filter is null or al.record_id = record_id_filter)
      and (date_cutoff is null or al.changed_at >= date_cutoff)
      and (date_until is null or al.changed_at < date_until)
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
        or coalesce(al.old_data::text, '') ilike '%' || search_term || '%'
        or coalesce(al.new_data::text, '') ilike '%' || search_term || '%'
      )
    group by al.changed_by, al.change_source
  )
  -- Real users
  select
    b.changed_by,
    coalesce(up.full_name, '(unknown user)') as full_name,
    false as is_system,
    null::text as change_source,
    sum(b.n) as entry_count
  from buckets b
  left join public.user_profiles up on up.id = b.changed_by
  where b.changed_by is not null
  group by b.changed_by, up.full_name

  union all

  -- Labeled system sources
  select
    null::uuid,
    b.change_source,
    true,
    b.change_source,
    sum(b.n)
  from buckets b
  where b.changed_by is null and b.change_source is not null
  group by b.change_source

  union all

  -- Unlabeled legacy bucket
  select
    null::uuid,
    'System (unlabeled)'::text,
    true,
    '__system__'::text,
    sum(b.n)
  from buckets b
  where b.changed_by is null and b.change_source is null
  having sum(b.n) > 0

  order by 2 nulls last;
$$;

grant execute on function public.audit_log_changers(
  text, text, timestamptz, timestamptz, uuid, uuid, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
