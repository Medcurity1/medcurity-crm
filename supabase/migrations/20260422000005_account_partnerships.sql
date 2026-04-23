-- ============================================================
-- account_partners: many-to-many partnership relationships
-- between two ACCOUNTS (not a separate Partners entity)
-- ----------------------------------------------------------------
-- Per 2026-04-22 design conversation. The user clarified that a
-- "partner" is just an account — same accounts table, partners
-- are also frequently customers. This invalidates the previous
-- "first-class Partners table" design from 20260418000002 which
-- was never wired up to the UI.
--
-- This migration:
--   1. Drops the old account_partners (joined accounts to a
--      separate partners entity)
--   2. Drops the partners table itself (no UI ever consumed it)
--   3. Drops the partner-relationship enums
--   4. Creates the new account_partners — direct account-to-account
--      links: partner_account_id (umbrella) + member_account_id
--   5. Backfills from accounts.partner_account text → real FK rows
--   6. Adds an auto-flag trigger that promotes the partner side to
--      account_type='Partner' on first relationship insert
-- ============================================================

-- 1. Drop old structure (cascades trigger / index / policy cleanup)
drop table if exists public.account_partners cascade;
drop table if exists public.partners cascade;
drop type if exists public.account_partner_role cascade;
drop type if exists public.partner_relationship_type cascade;
drop type if exists public.partner_status cascade;

-- 2. Create new account_partners
create table public.account_partners (
  id uuid primary key default gen_random_uuid(),
  partner_account_id uuid not null references public.accounts (id) on delete cascade,
  member_account_id  uuid not null references public.accounts (id) on delete cascade,
  role text,
  notes text,
  created_by uuid references public.user_profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (partner_account_id, member_account_id),
  check (partner_account_id <> member_account_id)
);

create index idx_account_partners_partner on public.account_partners (partner_account_id);
create index idx_account_partners_member  on public.account_partners (member_account_id);

drop trigger if exists trg_account_partners_updated_at on public.account_partners;
create trigger trg_account_partners_updated_at
  before update on public.account_partners
  for each row execute function public.set_updated_at();

-- 3. Auto-flag the partner side as account_type='Partner' on
-- insert, ONLY when account_type is currently null. Never
-- overwrites an explicit user-set value.
create or replace function public.account_partners_auto_flag_partner()
returns trigger
language plpgsql
as $$
begin
  update public.accounts
    set account_type = 'Partner'
    where id = NEW.partner_account_id
      and (account_type is null or account_type = '');
  return NEW;
end;
$$;

drop trigger if exists trg_account_partners_auto_flag on public.account_partners;
create trigger trg_account_partners_auto_flag
  after insert on public.account_partners
  for each row execute function public.account_partners_auto_flag_partner();

-- 4. RLS
alter table public.account_partners enable row level security;

drop policy if exists "account_partners_read_authenticated" on public.account_partners;
create policy "account_partners_read_authenticated"
  on public.account_partners for select to authenticated using (true);

drop policy if exists "account_partners_insert_crm_roles" on public.account_partners;
create policy "account_partners_insert_crm_roles"
  on public.account_partners for insert to authenticated
  with check (public.has_crm_write_role());

drop policy if exists "account_partners_update_crm_roles" on public.account_partners;
create policy "account_partners_update_crm_roles"
  on public.account_partners for update to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

drop policy if exists "account_partners_delete_crm_roles" on public.account_partners;
create policy "account_partners_delete_crm_roles"
  on public.account_partners for delete to authenticated
  using (public.has_crm_write_role());

-- 5. Backfill from the legacy accounts.partner_account text column.
-- Joins by lowercased / trimmed name; anything that doesn't match
-- stays as text so it can be cleaned up via the new "Add Partner"
-- UI later.
insert into public.account_partners (partner_account_id, member_account_id)
select distinct on (p.id, m.id)
  p.id as partner_account_id,
  m.id as member_account_id
from public.accounts m
join public.accounts p
  on lower(trim(p.name)) = lower(trim(m.partner_account))
where m.partner_account is not null
  and trim(m.partner_account) <> ''
  and p.id <> m.id
on conflict (partner_account_id, member_account_id) do nothing;

comment on table public.account_partners is
  'Many-to-many partnership relationships between accounts. partner_account_id is the umbrella/referrer; member_account_id is the account that came in via the partner. Inserting a row auto-flags the partner side as account_type=''Partner'' when not already set.';
comment on column public.account_partners.role is
  'Optional free-text role (Reseller, Co-marketing, etc.). Skipped from UI per 2026-04-22 — SF role values were never used.';
