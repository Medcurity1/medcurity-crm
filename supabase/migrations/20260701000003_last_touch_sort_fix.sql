-- ---------------------------------------------------------------------
-- Fix Summer's "Last Touch sorts in a weird way" (2026-07-01).
--
-- The Last Touch BADGE falls back to the deal's created_at when no
-- activity was ever logged ("⚠ 145 days"), but the SORT ordered by the
-- raw last_activity_at — NULL for those same deals — so never-touched
-- deals were dumped at the end in arbitrary order instead of sorting by
-- the age the badge shows. Sorting and display disagreed => "mixed".
--
-- Fix: expose effective_last_touch = coalesce(last_activity_at,
-- created_at) on the sort view and order by THAT, so what you see is
-- exactly what it sorts by. (CREATE OR REPLACE VIEW allows appending a
-- column at the end.)
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_opportunities_with_activity as
select
  o.*,
  la.last_activity_at,
  -- The value the Last Touch badge actually displays: the last real
  -- interaction, or the deal's age when nothing was ever logged.
  coalesce(la.last_activity_at, o.created_at) as effective_last_touch
from public.opportunities o
left join public.v_opportunity_last_activity la
  on la.opportunity_id = o.id;

alter view public.v_opportunities_with_activity set (security_invoker = on);

grant select on public.v_opportunities_with_activity to authenticated;

commit;

notify pgrst, 'reload schema';
