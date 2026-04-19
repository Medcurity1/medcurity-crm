-- ============================================================
-- First-class Partners (Brayden 2026-04-18)
--
-- Today: accounts.partner_account is a free-text string. "MedMan"
-- exists as a literal across N accounts with no single source of
-- truth. Reports on partner-sourced revenue can't roll up.
--
-- New model:
--   - public.partners — single row per partner organization
--   - public.account_partners — which partners are associated to
--     which accounts (referring partner, ongoing relationship, etc.)
--   - opportunities gain originating_partner_id + sourcing_partner_id
--     so reports can answer "what revenue came from MedMan in 2025"
--
-- A partner can ALSO be a customer (their record points back to an
-- account if applicable via partners.account_id). Common case: a
-- Managed Service Provider that we sell to AND that refers their own
-- clients to us.
--
-- Backfills: every distinct accounts.partner_account text value gets
-- a partners row created for it, and the existing accounts get
-- linked via account_partners. partner_account text column is kept
-- (deprecated) for one release in case import scripts still read it.
-- ============================================================

begin;

-- ---------------------------------------------------------------------
-- Partner relationship type (ongoing vs one-off referral, etc.)
-- ---------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'partner_relationship_type') then
    create type public.partner_relationship_type as enum (
      'referral_partner',     -- they send us deals (most common)
      'reseller',             -- they sell our product to their customers
      'msp',                  -- managed service provider; sometimes also a customer
      'consulting_partner',   -- consulting firm that refers + co-delivers
      'technology_partner',   -- product integration / co-marketing
      'broker',
      'gpo',                  -- group purchasing organization
      'other'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- partners
-- ---------------------------------------------------------------------

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Optional FK to accounts when the partner is also a customer of ours
  account_id uuid references public.accounts (id) on delete set null,
  partnership_type public.partner_relationship_type,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'prospect')),
  website text,
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  notes text,
  -- Original SF source string (for backfill auditability)
  legacy_partner_string text,
  owner_user_id uuid references public.user_profiles (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references public.user_profiles (id) on delete set null,
  archive_reason text,
  created_by uuid references public.user_profiles (id) on delete set null,
  updated_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint partners_name_not_empty check (length(trim(name)) > 0)
);

comment on table public.partners is
  'First-class partner organizations. Replaces accounts.partner_account text field. A partner may also be one of our customer accounts (FK to accounts.id when applicable).';

create index if not exists idx_partners_status
  on public.partners (status) where archived_at is null;
create index if not exists idx_partners_account
  on public.partners (account_id) where account_id is not null;
create unique index if not exists ux_partners_name_active
  on public.partners (lower(trim(name))) where archived_at is null;

alter table public.partners enable row level security;

drop policy if exists "partners_read" on public.partners;
create policy "partners_read" on public.partners
  for select to authenticated
  using (archived_at is null or public.is_admin());

drop policy if exists "partners_write_crm" on public.partners;
create policy "partners_write_crm" on public.partners
  for all to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- Auto-update updated_at
drop trigger if exists trg_partners_touch on public.partners;
create trigger trg_partners_touch
  before update on public.partners
  for each row execute function public.touch_dashboard_updated_at();

-- ---------------------------------------------------------------------
-- account_partners (M:N: an account can have multiple partner ties)
-- ---------------------------------------------------------------------

create table if not exists public.account_partners (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  partner_id uuid not null references public.partners (id) on delete cascade,
  -- Why this partner is on this account
  relationship_role text not null default 'referring_partner'
    check (relationship_role in (
      'referring_partner',  -- this partner introduced us
      'managing_partner',   -- this partner manages the relationship ongoing
      'reseller_partner',   -- account was sold THROUGH this partner
      'other'
    )),
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (account_id, partner_id, relationship_role)
);

comment on table public.account_partners is
  'Links accounts to partners. An account can have multiple partner relationships (e.g. one referred them, another now manages them).';

create index if not exists idx_account_partners_account
  on public.account_partners (account_id);
create index if not exists idx_account_partners_partner
  on public.account_partners (partner_id);

alter table public.account_partners enable row level security;

drop policy if exists "account_partners_read" on public.account_partners;
create policy "account_partners_read" on public.account_partners
  for select to authenticated using (true);

drop policy if exists "account_partners_write_crm" on public.account_partners;
create policy "account_partners_write_crm" on public.account_partners
  for all to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- ---------------------------------------------------------------------
-- Opportunity-level partner attribution
-- ---------------------------------------------------------------------
--
-- Two different concepts:
--   originating_partner_id — who originally introduced us to this account
--                            (sticky across all deals for that account)
--   sourcing_partner_id     — who specifically brought THIS deal in
--                            (may differ from originating, e.g. a renewal
--                             that came in through a different partner)
-- Both nullable. originating_partner_id auto-fills from
-- account_partners when a referring_partner exists for the account.

alter table public.opportunities
  add column if not exists originating_partner_id uuid
    references public.partners (id) on delete set null,
  add column if not exists sourcing_partner_id uuid
    references public.partners (id) on delete set null;

comment on column public.opportunities.originating_partner_id is
  'Partner who originally introduced us to this account. Sticky across all opportunities for the account.';
comment on column public.opportunities.sourcing_partner_id is
  'Partner who specifically sourced this opportunity. May differ from originating_partner_id (e.g. a renewal brought in via a different partner).';

create index if not exists idx_opportunities_originating_partner
  on public.opportunities (originating_partner_id)
  where originating_partner_id is not null;
create index if not exists idx_opportunities_sourcing_partner
  on public.opportunities (sourcing_partner_id)
  where sourcing_partner_id is not null;

-- ---------------------------------------------------------------------
-- Backfill: convert existing accounts.partner_account text into
-- proper partners + account_partners rows.
-- ---------------------------------------------------------------------

do $$
declare
  r record;
  v_partner_id uuid;
begin
  for r in
    select distinct trim(partner_account) as partner_name, owner_user_id
    from public.accounts
    where partner_account is not null
      and length(trim(partner_account)) > 0
  loop
    -- Insert the partner if not already there (case-insensitive)
    insert into public.partners (name, status, partnership_type, legacy_partner_string)
    values (r.partner_name, 'active', 'referral_partner', r.partner_name)
    on conflict do nothing
    returning id into v_partner_id;

    if v_partner_id is null then
      select id into v_partner_id from public.partners
      where lower(trim(name)) = lower(r.partner_name)
        and archived_at is null
      limit 1;
    end if;

    if v_partner_id is not null then
      -- Link every account that had this partner string
      insert into public.account_partners (account_id, partner_id, relationship_role)
      select a.id, v_partner_id, 'referring_partner'
      from public.accounts a
      where lower(trim(a.partner_account)) = lower(r.partner_name)
      on conflict do nothing;
    end if;
  end loop;
end $$;

commit;
