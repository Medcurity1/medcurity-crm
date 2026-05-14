-- Account numbers should always be at least 4 digits.
--
-- Background: 20260424000003 introduced auto-assignment via a sequence,
-- but the assigned values weren't zero-padded — early test accounts
-- got numbers like "28" instead of "0028". The UX decision (2026-05-14)
-- is that account_number is an auto-only field (no longer editable in
-- the form), and the canonical format is a 4-digit-minimum padded string.
--
-- This migration:
--   1. Updates the BEFORE INSERT trigger to LPAD the sequence value
--      to at least 4 characters.
--   2. Backfills any existing purely-numeric account_number shorter
--      than 4 chars so the dataset is consistent.
--
-- Note: the unique index `uq_accounts_account_number` enforces no
-- collisions. Padding "28" → "0028" would collide only if some other
-- row already held the string "0028" verbatim, which would itself be
-- a data anomaly worth fixing manually. Migration aborts on conflict.

begin;

-- 1. Replace the assign function with a zero-padded variant.
create or replace function public.assign_account_number()
returns trigger
language plpgsql
as $$
begin
  if new.account_number is null or btrim(new.account_number) = '' then
    -- LPAD to 4 chars minimum. Numbers >= 10000 pass through unchanged.
    new.account_number := lpad(nextval('public.account_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

-- 2. Backfill: pad any short, purely-numeric account_numbers.
update public.accounts
set account_number = lpad(account_number, 4, '0')
where account_number ~ '^[0-9]+$'
  and length(account_number) < 4;

commit;
