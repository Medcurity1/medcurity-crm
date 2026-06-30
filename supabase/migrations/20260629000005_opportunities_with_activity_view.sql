-- ---------------------------------------------------------------------
-- Sortable "Last Touch" on the Opportunities list (Summer's request).
--
-- last_activity_at lives in v_opportunity_last_activity, not on the opportunity
-- row, so the list can't ORDER BY it directly. This passthrough view exposes
-- every opportunity column PLUS last_activity_at, so the list query can sort by
-- it server-side (stalest deals across the WHOLE list, not just the page).
--
-- The list only switches to this view when the user sorts by Last Touch; all
-- other paths keep querying the opportunities table unchanged. security_invoker
-- so the caller's RLS on opportunities still applies.
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_opportunities_with_activity as
select
  o.*,
  la.last_activity_at
from public.opportunities o
left join public.v_opportunity_last_activity la
  on la.opportunity_id = o.id;

alter view public.v_opportunities_with_activity set (security_invoker = on);

grant select on public.v_opportunities_with_activity to authenticated;

commit;

notify pgrst, 'reload schema';
