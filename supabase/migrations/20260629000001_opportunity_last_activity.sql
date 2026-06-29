-- ---------------------------------------------------------------------
-- Per-opportunity "last touch" view (Summer's "rotting / stale deals").
--
-- Mirrors v_account_last_activity (20260623000001): the most recent REAL
-- interaction on a deal — calls/emails/meetings dated by activity_date, plus
-- completed tasks by completed_at. Powers the color-coded "Last Touch" column
-- on the Opportunities list (green <7d, yellow <14d, orange <30d, red 30d+).
--
-- security_invoker = on so it runs under the caller's RLS on activities (a rep
-- only sees touches on deals they can see). Read-only; no data is changed.
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_opportunity_last_activity as
select
  a.opportunity_id,
  max(coalesce(a.completed_at, a.activity_date, a.created_at)) as last_activity_at
from public.activities a
where a.opportunity_id is not null
  and a.archived_at is null
  and (
    a.activity_type in ('call', 'email', 'meeting')  -- real interactions
    or a.completed_at is not null                      -- completed tasks
  )
group by a.opportunity_id;

alter view public.v_opportunity_last_activity set (security_invoker = on);

comment on view public.v_opportunity_last_activity is
  'Per-opportunity most-recent real interaction (calls/emails/meetings by activity_date + completed tasks by completed_at). Powers the Opportunities "Last Touch" / stale-deal column.';

grant select on public.v_opportunity_last_activity to authenticated;

-- Supporting index for the per-opportunity activity lookup.
create index if not exists idx_activities_opportunity_id
  on public.activities (opportunity_id)
  where opportunity_id is not null;

commit;
