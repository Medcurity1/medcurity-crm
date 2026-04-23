-- ============================================================
-- Opportunity stages: match Salesforce exactly (per 2026-04-22
-- request)
-- ----------------------------------------------------------------
-- SF stages + probabilities we're matching:
--   Details Analysis          40%
--   Demo                      60%
--   Proposal and Price Quote  75%
--   Proposal Conversation     90%
--   Closed Won               100%
--   Closed Lost                0%
--
-- Current enum has: lead / qualified / proposal / verbal_commit /
--                    closed_won / closed_lost
--
-- Approach: ADD the 4 missing SF values to the enum, migrate
-- existing data onto them, then update the default_probability_for_stage
-- function. Old values (lead, qualified, proposal, verbal_commit)
-- stay in the enum so existing foreign keys / history rows don't
-- break. The UI will only surface the SF values going forward.
--
-- A post-cutover migration can fully drop the legacy values via
-- type swap once no data references them.
-- ============================================================

-- Step 1: Add new enum values. ALTER TYPE ADD VALUE can't be used
-- in a transaction that also uses the new value, so we commit after
-- adding — PG 12+ relaxed this but Supabase's migration runner
-- still benefits from being explicit.
alter type public.opportunity_stage add value if not exists 'details_analysis';
alter type public.opportunity_stage add value if not exists 'demo';
alter type public.opportunity_stage add value if not exists 'proposal_and_price_quote';
alter type public.opportunity_stage add value if not exists 'proposal_conversation';

commit;

begin;

-- Step 2: Migrate existing data to the SF-matching values.
--   qualified      → details_analysis  (SF's early-pipeline bucket)
--   proposal       → proposal_conversation  (SF's main "active proposal"
--                    state — 100 of 125 SF records were this one)
--   verbal_commit  → proposal_conversation  (not an SF stage; collapse)
--   lead           → details_analysis  (not an SF stage; collapse)
update public.opportunities
set stage = 'details_analysis'
where stage = 'qualified';

update public.opportunities
set stage = 'proposal_conversation'
where stage = 'proposal';

update public.opportunities
set stage = 'proposal_conversation'
where stage = 'verbal_commit';

update public.opportunities
set stage = 'details_analysis'
where stage = 'lead';

-- Also map stage history so audit trail keeps the right label.
update public.opportunity_stage_history
set from_stage = 'details_analysis'
where from_stage = 'qualified';

update public.opportunity_stage_history
set from_stage = 'proposal_conversation'
where from_stage in ('proposal', 'verbal_commit');

update public.opportunity_stage_history
set from_stage = 'details_analysis'
where from_stage = 'lead';

update public.opportunity_stage_history
set to_stage = 'details_analysis'
where to_stage = 'qualified';

update public.opportunity_stage_history
set to_stage = 'proposal_conversation'
where to_stage in ('proposal', 'verbal_commit');

update public.opportunity_stage_history
set to_stage = 'details_analysis'
where to_stage = 'lead';

-- Step 3: Update the probability-auto-assignment function with the
-- new SF-matching percentages.
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
    when 'closed_won'               then 100
    when 'closed_lost'              then 0
    -- Legacy values kept in enum for FK safety; map to best match
    -- so reports don't break if any stray row still uses them.
    when 'qualified'                then 40
    when 'proposal'                 then 90
    when 'verbal_commit'            then 90
    when 'lead'                     then 40
  end;
$$;

-- Backfill probability on all rows (picks up the new mapping).
update public.opportunities
set probability = public.default_probability_for_stage(stage)
where probability is null
   or probability = 10
   or probability = 40
   or probability = 75
   or probability = 90;  -- idempotent — only touches auto-assigned values

-- Step 4: Change default stage on new opportunities to something
-- SF-native instead of 'lead' (which we're phasing out).
alter table public.opportunities
  alter column stage set default 'details_analysis';

comment on type public.opportunity_stage is
  'Opportunity stage. SF-matching values: details_analysis (40%), demo (60%), proposal_and_price_quote (75%), proposal_conversation (90%), closed_won (100%), closed_lost (0%). Legacy values (lead, qualified, proposal, verbal_commit) are retained in the enum for history-row safety but no longer surface in the UI.';
