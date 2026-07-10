-- ---------------------------------------------------------------------
-- list_timezones_in_use(): distinct non-null accounts.timezone values
-- actually present in the data, with a per-value row count.
--
-- Powers the Nexus custom-report "Time Zone" filter options (contacts +
-- accounts entities). Data-driven (not the app's UsTimeZone constant
-- list) because accounts.timezone holds free-text SF-imported strings
-- ("US/Eastern", "Central- (CDT)", ...) that enum values would never
-- match. Replaces useTimezonesInUse's client-side page-the-whole-table
-- dedupe (src/features/nexus/api.ts) with one server-side DISTINCT —
-- same pattern as list_states_in_use / list_account_types_in_use
-- (migration 20260707130000).
--
-- SECURITY INVOKER: runs under the caller's RLS, so a user only sees
-- timezones from records they're allowed to read. Non-archived only.
-- ---------------------------------------------------------------------

begin;

create or replace function public.list_timezones_in_use()
returns table (timezone text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select btrim(a.timezone) as timezone, count(*)::bigint as n
    from public.accounts a
   where a.archived_at is null
     and nullif(btrim(a.timezone), '') is not null
   group by btrim(a.timezone)
   order by 1;
$$;

grant execute on function public.list_timezones_in_use() to authenticated;

commit;

notify pgrst, 'reload schema';
