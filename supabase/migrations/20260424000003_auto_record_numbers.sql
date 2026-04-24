-- ---------------------------------------------------------------------
-- Auto-assign human-readable numbers to Accounts and Contacts
-- ---------------------------------------------------------------------
-- Problem: account_number has been a nullable free-text field. New
-- accounts created in the CRM ended up with blank numbers, breaking
-- downstream workflows (financial spreadsheet, integrations, legacy
-- exports) that key off a stable human-readable account identifier.
--
-- Also: Contact had no human-readable number at all, only the opaque
-- UUID primary key.
--
-- Solution:
--   1. Convert account_number to an auto-assigned integer stored as
--      text (keeps backward compat with SF-imported values like
--      '3345'). A sequence starts at max(existing) + 1.
--   2. Add contact_number (same pattern) starting fresh.
--   3. Install BEFORE INSERT triggers that populate the number if
--      it's null or blank. If the caller provided a number
--      (e.g. SF import or manual entry) that value is kept.
--   4. Backfill any existing null / blank account_numbers.
--
-- RLS: unchanged. These columns are already readable under existing
-- policies.

begin;

-- =====================================================================
-- ACCOUNTS
-- =====================================================================

-- 1. Sequence. Starts at 1; we bump it below to max(existing)+1.
create sequence if not exists public.account_number_seq
  as bigint
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

-- 2. Set the sequence's next value to (max existing numeric account_number) + 1.
do $$
declare
  v_max bigint;
begin
  select coalesce(max(
    case when account_number ~ '^[0-9]+$'
         then account_number::bigint
         else null
    end
  ), 0)
    into v_max
    from public.accounts;
  -- setval(seq, N) makes nextval() return N+1
  perform setval('public.account_number_seq', greatest(v_max, 1), true);
end $$;

-- 3. BEFORE INSERT trigger: assign if missing.
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

drop trigger if exists trg_accounts_assign_number on public.accounts;
create trigger trg_accounts_assign_number
  before insert on public.accounts
  for each row execute function public.assign_account_number();

-- 4. Backfill: give blank / null rows a fresh number.
update public.accounts
set account_number = nextval('public.account_number_seq')::text
where account_number is null or btrim(account_number) = '';

-- =====================================================================
-- CONTACTS
-- =====================================================================

-- 1. Column (idempotent).
alter table public.contacts
  add column if not exists contact_number text;

-- 2. Sequence starts at 1.
create sequence if not exists public.contact_number_seq
  as bigint
  increment by 1
  minvalue 1
  no maxvalue
  cache 1;

-- 3. Bump the sequence past any existing numeric values (there shouldn't
--    be any from a SF import since contacts didn't have this, but future-
--    safe just in case someone populated it manually).
do $$
declare
  v_max bigint;
begin
  select coalesce(max(
    case when contact_number ~ '^[0-9]+$'
         then contact_number::bigint
         else null
    end
  ), 0)
    into v_max
    from public.contacts;
  perform setval('public.contact_number_seq', greatest(v_max, 1), true);
end $$;

-- 4. BEFORE INSERT trigger.
create or replace function public.assign_contact_number()
returns trigger
language plpgsql
as $$
begin
  if new.contact_number is null or btrim(new.contact_number) = '' then
    new.contact_number := nextval('public.contact_number_seq')::text;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contacts_assign_number on public.contacts;
create trigger trg_contacts_assign_number
  before insert on public.contacts
  for each row execute function public.assign_contact_number();

-- 5. Backfill every existing contact.
update public.contacts
set contact_number = nextval('public.contact_number_seq')::text
where contact_number is null or btrim(contact_number) = '';

-- =====================================================================
-- Uniqueness — now that every row has one.
-- =====================================================================
create unique index if not exists uq_accounts_account_number
  on public.accounts (account_number)
  where account_number is not null;

create unique index if not exists uq_contacts_contact_number
  on public.contacts (contact_number)
  where contact_number is not null;

commit;
