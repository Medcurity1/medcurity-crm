-- Account phone auto-fill from the primary contact (Nathan, 2026-07-21).
--
-- Same fill-only philosophy as the close-gate FTE back-fill shipped earlier
-- today: when an account has NO phone number but DOES have a primary contact
-- with one, the account inherits it. Never overwrites an existing account
-- phone; one-way, blank-fill only.
--
--  1. Trigger on contacts: fires when a contact's phone / primary flag /
--     archived state changes, so making someone primary (or giving the
--     primary a phone) fills a phoneless account immediately. Also covers
--     imports, which insert contacts through the same path.
--  2. One-time backfill for accounts already in that state.

begin;

create or replace function public.fill_account_phone_from_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_primary, false)
     and new.archived_at is null
     and new.phone is not null
     and btrim(new.phone) <> ''
     and new.account_id is not null
  then
    update public.accounts
       set phone = new.phone
     where id = new.account_id
       and (phone is null or btrim(phone) = '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contacts_fill_account_phone on public.contacts;
create trigger trg_contacts_fill_account_phone
after insert or update of phone, is_primary, archived_at on public.contacts
for each row execute function public.fill_account_phone_from_primary();

-- One-time backfill: phoneless accounts whose primary contact has a phone.
update public.accounts a
   set phone = c.phone
  from (
    select distinct on (account_id) account_id, phone
      from public.contacts
     where is_primary
       and archived_at is null
       and phone is not null
       and btrim(phone) <> ''
     order by account_id, updated_at desc nulls last
  ) c
 where c.account_id = a.id
   and (a.phone is null or btrim(a.phone) = '');

commit;
