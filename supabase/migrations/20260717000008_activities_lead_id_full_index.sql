-- ---------------------------------------------------------------------
-- Promote throughput, part 2 (staging perf test of Jordan's-list sizing:
-- one 150-lead promote chunk took ~20s). carry_lead_activities_to_contact
-- fires per promoted lead with `update activities ... where lead_id = X`
-- and NO archived_at filter — but idx_activities_lead is partial on
-- archived_at IS NULL, so the trigger seq-scans activities per lead.
-- Add an unfiltered lead_id index for the trigger's exact shape.
-- ---------------------------------------------------------------------

begin;

create index if not exists idx_activities_lead_all
  on public.activities (lead_id)
  where lead_id is not null;

commit;
