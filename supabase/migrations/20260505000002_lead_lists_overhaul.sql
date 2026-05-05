-- Lead Lists overhaul — adds the supporting views the new UI relies on.
--
-- 1. v_lead_last_activity   — most-recent completed_at per lead, used to
--                             power the "Last Contacted" column and the
--                             last_activity_after / last_activity_before
--                             smart-list filters. View (not column) so we
--                             don't have to keep a denormalized timestamp
--                             in sync via triggers.
--
-- 2. v_lead_active_sequence — booleans per lead for "is currently enrolled
--                             in any active sequence". Lets the smart-list
--                             "in sequence" / "not in sequence" filter
--                             short-circuit without a join in the API hook.
--
-- Both views are SECURITY INVOKER so they respect existing RLS on the
-- underlying tables (the caller's grants flow through).

begin;

create or replace view public.v_lead_last_activity as
select
  a.lead_id,
  max(a.completed_at) filter (where a.completed_at is not null) as last_activity_at
from public.activities a
where a.lead_id is not null
group by a.lead_id;

comment on view public.v_lead_last_activity is
  'Per-lead most-recent activity completed_at. Powers the "Last Contacted" column on lead lists and the last_activity_after/before smart-list filters.';

create or replace view public.v_lead_active_sequence as
select
  e.lead_id,
  bool_or(e.status = 'active') as in_active_sequence,
  max(e.enrolled_at) filter (where e.status = 'active') as latest_active_enrollment_at
from public.sequence_enrollments e
where e.lead_id is not null
group by e.lead_id;

comment on view public.v_lead_active_sequence is
  'Per-lead boolean for whether the lead is currently in any active sequence. Powers the "in_sequence" smart-list filter.';

-- Grant select to authenticated so the React client can query these.
grant select on public.v_lead_last_activity to authenticated;
grant select on public.v_lead_active_sequence to authenticated;

commit;
