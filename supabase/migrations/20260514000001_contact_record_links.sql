-- Many-to-many associations between contacts and records (accounts +
-- opportunities), modeled after Salesforce's `AccountContactRelation`
-- and `OpportunityContactRole` join objects.
--
-- Why this exists:
-- Today `contacts.account_id` is a singular FK — one contact can only
-- "belong to" one account, so reps were either (a) creating duplicate
-- contact rows when the same person needed to appear on a second
-- account/opp, or (b) reassigning the contact's home account and
-- silently orphaning them from the prior one. Rachel reported this
-- when trying to add Kristal Walters to a Wipfli account she didn't
-- already home at.
--
-- This migration is purely additive:
--   - `contacts.account_id` stays exactly as-is. It remains the
--     contact's "home" account (where they work / their employer).
--   - New `contact_account_links` adds ADDITIONAL account associations
--     without touching the home account. A contact whose home is at
--     HealthSystem A but who is also a stakeholder at its subsidiary
--     can be linked to both without duplication.
--   - New `contact_opportunity_links` attaches contacts to specific
--     opportunities. Today the Opp's Contacts tab piggybacks on
--     "show me everyone at the opp's account" — coarse and inaccurate
--     for deals where only some of the account's contacts are
--     stakeholders. This makes opp-level stakeholders explicit.
--
-- The 17 files currently reading `contacts.account_id` (forms, MQL/SQL
-- reports, email sync, SF import) keep working unchanged — they all
-- target the home account. New reports/views can UNION in the link
-- tables when they want the broader "everywhere this contact appears"
-- semantic.

-- ---------------------------------------------------------------------
-- contact_account_links — additional accounts a contact appears under
-- ---------------------------------------------------------------------
create table if not exists public.contact_account_links (
  contact_id  uuid not null references public.contacts(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete cascade,
  added_at    timestamptz not null default timezone('utc', now()),
  added_by    uuid references auth.users(id),
  -- Unique pair — adding the same contact to the same account twice
  -- is a no-op error caught at the DB level (UI surfaces it as
  -- "already added"). PK on both columns gives us indexes for both
  -- query directions for free.
  primary key (contact_id, account_id)
);

-- account_id-first index for "show me all linked contacts on account X"
-- (the AccountContacts query). The PK above indexes (contact_id,
-- account_id), so we need an account_id-leading index for the reverse
-- direction.
create index if not exists contact_account_links_account_idx
  on public.contact_account_links (account_id);

alter table public.contact_account_links enable row level security;

drop policy if exists "contact_account_links_read" on public.contact_account_links;
create policy "contact_account_links_read"
  on public.contact_account_links
  for select
  to authenticated
  using (true);

drop policy if exists "contact_account_links_write" on public.contact_account_links;
create policy "contact_account_links_write"
  on public.contact_account_links
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.contact_account_links is
  'M2M: additional accounts a contact appears under, beyond their home account (contacts.account_id). Mirrors SF AccountContactRelation. Inserted by the "Add Contact" dialog on an Account detail page when picking an existing contact.';

-- ---------------------------------------------------------------------
-- contact_opportunity_links — stakeholders on specific opportunities
-- ---------------------------------------------------------------------
create table if not exists public.contact_opportunity_links (
  contact_id      uuid not null references public.contacts(id) on delete cascade,
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  added_at        timestamptz not null default timezone('utc', now()),
  added_by        uuid references auth.users(id),
  primary key (contact_id, opportunity_id)
);

create index if not exists contact_opportunity_links_opp_idx
  on public.contact_opportunity_links (opportunity_id);

alter table public.contact_opportunity_links enable row level security;

drop policy if exists "contact_opportunity_links_read" on public.contact_opportunity_links;
create policy "contact_opportunity_links_read"
  on public.contact_opportunity_links
  for select
  to authenticated
  using (true);

drop policy if exists "contact_opportunity_links_write" on public.contact_opportunity_links;
create policy "contact_opportunity_links_write"
  on public.contact_opportunity_links
  for all
  to authenticated
  using (true)
  with check (true);

comment on table public.contact_opportunity_links is
  'M2M: contacts attached as stakeholders to specific opportunities. Mirrors SF OpportunityContactRole. Decouples opp contacts from "all contacts at the opp''s account" so deals can have their own explicit stakeholder list.';

-- ---------------------------------------------------------------------
-- v_contact_cross_linkage — one row per (contact, record) association
-- ---------------------------------------------------------------------
-- Used by the "Contact Cross-Linkage" standard report to show which
-- contacts touch multiple records (and which records they touch). The
-- view UNIONs three sources:
--
--   1. The contact's HOME account (from contacts.account_id) — these
--      are the relationships every contact has had since day one.
--   2. ADDITIONAL accounts via contact_account_links.
--   3. Opportunity stakeholders via contact_opportunity_links.
--
-- Each row has a `link_type` so the report can distinguish home vs
-- linked records, and a `record_kind` ('account' | 'opportunity') so
-- you can filter by record type. Grouping by `contact_id` and counting
-- records produces "contacts appearing on N+ records".

create or replace view public.v_contact_cross_linkage as
  -- Home account (always exists when contacts.account_id is set)
  select
    c.id                            as contact_id,
    coalesce(
      nullif(
        trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
        ''
      ),
      c.email,
      '(no name)'
    )                               as contact_name,
    c.email                         as contact_email,
    'home_account'::text            as link_type,
    a.id                            as record_id,
    a.name                          as record_name,
    'account'::text                 as record_kind,
    null::timestamptz               as linked_at
  from public.contacts c
  join public.accounts a on a.id = c.account_id
  where c.archived_at is null
    and a.archived_at is null

  union all

  -- Additional accounts via the link table
  select
    c.id,
    coalesce(
      nullif(
        trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
        ''
      ),
      c.email,
      '(no name)'
    ),
    c.email,
    'linked_account'::text,
    a.id,
    a.name,
    'account'::text,
    cal.added_at
  from public.contact_account_links cal
  join public.contacts c on c.id = cal.contact_id
  join public.accounts a on a.id = cal.account_id
  where c.archived_at is null
    and a.archived_at is null

  union all

  -- Opportunity stakeholders
  select
    c.id,
    coalesce(
      nullif(
        trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
        ''
      ),
      c.email,
      '(no name)'
    ),
    c.email,
    'linked_opportunity'::text,
    o.id,
    o.name,
    'opportunity'::text,
    col.added_at
  from public.contact_opportunity_links col
  join public.contacts c on c.id = col.contact_id
  join public.opportunities o on o.id = col.opportunity_id
  where c.archived_at is null;

comment on view public.v_contact_cross_linkage is
  'One row per (contact, record) association across home accounts, linked accounts, and linked opportunities. Used by the Contact Cross-Linkage standard report and any future "where does this contact appear" query.';
