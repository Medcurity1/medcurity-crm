-- ---------------------------------------------------------------------
-- Seed a "Requests" widget onto each routed reviewer's Nexus grid.
--
-- The requests reviewer boxes used to be a fixed section; they're now a
-- normal, draggable Nexus widget (widget_type='requests', repointed to the
-- routed inbox). Existing reviewers already have Nexus grids, so seed one
-- Requests widget for each person in request_routing who doesn't already
-- have one — so their inbox is there by default and they can move/remove
-- it like any widget. category='all' → every form they're routed for
-- (product → Rachel, collateral/CRM → Jordan, all three → Nathan).
--
-- Idempotent (skips anyone who already has a requests widget) and respects
-- the 8-widget cap (skips anyone already at the limit — they can add it
-- manually after removing one). New users pick it up via the normal
-- Add-a-Widget flow; this only backfills existing reviewers.
-- ---------------------------------------------------------------------

begin;

insert into public.nexus_widgets
  (user_id, position, widget_type, name, color, icon, preview_count, config)
select
  u.user_id,
  coalesce((select max(w.position) + 1 from public.nexus_widgets w where w.user_id = u.user_id), 0),
  'requests',
  'Requests',
  null,
  'bell',
  5,
  '{"category":"all"}'::jsonb
from (select distinct user_id from public.request_routing) u
where not exists (
    select 1 from public.nexus_widgets w2
     where w2.user_id = u.user_id and w2.widget_type = 'requests'
  )
  and (select count(*) from public.nexus_widgets w3 where w3.user_id = u.user_id) < 8;

commit;
