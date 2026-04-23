-- Contract tracking enhancements — covers the 4 scenarios Brayden
-- described 2026-04-17:
--
--   1. Fixed-term (1yr/3yr) WITHOUT auto-renew language:
--      requires a new signature every renewal. Flag: needs_new_signature_yearly
--
--   2. Fixed-term WITH auto-renew language: original contract stands
--      indefinitely unless one side terminates. Flag: has_auto_renew_clause
--
--   3. Invoice-only / no signed contract (rare). Flag: contract_type = 'invoice_only'
--
--   4. Split contracts: separate agreements for separate
--      products/services signed at different times. Link via
--      parent_contract_id (this opp extends another).
--
-- Also adds file storage for signed PDFs (uploaded manually OR pulled
-- via PandaDoc webhook) so reps can click a contract file from the opp.
--
-- This migration is additive — nothing existing breaks.

begin;

-- ---------------------------------------------------------------------
-- Opportunity-level contract metadata
-- ---------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'contract_type_enum') then
    create type public.contract_type_enum as enum (
      'signed_fixed_term',       -- standard 1-yr or 3-yr with signed agreement
      'signed_auto_renew',       -- scenario 2: contract stands past initial term
      'invoice_only',            -- scenario 3: no signed contract, invoice only
      'amendment',               -- modifies a parent contract (split / add-on)
      'other'
    );
  end if;
end $$;

alter table public.opportunities
  add column if not exists contract_type public.contract_type_enum,
  add column if not exists has_auto_renew_clause boolean not null default false,
  add column if not exists needs_new_signature_yearly boolean not null default false,
  add column if not exists parent_contract_opportunity_id uuid
    references public.opportunities (id) on delete set null,
  add column if not exists contract_notice_days integer,
  add column if not exists billing_frequency_override text,
  add column if not exists price_escalator_pct numeric(5,2);

comment on column public.opportunities.contract_type is
  'Which of the 4 contract scenarios this opp represents.';
comment on column public.opportunities.has_auto_renew_clause is
  'True when the signed contract has auto-renew language. Scenario 2. Drives renewal automation: true opps roll without re-signature.';
comment on column public.opportunities.needs_new_signature_yearly is
  'True for scenario 1 contracts that require a fresh signature at each renewal. Migration target: we want to move these to scenario 2.';
comment on column public.opportunities.parent_contract_opportunity_id is
  'Points to the primary contract opp when this is a split/add-on agreement (scenario 4). Lets reporting roll up split contracts under one relationship.';
comment on column public.opportunities.contract_notice_days is
  'Days of notice required to terminate / non-renew. E.g. 60 or 90 days.';
comment on column public.opportunities.billing_frequency_override is
  'Override for this specific contract if different from payment_frequency (e.g. annual contract but monthly billing).';
comment on column public.opportunities.price_escalator_pct is
  'Annual price increase baked into the contract (e.g. 3.00 for 3% YoY). Nullable for no-escalator deals.';

create index if not exists idx_opportunities_parent_contract
  on public.opportunities (parent_contract_opportunity_id)
  where parent_contract_opportunity_id is not null;

-- ---------------------------------------------------------------------
-- Signed contract files (PDFs, DOCX, etc.)
-- ---------------------------------------------------------------------

create table if not exists public.contract_files (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  -- Where the file actually lives. Two supported sources:
  --   storage_path: Supabase Storage bucket path (manual uploads)
  --   external_url: a URL on another service (PandaDoc, Box, etc.)
  -- One of these will be populated; other is null.
  storage_path text,
  external_url text,
  external_source text,  -- 'pandadoc', 'manual', 'import', etc.
  external_id text,      -- PandaDoc document id, etc.
  file_name text not null,
  file_size_bytes bigint,
  mime_type text,
  signed_at date,
  uploaded_by uuid references public.user_profiles (id) on delete set null,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contract_files_has_location check (
    storage_path is not null or external_url is not null
  )
);

comment on table public.contract_files is
  'Signed contract documents attached to opportunities. Either a Supabase Storage path for manual uploads or an external URL (PandaDoc, Box, etc.) for integration-synced documents.';

create index if not exists idx_contract_files_opp
  on public.contract_files (opportunity_id)
  where archived_at is null;
create index if not exists idx_contract_files_account
  on public.contract_files (account_id)
  where archived_at is null;
create unique index if not exists ux_contract_files_external
  on public.contract_files (external_source, external_id)
  where external_id is not null;

alter table public.contract_files enable row level security;

drop policy if exists "contract_files_read" on public.contract_files;
create policy "contract_files_read" on public.contract_files
  for select to authenticated
  using (archived_at is null or public.is_admin());

drop policy if exists "contract_files_write_crm" on public.contract_files;
create policy "contract_files_write_crm" on public.contract_files
  for all to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- Auto-update updated_at
drop trigger if exists trg_contract_files_updated_at on public.contract_files;
create trigger trg_contract_files_updated_at
  before update on public.contract_files
  for each row execute function public.touch_dashboard_updated_at();

commit;
