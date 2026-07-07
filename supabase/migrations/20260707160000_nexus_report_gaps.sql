-- ---------------------------------------------------------------------
-- Nexus report-builder gaps (Jordan M's doc, 2026-07-07): the DB pieces.
--
-- 1) v_accounts_with_activity — accounts + last-activity, for sorting
--    account reports by "longest without touch first" (Molly's Partner
--    Outreach widget). Mirrors v_opportunities_with_activity
--    (20260701000003): LEFT JOIN the aggregate view and expose
--    effective_last_touch = coalesce(last_activity_at, created_at) so the
--    sort value is never NULL and never-touched accounts sort by age
--    instead of clumping arbitrarily. security_invoker so caller RLS
--    applies. NOTE: a.* is snapshotted at CREATE — accounts columns added
--    later won't appear here until the view is recreated (the report
--    engine selects an explicit column list, so that's fine).
--
-- 2) list_account_types_in_use() — distinct accounts.account_type values
--    actually present, with counts. Powers the new exact-match "Account
--    Type" / "Org Type" report filters. The picklist only has 'Partner'
--    active today, but live SF-imported data carries CHC / FQHC / PCA /
--    Direct / Referral / etc. — Molly filters on THOSE, so the options
--    must come from the data (same approach as list_states_in_use).
--    SECURITY INVOKER: callers only see types from rows their RLS allows.
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_accounts_with_activity
with (security_invoker = on) as
select
  a.*,
  la.last_activity_at,
  coalesce(la.last_activity_at, a.created_at) as effective_last_touch
from public.accounts a
left join public.v_account_last_activity la on la.account_id = a.id;

comment on view public.v_accounts_with_activity is
  'accounts + last_activity_at (v_account_last_activity) + never-null effective_last_touch. Lets account reports server-side sort/filter by outreach recency across ALL rows (not a client-side page). Mirrors v_opportunities_with_activity.';

grant select on public.v_accounts_with_activity to authenticated;

create or replace function public.list_account_types_in_use()
returns table (account_type text, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select a.account_type, count(*)::bigint as n
    from public.accounts a
   where a.archived_at is null
     and nullif(btrim(a.account_type), '') is not null
   group by a.account_type
   order by n desc, a.account_type;
$$;

grant execute on function public.list_account_types_in_use() to authenticated;

commit;

notify pgrst, 'reload schema';
