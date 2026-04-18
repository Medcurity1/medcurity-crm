-- Three small additions decided 2026-04-17:
--   1. Auto-fill opportunities.probability from stage (matches SF behavior).
--      Reps can override per-opp; trigger only fires on stage change or
--      when probability is null on insert.
--   2. activities.priority enum (high / normal / low) for tasks.
--   3. leads.rating enum (hot / warm / cold), distinct from leads.status.

begin;

-- 1. Stage → Probability auto-assignment ---------------------------------

-- Default probabilities per stage. Drawn from SF mapping captured in
-- raw/11-field-options-and-logic.md, with adjustments for staging's
-- Lead and Verbal Commit stages (SF lacks both).
create or replace function public.default_probability_for_stage(
  s public.opportunity_stage
)
returns integer
language sql
immutable
as $$
  select case s
    when 'lead'          then 10
    when 'qualified'     then 40
    when 'proposal'      then 75
    when 'verbal_commit' then 90
    when 'closed_won'    then 100
    when 'closed_lost'   then 0
  end;
$$;

create or replace function public.opp_set_probability_from_stage()
returns trigger
language plpgsql
as $$
begin
  -- INSERT: fill probability if not provided.
  if (tg_op = 'INSERT') then
    if NEW.probability is null then
      NEW.probability := public.default_probability_for_stage(NEW.stage);
    end if;
    return NEW;
  end if;

  -- UPDATE: only touch probability when stage actually changed AND the
  -- caller didn't explicitly set probability in the same update. If a
  -- rep manually edits probability we leave it alone.
  if (tg_op = 'UPDATE') then
    if NEW.stage is distinct from OLD.stage
       and NEW.probability is not distinct from OLD.probability then
      NEW.probability := public.default_probability_for_stage(NEW.stage);
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_opp_set_probability on public.opportunities;
create trigger trg_opp_set_probability
  before insert or update of stage, probability on public.opportunities
  for each row execute function public.opp_set_probability_from_stage();

-- Backfill any existing rows whose probability is null.
update public.opportunities
set probability = public.default_probability_for_stage(stage)
where probability is null;

-- 2. Task priority -------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'activity_priority') then
    create type public.activity_priority as enum ('high', 'normal', 'low');
  end if;
end $$;

alter table public.activities
  add column if not exists priority public.activity_priority;

comment on column public.activities.priority is
  'Optional priority for tasks (high / normal / low). Null = no explicit priority. Reps usually use due_at as the implicit priority signal; this gives them an override when due dates do not differentiate two tasks.';

-- 3. Lead rating ---------------------------------------------------------
-- Separate concept from leads.status:
--   - status = "where in the pipeline is this lead" (new/contacted/...)
--   - rating = "how promising is this lead" (hot/warm/cold)
-- Mirrors SF Lead.Rating + lets reps sort by warmth without changing
-- workflow status.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_rating') then
    create type public.lead_rating as enum ('hot', 'warm', 'cold');
  end if;
end $$;

alter table public.leads
  add column if not exists rating public.lead_rating;

comment on column public.leads.rating is
  'How promising the lead is, separate from workflow status. Hot/warm/cold mirrors SF Lead.Rating. priority_lead boolean still exists for the "needs immediate attention" flag — rating is for general triage sorting.';

create index if not exists idx_leads_rating
  on public.leads (rating)
  where rating is not null;

commit;
