-- Add contract_signed_date and auto-compute contract_end_date on closed_won.
--
-- Problem solved: close dates drift as deals slip, but the renewal automation
-- anchors on contract_end_date. If contract_end_date is never properly set,
-- renewals don't fire or fire at the wrong time.
--
-- Solution:
--   1. New field: contract_signed_date (when the contract was actually signed)
--   2. Trigger on stage → closed_won that:
--      a. Sets close_date to today if null
--      b. Sets contract_signed_date to today if null
--      c. Computes contract_end_date from start + length if missing
--      d. Sets contract_start_date to close_date if missing
--   3. This ensures contract_end_date is always populated for closed_won opps,
--      so the renewal automation has a reliable anchor.

begin;

-- 1. Add the field
alter table public.opportunities
  add column if not exists contract_signed_date date;

comment on column public.opportunities.contract_signed_date is
  'Date the contract was actually signed. Auto-set on Closed Won if null. PandaDoc integration can override.';

-- 2. Trigger function: auto-fill contract dates on Closed Won
create or replace function public.auto_fill_contract_dates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only act when stage changes TO closed_won
  if NEW.stage = 'closed_won' and (OLD.stage is null or OLD.stage <> 'closed_won') then

    -- Set close_date if not already set
    if NEW.close_date is null then
      NEW.close_date := current_date;
    end if;

    -- Set contract_signed_date if not already set
    if NEW.contract_signed_date is null then
      NEW.contract_signed_date := current_date;
    end if;

    -- Set contract_start_date if not already set (default to close_date)
    if NEW.contract_start_date is null then
      NEW.contract_start_date := NEW.close_date;
    end if;

    -- Compute contract_end_date if missing but we have start + length
    if NEW.contract_end_date is null and NEW.contract_start_date is not null then
      if NEW.contract_length_months is not null and NEW.contract_length_months > 0 then
        NEW.contract_end_date := (NEW.contract_start_date + (NEW.contract_length_months || ' months')::interval)::date;
      else
        -- Default: 12-month contract if no length specified
        NEW.contract_end_date := (NEW.contract_start_date + interval '12 months')::date;
      end if;
    end if;

  end if;

  return NEW;
end;
$$;

-- Attach the trigger
drop trigger if exists trg_auto_fill_contract_dates on public.opportunities;
create trigger trg_auto_fill_contract_dates
  before update on public.opportunities
  for each row
  execute function public.auto_fill_contract_dates();

-- Also fire on insert (in case an opp is inserted directly as closed_won,
-- e.g. during SF import or renewal automation)
drop trigger if exists trg_auto_fill_contract_dates_insert on public.opportunities;
create trigger trg_auto_fill_contract_dates_insert
  before insert on public.opportunities
  for each row
  execute function public.auto_fill_contract_dates();

-- 3. Backfill: for existing closed_won opps missing contract_end_date,
--    compute it from start + length (or start + 12 months)
update public.opportunities
set contract_end_date = case
  when contract_start_date is not null and contract_length_months is not null and contract_length_months > 0
    then (contract_start_date + (contract_length_months || ' months')::interval)::date
  when contract_start_date is not null
    then (contract_start_date + interval '12 months')::date
  when close_date is not null
    then (close_date + interval '12 months')::date
  else null
end
where stage = 'closed_won'
  and contract_end_date is null;

-- Also backfill contract_signed_date from close_date for existing closed_won opps
update public.opportunities
set contract_signed_date = close_date
where stage = 'closed_won'
  and contract_signed_date is null
  and close_date is not null;

commit;
