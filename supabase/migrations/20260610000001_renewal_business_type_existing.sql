-- ---------------------------------------------------------------------
-- Fix (Joe, 2026-06-10): auto-created renewals show "New Business"
-- instead of "Existing Business".
--
-- Root cause: the renewal generator sets kind='renewal' + team='renewals'
-- but never sets `business_type` (the field users see). It lands NULL,
-- so the opportunity reads as blank / "New Business".
--
-- Two-part fix, both SAFE BY CONSTRUCTION:
--
--   1. FORWARD: extend the existing sync trigger so that when
--      business_type was NOT provided but kind IS set, business_type is
--      derived from kind (renewal -> existing_business). This only ever
--      FILLS A BLANK; the existing "business_type is set" path is
--      untouched, so a value a human/UI already chose is never changed.
--
--   2. BACKFILL: fill business_type for EXISTING rows that are already
--      internally renewals (kind='renewal') but have a NULL business_type.
--      Scoped tightly:
--        - WHERE business_type IS NULL  -> never overwrites a set value
--        - AND kind = 'renewal'         -> only rows already marked renewal
--      i.e. we make the visible label agree with what the record already
--      is. No deal is reclassified; no non-renewal is touched.
--
-- Deliberately NOT touched here: rows that already read kind='new_business'
-- (even if automation-created) — those cannot be told apart from genuine
-- new business by data alone and are surfaced for human review instead.
--
-- The report's new-vs-renewed split keys off `kind` (already correct), so
-- this change is cosmetic to the numbers; it fixes the human-facing label.
-- ---------------------------------------------------------------------

begin;

-- 1. FORWARD fix: derive business_type from kind only when it's blank.
create or replace function public.sync_kind_from_business_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.business_type is not null then
    -- Existing behavior: business_type drives kind + team. Untouched.
    if new.business_type::text like 'existing_business%' then
      if new.kind is distinct from 'renewal' then
        new.kind := 'renewal';
      end if;
      if new.team is distinct from 'renewals' then
        new.team := 'renewals';
      end if;
    else
      if new.kind is distinct from 'new_business' then
        new.kind := 'new_business';
      end if;
      if new.team is distinct from 'sales' then
        new.team := 'sales';
      end if;
    end if;
  elsif new.kind is not null then
    -- NEW: business_type wasn't provided (e.g. the renewal automation
    -- sets kind but not business_type). Fill the blank from kind so the
    -- visible label matches reality. Only sets business_type; leaves
    -- kind and team exactly as the caller set them.
    if new.kind = 'renewal' then
      new.business_type := 'existing_business'::public.opportunity_business_type;
    elsif new.kind = 'new_business' then
      new.business_type := 'new_business'::public.opportunity_business_type;
    end if;
  end if;
  return new;
end;
$$;

-- (Trigger trg_sync_kind_from_business_type already exists and points at
--  this function; no need to recreate it.)

-- 2. BACKFILL: only blanks, only rows already internally renewals.
update public.opportunities
set business_type = 'existing_business'::public.opportunity_business_type
where kind = 'renewal'
  and business_type is null;

commit;

notify pgrst, 'reload schema';
