-- ============================================================
-- account_partners: many-to-many partnership relationships
-- ----------------------------------------------------------------
-- Per 2026-04-22 design conversation. The previous accounts.partner_account
-- TEXT column held a partner's NAME (free-text) which couldn't be
-- navigated, aggregated, or kept in sync. This replaces it with a
-- proper join table so:
--   - One account can have multiple partners (rare but allowed)
--   - One account can have many members
--   - An account can be both a partner AND a member (chains: A → B → C)
--   - Partner tab queries both sides from one component
--
-- Direction:
--   partner_account_id = the "umbrella" / referrer / parent
--   member_account_id  = the account that came in via the partner
--
-- Example: UTN refers Beaver Valley → row is
--   partner_account_id = UTN.id, member_account_id = BVH.id
--
-- role + notes are nullable so users can add lightweight context
-- without being forced into another picklist (per user request:
-- SF role values were never useful, skip surfacing in UI for now).
-- ============================================================

create table if not exists public.account_partners (
  id uuid primary key default gen_random_uuid(),
  partner_account_id uuid not null references public.accounts (id) on delete cascade,
  member_account_id  uuid not null references public.accounts (id) on delete cascade,
  role text,
  notes text,
  created_by uuid references public.user_profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- Same partnership recorded twice = bug. Same partner can have many
  -- members, same account can have many partners — but no row pair
  -- duplicates.
  unique (partner_account_id, member_account_id),
  -- A→A makes no sense. Block it at the schema level.
  check (partner_account_id <> member_account_id)
);

create index if not exists idx_account_partners_partner on public.account_partners (partner_account_id);
create index if not exists idx_account_partners_member  on public.account_partners (member_account_id);

-- Same updated_at trigger pattern used everywhere else.
drop trigger if exists trg_account_partners_updated_at on public.account_partners;
create trigger trg_account_partners_updated_at
  before update on public.account_partners
  for each row execute function public.set_updated_at();

-- Auto-flag the partner_account as a Partner if its account_type is
-- currently null. Never overwrites an explicit value (Direct,
-- Self-Service, etc.) — some accounts are genuinely both, the human
-- choice wins.
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

-- ============================================================
-- RLS
-- ============================================================
alter table public.account_partners enable row level security;

drop policy if exists "account_partners_read_authenticated" on public.account_partners;
create policy "account_partners_read_authenticated"
on public.account_partners
for select
to authenticated
using (true);

drop policy if exists "account_partners_insert_crm_roles" on public.account_partners;
create policy "account_partners_insert_crm_roles"
on public.account_partners
for insert
to authenticated
with check (public.has_crm_write_role());

drop policy if exists "account_partners_update_crm_roles" on public.account_partners;
create policy "account_partners_update_crm_roles"
on public.account_partners
for update
to authenticated
using (public.has_crm_write_role())
with check (public.has_crm_write_role());

drop policy if exists "account_partners_delete_crm_roles" on public.account_partners;
create policy "account_partners_delete_crm_roles"
on public.account_partners
for delete
to authenticated
using (public.has_crm_write_role());

-- ============================================================
-- Backfill from accounts.partner_account (text → real FK rows)
-- ----------------------------------------------------------------
-- The SF import dropped a partner's NAME into accounts.partner_account.
-- Match those names against existing accounts and create the proper
-- relationship rows. Anything that doesn't name-match is left as text
-- on the original column so a human can fix it later via the new
-- "Add Partner" UI.
-- ============================================================
insert into public.account_partners (partner_account_id, member_account_id)
select distinct on (p.id, m.id)
  p.id as partner_account_id,
  m.id as member_account_id
from public.accounts m
join public.accounts p
  on lower(trim(p.name)) = lower(trim(m.partner_account))
where m.partner_account is not null
  and trim(m.partner_account) <> ''
  and p.id <> m.id  -- self-reference protection (some SF rows had partner = self)
on conflict (partner_account_id, member_account_id) do nothing;

comment on table public.account_partners is
  'Many-to-many partnership relationships between accounts. partner_account_id is the umbrella/referrer; member_account_id is the account that came in via the partner. Inserting a row auto-flags the partner side as account_type=''Partner'' when not already set.';
comment on column public.account_partners.role is
  'Optional free-text role (e.g. Reseller, Co-marketing). Not required — SF role values were never used per 2026-04-22 user feedback.';
