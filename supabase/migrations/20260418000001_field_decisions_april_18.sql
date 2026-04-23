-- ============================================================
-- Field decisions resolved 2026-04-18 (Brayden review of
-- field-reconciliation.md):
--
--   1. DROP leads.type / lead_type enum — redundant with lead_source.
--   2. ADD opportunity_business_type enum + opportunities.business_type
--      with the 5 SF values used for sales-vs-renewals reporting.
--   3. ADD industry_category enum (~25 healthcare-relevant values).
--      accounts.industry_category + leads.industry_category. Original
--      free-text industry column kept for SF import passthrough.
--   4. ADD project_segment enum + accounts.project_segment +
--      leads.project_segment. Original project free-text kept.
--   5. ADD derive_account_status() function + triggers that recompute
--      accounts.status whenever a related opportunity changes.
-- ============================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Drop redundant leads.type
-- ---------------------------------------------------------------------

alter table public.leads drop column if exists type;
drop type if exists public.lead_type;

-- ---------------------------------------------------------------------
-- 2. opportunity business_type (mirrors SF Opportunity.Type)
-- ---------------------------------------------------------------------
--
-- Brayden 2026-04-18: this is SEPARATE from opportunities.kind.
--   - kind = sales-team workflow distinction (new_business vs renewal)
--   - business_type = revenue-reporting category. Includes the catch-all
--     "opportunity" for in-flight or sales-team closed_lost deals so a
--     lost-product loss doesn't roll up as "lost a customer."
do $$ begin
  if not exists (select 1 from pg_type where typname = 'opportunity_business_type') then
    create type public.opportunity_business_type as enum (
      'new_business',
      'existing_business',
      'existing_business_new_product',
      'existing_business_new_service',
      'opportunity'
    );
  end if;
end $$;

alter table public.opportunities
  add column if not exists business_type public.opportunity_business_type;

comment on column public.opportunities.business_type is
  'Revenue-reporting category. Maps to SF Opportunity.Type. Five values: new_business / existing_business / existing_business_new_product / existing_business_new_service / opportunity (catch-all). Distinct from kind, which is the sales/renewals workflow split.';

-- ---------------------------------------------------------------------
-- 3. Industry category (controlled vocabulary)
-- ---------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'industry_category') then
    create type public.industry_category as enum (
      -- Healthcare providers
      'hospital',
      'medical_group',
      'fqhc',
      'rural_health_clinic',
      'skilled_nursing',
      'long_term_care',
      'home_health',
      'hospice',
      'behavioral_health',
      'dental',
      'pediatrics',
      'specialty_clinic',
      'urgent_care',
      'imaging_center',
      'lab_services',
      'pharmacy',
      'telemedicine',
      'tribal_health',
      'public_health_agency',
      -- Adjacent / supporting
      'healthcare_it_vendor',
      'managed_service_provider',
      'healthcare_consulting',
      'insurance_payer',
      -- Non-healthcare
      'other_healthcare',
      'other'
    );
  end if;
end $$;

alter table public.accounts
  add column if not exists industry_category public.industry_category;
alter table public.leads
  add column if not exists industry_category public.industry_category;

comment on column public.accounts.industry_category is
  'Curated industry dropdown. Use this for reporting. The legacy free-text industry column is kept for SF import passthrough and edge cases.';

-- ---------------------------------------------------------------------
-- 4. Project segment (customer size / segmentation)
-- ---------------------------------------------------------------------

do $$ begin
  if not exists (select 1 from pg_type where typname = 'project_segment') then
    create type public.project_segment as enum (
      'rural_hospital',
      'community_hospital',
      'enterprise',
      'medium_sized',
      'small_sized',
      'fqhc',
      'voa',
      'franchise',
      'strategic_partner',
      'it_vendor_third_party',
      'independent_associations',
      'other'
    );
  end if;
end $$;

alter table public.accounts
  add column if not exists project_segment public.project_segment;
alter table public.leads
  add column if not exists project_segment public.project_segment;

comment on column public.accounts.project_segment is
  'Customer segmentation dropdown (mirrors SF Account.Project__c). Legacy free-text project column retained for SF import + custom values.';

-- ---------------------------------------------------------------------
-- 5. Account.status auto-derivation
-- ---------------------------------------------------------------------
--
-- Brayden's spec 2026-04-18:
--   - Active = at least one open opp OR at least one closed_won opp
--     whose contract is still in effect (contract_end_date null OR >= today)
--   - Inactive = was a customer (any closed_won in history) but no
--     current open opp + no current contract
--   - A closed_lost on one product doesn't make them inactive if they
--     still have other active products — the rule above handles this
--     automatically because we look for ANY active contract on the
--     account, not most-recent.
--   - Discovery / pending: leave manual values alone unless we have
--     positive evidence to flip. derive returns NULL when no opps exist
--     and the caller preserves whatever the rep set.

create or replace function public.derive_account_status(
  p_account_id uuid
) returns public.account_status
language plpgsql
stable
as $$
declare
  v_has_open_opp boolean;
  v_has_active_contract boolean;
  v_has_any_closed_won boolean;
  v_has_any_opp boolean;
begin
  select exists (
    select 1 from public.opportunities
    where account_id = p_account_id
      and archived_at is null
      and stage not in ('closed_won','closed_lost')
  ) into v_has_open_opp;

  select exists (
    select 1 from public.opportunities
    where account_id = p_account_id
      and archived_at is null
      and stage = 'closed_won'
      and (contract_end_date is null or contract_end_date >= current_date)
  ) into v_has_active_contract;

  if v_has_open_opp or v_has_active_contract then
    return 'active';
  end if;

  select exists (
    select 1 from public.opportunities
    where account_id = p_account_id
      and archived_at is null
      and stage = 'closed_won'
  ) into v_has_any_closed_won;

  if v_has_any_closed_won then
    return 'inactive';
  end if;

  select exists (
    select 1 from public.opportunities
    where account_id = p_account_id
      and archived_at is null
  ) into v_has_any_opp;

  if v_has_any_opp then
    -- Has lost opps but never won — back to discovery.
    return 'discovery';
  end if;

  -- No opps at all — leave whatever the rep set manually.
  return null;
end;
$$;

comment on function public.derive_account_status(uuid) is
  'Compute the appropriate account.status for an account based on its opportunities. Returns NULL when there is no evidence (no opps) so the caller can preserve manually-set discovery/pending values.';

create or replace function public.recompute_account_status_from_opp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acct_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_new_status public.account_status;
begin
  -- Collect every account id touched by this row change. UPDATE that
  -- moves an opp between accounts (rare) needs both old + new.
  if (tg_op = 'INSERT') then
    if new.account_id is not null then
      v_acct_ids := array[new.account_id];
    end if;
  elsif (tg_op = 'UPDATE') then
    if new.account_id is not null then
      v_acct_ids := v_acct_ids || new.account_id;
    end if;
    if old.account_id is not null and old.account_id <> coalesce(new.account_id, '00000000-0000-0000-0000-000000000000'::uuid) then
      v_acct_ids := v_acct_ids || old.account_id;
    end if;
  elsif (tg_op = 'DELETE') then
    if old.account_id is not null then
      v_acct_ids := array[old.account_id];
    end if;
  end if;

  foreach v_id in array v_acct_ids loop
    v_new_status := public.derive_account_status(v_id);
    if v_new_status is not null then
      update public.accounts
      set status = v_new_status,
          updated_at = timezone('utc', now())
      where id = v_id
        and status is distinct from v_new_status;
    end if;
  end loop;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recompute_account_status on public.opportunities;
create trigger trg_recompute_account_status
  after insert or update of stage, account_id, archived_at, contract_end_date
  or delete on public.opportunities
  for each row execute function public.recompute_account_status_from_opp();

-- One-time backfill of every account based on its current opp set.
update public.accounts a
set status = coalesce(public.derive_account_status(a.id), a.status, 'discovery')
where true;

-- ---------------------------------------------------------------------
-- 6. Daily cron-friendly scan for contract expirations
-- ---------------------------------------------------------------------
--
-- A contract expiring today doesn't fire any opp event, so the trigger
-- above won't catch it. This function should be scheduled via pg_cron
-- (e.g. daily at 2am) to re-sweep all accounts and flip status when a
-- contract crossed the expiration line.
create or replace function public.recompute_all_account_statuses()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed integer := 0;
  r record;
  v_new public.account_status;
begin
  for r in
    select id, status from public.accounts where archived_at is null
  loop
    v_new := public.derive_account_status(r.id);
    if v_new is not null and v_new is distinct from r.status then
      update public.accounts
      set status = v_new, updated_at = timezone('utc', now())
      where id = r.id;
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end;
$$;

comment on function public.recompute_all_account_statuses() is
  'Daily sweep: re-derive account.status for every account. Catches contract-expiration transitions that the per-opp trigger cannot. Schedule via pg_cron daily.';

commit;
