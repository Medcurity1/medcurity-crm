-- Re-assign any short (1-3 digit) numeric account_numbers to fresh
-- 4-digit-minimum values pulled from account_number_seq.
--
-- Context: 20260514000003 zero-padded these (e.g. "28" -> "0028"),
-- but 20260514000005 reverted that padding (back to "28") and bumped
-- the sequence so all NEW assignments are >= 1000. Existing short
-- numbers were left alone.
--
-- This migration finishes the cleanup: each remaining short numeric
-- value is replaced by the next available value from the sequence.
-- Collisions are impossible because:
--   1. nextval() always returns a fresh value > any prior nextval().
--   2. The sequence's last_value is already >= max(existing numeric
--      account_number) thanks to the seed in 20260424000003 and the
--      bump in 20260514000005.
--   3. We additionally loop past any value that happens to already
--      exist in accounts.account_number (defensive — covers the case
--      where someone manually typed a number that the sequence will
--      eventually hand out).
--
-- The unique index `uq_accounts_account_number` is the ultimate
-- guard. The DO block will raise if a collision somehow occurs.

begin;

-- Optional audit table: snapshot the short numbers before we rewrite
-- them, so we can trace "what was account 28 before?" if needed.
create table if not exists public.account_number_migrations (
  id            bigserial primary key,
  account_id    uuid not null references public.accounts(id) on delete cascade,
  old_number    text not null,
  new_number    text not null,
  migrated_at   timestamptz not null default now()
);

do $$
declare
  r           record;
  v_candidate text;
  v_attempts  int;
begin
  for r in
    select id, account_number
    from public.accounts
    where account_number ~ '^[0-9]+$'
      and length(account_number) < 4
    order by created_at asc, id asc   -- stable order so oldest accounts
                                       -- get the lower fresh numbers
  loop
    v_attempts := 0;
    loop
      v_attempts := v_attempts + 1;
      if v_attempts > 1000 then
        raise exception
          'Could not find a free account_number after 1000 attempts '
          'starting from sequence current. Aborting.';
      end if;

      v_candidate := nextval('public.account_number_seq')::text;

      -- Defensive collision check: skip if some other account already
      -- has this exact string. (Shouldn't happen if the sequence is
      -- ahead of all manual numbers, but cheap to verify.)
      perform 1 from public.accounts where account_number = v_candidate;
      if not found then
        exit;  -- got a free number
      end if;
    end loop;

    insert into public.account_number_migrations (account_id, old_number, new_number)
    values (r.id, r.account_number, v_candidate);

    update public.accounts
    set account_number = v_candidate
    where id = r.id;
  end loop;
end$$;

commit;
