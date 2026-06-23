-- ---------------------------------------------------------------------
-- Fix (Summer via Nathan, 2026-06-22): opportunities silently flip to
-- "New Business" without the rep choosing it.
--
-- Root cause: sync_kind_from_business_type() fires on `UPDATE OF
-- business_type`, and the Opportunity edit form re-sends business_type on
-- EVERY save. The trigger's "business_type is null" branch backfilled
-- business_type FROM kind — but kind defaults to 'new_business' for every
-- non-renewal opp (opportunity_kind not null default 'new_business'). So:
--   * Creating an opp without touching Business Type -> stamped New Business.
--   * Editing ANY field on an opp whose Business Type was blank -> stamped
--     New Business on save (e.g. "University of Texas System Admin").
-- The rep never chose it; a save did. kind='new_business' is a DEFAULT,
-- not a deliberate classification, so it must not auto-fill the human label.
--
-- Two safe-by-construction changes to the trigger (the renewal-label fix
-- from 2026-06-10 is preserved):
--   1. On UPDATE, no-op when business_type didn't actually change. The form
--      re-sending an unchanged (often NULL) value can no longer re-derive
--      anything. Protects every write path (form, API, RPC), not just one.
--   2. The blank-fill branch only labels RENEWALS (kind='renewal' ->
--      existing_business). It NEVER auto-fills 'new_business' from the
--      default kind, so an unclassified opp stays blank until a human
--      chooses — and that choice now sticks.
--
-- Reports key off `kind` (unchanged), so this only affects the human-facing
-- Business Type label. Existing rows already mislabeled New Business are NOT
-- bulk-reverted here (a 'new_business' value can't be told apart from a
-- deliberate one) — but a rep can now correct one and it will hold.
-- ---------------------------------------------------------------------

begin;

create or replace function public.sync_kind_from_business_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1. Unchanged business_type on UPDATE => nothing to derive. Stops the
  --    edit form's "always re-send business_type" from re-classifying the
  --    deal on unrelated saves. (INSERT always proceeds: OLD is null.)
  if tg_op = 'UPDATE' and new.business_type is not distinct from old.business_type then
    return new;
  end if;

  if new.business_type is not null then
    -- A real, changed business_type drives kind + team (existing behavior).
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
  elsif new.kind = 'renewal' then
    -- business_type wasn't provided. ONLY auto-label renewals (preserves
    -- the 2026-06-10 renewal fix so auto-created renewals read "Existing
    -- Business"). Deliberately do NOT fill 'new_business' from the default
    -- kind — that is what silently stamped New Business on unclassified opps.
    new.business_type := 'existing_business'::public.opportunity_business_type;
  end if;

  return new;
end;
$$;

-- (Trigger trg_sync_kind_from_business_type already exists and points at
--  this function; no need to recreate it.)

commit;

notify pgrst, 'reload schema';
