-- Recent Wins on every Nexus page (Nathan, 2026-08-04, launch prep).
--
-- The wins widget carries the high-five feature over from Home, and the
-- swap must not lose it for anyone. "Easier to clean up than add what
-- they might not know exists": seed it everywhere; a user who does not
-- want it removes it in Customize.
--
-- Two halves, both idempotent:
--  1. The system default layout (new users get it via nexus_initialize).
--  2. Every already-initialized user who lacks one and has grid room.

-- 1. Default layout: add Recent Wins if the layout has no wins widget.
--    (FROM-less select: an aggregate query would always emit one row and
--    ignore the guard.)
insert into public.nexus_default_widgets
  (position, widget_type, name, color, icon, preview_count, config)
select (select coalesce(max(dw.position), -1) + 1 from public.nexus_default_widgets dw),
       'wins', 'Recent Wins', 'green', 'chart', 5, '{}'::jsonb
 where not exists (
   select 1 from public.nexus_default_widgets w where w.widget_type = 'wins'
 );

-- 2. Initialized users (nexus_user_state row) without a wins widget.
--    Respect the 8-widget cap: skip full grids rather than erroring on
--    the cap trigger. Position lands after their last widget.
insert into public.nexus_widgets
  (user_id, position, widget_type, name, color, icon, preview_count, config)
select s.user_id,
       coalesce((select max(w.position) from public.nexus_widgets w where w.user_id = s.user_id), -1) + 1,
       'wins', 'Recent Wins', 'green', 'chart', 5, '{}'::jsonb
  from public.nexus_user_state s
 where not exists (
         select 1 from public.nexus_widgets w
          where w.user_id = s.user_id and w.widget_type = 'wins'
       )
   and (select count(*) from public.nexus_widgets w where w.user_id = s.user_id) < 8;
