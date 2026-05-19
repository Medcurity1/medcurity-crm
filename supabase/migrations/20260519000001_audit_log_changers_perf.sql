-- audit_log_changers performance fix.
--
-- The v1 function (added in 20260518000003) timed out on staging at
-- ~8s because it scanned public.audit_logs THREE times — once per
-- branch of the `union all` (users / system-with-source / unlabeled).
-- At 164k rows each scan is ~2-3s and we trip the authenticated-role
-- statement_timeout.
--
-- Fix: one aggregate scan, then split the small grouped result into
-- the three display buckets. Also switches to security definer so the
-- user_profiles join isn't filtered by RLS (the function only returns
-- counts + display names, no PII beyond what the audit viewer already
-- shows).
--
-- Safe to re-run; only replaces the function body.

begin;

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
security definer
set search_path = public
as $$
  with buckets as (
    -- Single scan: group all audit rows by (user, source).
    -- Postgres can use the partial indexes from 20260518000003 to
    -- accelerate this on most of the rows.
    select
      al.changed_by,
      al.change_source,
      count(*) as n
    from public.audit_logs al
    group by al.changed_by, al.change_source
  )
  -- Real users (sum across any sources they may have used)
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

  -- Labeled system sources (sf_import, outlook_sync, service_role, etc.)
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

  -- Unlabeled "System" bucket — null user AND null source. Catch-all
  -- for legacy rows written before the change_source column existed.
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

grant execute on function public.audit_log_changers() to authenticated;

-- Tell PostgREST to pick up the new function body immediately so the
-- dropdown stops hammering the timed-out version.
notify pgrst, 'reload schema';

commit;
