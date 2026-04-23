-- ============================================================
-- Migration tracking: `verified` flag on core records.
--
-- During the SF migration users will click through accounts /
-- contacts / opportunities / leads and confirm the data matches
-- what's in Salesforce. The `verified` checkbox lets them tag a
-- record as "I've looked at this, data is complete/correct".
-- We also stamp who verified + when so admins can see who's
-- been covering which territory.
--
-- After cutover this column stays useful as a data-hygiene flag
-- (e.g. "show me unverified customer accounts" pre-QBR).
-- ============================================================

begin;

alter table public.accounts
  add column if not exists verified boolean not null default false,
  add column if not exists verified_by uuid references public.user_profiles(id),
  add column if not exists verified_at timestamptz;

alter table public.contacts
  add column if not exists verified boolean not null default false,
  add column if not exists verified_by uuid references public.user_profiles(id),
  add column if not exists verified_at timestamptz;

alter table public.opportunities
  add column if not exists verified boolean not null default false,
  add column if not exists verified_by uuid references public.user_profiles(id),
  add column if not exists verified_at timestamptz;

alter table public.leads
  add column if not exists verified boolean not null default false,
  add column if not exists verified_by uuid references public.user_profiles(id),
  add column if not exists verified_at timestamptz;

-- Partial indexes so "unverified records" queries stay fast without
-- bloating the btree with thousands of verified rows.
create index if not exists idx_accounts_unverified on public.accounts (updated_at desc) where verified = false;
create index if not exists idx_contacts_unverified on public.contacts (updated_at desc) where verified = false;
create index if not exists idx_opps_unverified on public.opportunities (updated_at desc) where verified = false;
create index if not exists idx_leads_unverified on public.leads (updated_at desc) where verified = false;

commit;
