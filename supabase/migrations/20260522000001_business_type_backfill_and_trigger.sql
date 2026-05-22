-- ---------------------------------------------------------------
-- Business Type backfill + bi-directional sync trigger
-- ---------------------------------------------------------------
-- `business_type` was added 2026-04-18 but never backfilled, so the
-- opportunities list was rendering "—" for almost every row. The UI
-- already has a one-way effect (business_type → kind), but nothing
-- ever set business_type for the 2K+ SF-imported opps that only had
-- `kind` populated.
--
-- This migration:
--   1. Backfills business_type from kind for all rows where
--      business_type is null. Conservative mapping: renewals →
--      'existing_business', new_business → 'new_business'. Anything
--      richer ('new_product' / 'new_service' / 'opportunity') is
--      left for users to set manually.
--   2. Installs a BEFORE INSERT/UPDATE trigger that keeps the two
--      fields in sync at the DB level (defensive — UI already does
--      this, but the trigger covers direct API writes, imports,
--      RPCs, etc.).
--
-- Non-destructive: idempotent on re-run.
-- ---------------------------------------------------------------

-- 1. Backfill
update public.opportunities
set business_type = case
      when kind = 'renewal' then 'existing_business'::public.opportunity_business_type
      when kind = 'new_business' then 'new_business'::public.opportunity_business_type
      else null
    end
where business_type is null
  and kind is not null;

-- 2. Trigger function — keeps kind + team aligned with business_type
--    when business_type is set/changed. Mirrors the UI effect in
--    OpportunityForm.tsx.
create or replace function public.sync_kind_from_business_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.business_type is not null then
    if new.business_type::text like 'existing_business%' then
      -- Existing-business variants are renewal-team work.
      if new.kind is distinct from 'renewal' then
        new.kind := 'renewal';
      end if;
      if new.team is distinct from 'renewals' then
        new.team := 'renewals';
      end if;
    else
      -- 'new_business' and 'opportunity' → sales-team work.
      if new.kind is distinct from 'new_business' then
        new.kind := 'new_business';
      end if;
      if new.team is distinct from 'sales' then
        new.team := 'sales';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_kind_from_business_type on public.opportunities;
create trigger trg_sync_kind_from_business_type
  before insert or update of business_type
  on public.opportunities
  for each row execute function public.sync_kind_from_business_type();

-- 3. Reload PostgREST schema cache
notify pgrst, 'reload schema';
