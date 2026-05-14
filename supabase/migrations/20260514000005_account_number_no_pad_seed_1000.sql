-- Refine the account_number strategy (correction to 20260514000003).
--
-- Original intent (20260514000003) was "minimum 4 digits, padded with
-- leading zeros". After review, the new rule is simpler:
--
--   * Existing short account_numbers (e.g. "28") stay as-is.
--   * New auto-assigned account_numbers come from a sequence that
--     starts at >= 1000, so they're naturally 4 digits, no padding.
--   * The sequence will naturally roll to 5 digits at 10000, which
--     is fine.
--
-- This migration:
--   1. Reverts the LPAD backfill from 20260514000003 by stripping
--      leading zeros from any purely-numeric account_number. Anything
--      that originally was "28" before the prior migration's backfill
--      is now back to "28".
--   2. Replaces assign_account_number() with a no-LPAD variant.
--   3. Advances the sequence to at least 1000 so future inserts
--      produce 4-digit minimums.

begin;

-- 1. Strip leading zeros from numeric account_numbers (undo prior LPAD).
update public.accounts
set account_number = ltrim(account_number, '0')
where account_number ~ '^0+[0-9]+$';

-- Safety: if any account ended up with empty string (was all zeros,
-- which shouldn't happen but defend anyway), null it so the trigger
-- re-assigns on next touch.
update public.accounts set account_number = null where account_number = '';

-- 2. Replace the trigger function: no padding, just nextval as text.
create or replace function public.assign_account_number()
returns trigger
language plpgsql
as $$
begin
  if new.account_number is null or btrim(new.account_number) = '' then
    new.account_number := nextval('public.account_number_seq')::text;
  end if;
  return new;
end;
$$;

-- 3. Bump sequence so the next value is >= 1000.
-- Use `is_called = true` so the very next nextval() returns
-- max(current, 999) + 1 = max(current+1, 1000).
do $$
declare
  v_current bigint;
begin
  select last_value into v_current from public.account_number_seq;
  if v_current < 999 then
    perform setval('public.account_number_seq', 999, true);
  end if;
end$$;

commit;
