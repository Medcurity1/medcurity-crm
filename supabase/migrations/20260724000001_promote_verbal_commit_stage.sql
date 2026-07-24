-- Promote 'verbal_commit' to a live pipeline stage (Summer via Nathan, 2026-07-24).
-- It sits between Proposal Conversation (90%) and Closed Won (100%).
-- No enum DDL needed: the value already exists in public.opportunity_stage
-- (original 2026-03 enum, retired in 20260422000001, un-retired here).
-- 'lead', 'qualified', and 'proposal' remain retired: valid for historical
-- rows, never offered in the UI, never rendered as board columns.

create or replace function public.default_probability_for_stage(
  s public.opportunity_stage
)
returns integer
language sql
immutable
as $$
  select case s
    when 'details_analysis'         then 40
    when 'demo'                     then 60
    when 'proposal_and_price_quote' then 75
    when 'proposal_conversation'    then 90
    when 'verbal_commit'            then 95
    when 'closed_won'               then 100
    when 'closed_lost'              then 0
    -- Retired values kept in enum for history-row safety; map to best match
    -- so reports don't break if any stray row still uses them.
    when 'qualified'                then 40
    when 'proposal'                 then 90
    when 'lead'                     then 40
  end;
$$;

comment on type public.opportunity_stage is
  'Opportunity stage. Live values: details_analysis (40%), demo (60%), proposal_and_price_quote (75%), proposal_conversation (90%), verbal_commit (95%), closed_won (100%), closed_lost (0%). Retired values (lead, qualified, proposal) are retained in the enum for history-row safety but no longer surface in the UI.';
