-- ============================================================
-- Phase 1 schema additions per docs/migration/rebuild-backlog.md
-- Date: 2026-04-17
--
-- Adds missing fields that SF has on Contact + Lead but staging
-- doesn't yet. Also adds:
--   - accounts.do_not_auto_renew: manual override while renewal_type
--     data is unreliable. See migration/open-questions.md Q7.
--   - opportunities.renewal_cycle_pattern: cleaner replacement for
--     the confusing "every_other_year" boolean on accounts.
--   - renewal automation honors do_not_auto_renew.
-- ============================================================

begin;

-- ============================================================
-- 1. New enums
-- ============================================================

-- Professional credential (medical + compliance + exec titles)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'credential_type') then
    create type public.credential_type as enum (
      'md', 'do', 'rn', 'lpn', 'np', 'pa',
      'chc', 'chps', 'chpc', 'hipaa_certified',
      'ceo', 'cfo', 'coo', 'cio', 'cto', 'ciso', 'cmo',
      'it_director', 'practice_manager', 'office_manager',
      'compliance_officer', 'privacy_officer', 'security_officer',
      'other'
    );
  end if;
end $$;

-- US time zones used for scheduling (matches Account.timezone idea but as enum)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'us_time_zone') then
    create type public.us_time_zone as enum (
      'eastern', 'central', 'mountain', 'pacific',
      'alaska', 'hawaii', 'arizona_no_dst'
    );
  end if;
end $$;

-- Contact role category
do $$ begin
  if not exists (select 1 from pg_type where typname = 'contact_type') then
    create type public.contact_type as enum (
      'prospect', 'customer', 'partner', 'vendor',
      'referral_source', 'internal', 'other'
    );
  end if;
end $$;

-- Lead origin/type category
do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_type') then
    create type public.lead_type as enum (
      'inbound_website', 'inbound_referral',
      'outbound_cold', 'purchased_list',
      'conference', 'webinar',
      'partner', 'existing_customer_expansion',
      'other'
    );
  end if;
end $$;

-- Relationship tag for contacts + leads (decision maker, champion, etc.)
do $$ begin
  if not exists (select 1 from pg_type where typname = 'business_relationship_tag') then
    create type public.business_relationship_tag as enum (
      'decision_maker', 'influencer', 'economic_buyer',
      'technical_buyer', 'champion', 'detractor',
      'end_user', 'gatekeeper',
      'executive_sponsor', 'other'
    );
  end if;
end $$;

-- Renewal cycle pattern for opportunities. Replaces the confusing
-- account-level "every_other_year" boolean with opp-level clarity.
-- See docs/migration/open-questions.md Q8 for naming rationale.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'renewal_cycle_pattern') then
    create type public.renewal_cycle_pattern as enum (
      'annual',                        -- simple 1-year recurring
      'three_year',                    -- 3-year contract, same amount each year
      'years_1_and_3_services',        -- 3-year: services Y1 and Y3, platform-only Y2
      'year_2_services_only',          -- 3-year: services only Y2
      'one_time'                       -- no renewal expected
    );
  end if;
end $$;

-- ============================================================
-- 2. Contacts — add missing SF-parity fields
-- ============================================================

alter table public.contacts
  add column if not exists credential public.credential_type,
  add column if not exists phone_ext text,
  add column if not exists time_zone public.us_time_zone,
  add column if not exists type public.contact_type,
  add column if not exists business_relationship_tag public.business_relationship_tag,
  add column if not exists events_attended text[],
  add column if not exists notes text,
  add column if not exists next_steps text;

comment on column public.contacts.credential is
  'Professional credential (MD, RN, CHC, etc.). From SF Contact Credential picklist.';
comment on column public.contacts.phone_ext is
  'Extension for the primary phone number.';
comment on column public.contacts.time_zone is
  'Contact local time zone, for call scheduling.';
comment on column public.contacts.type is
  'Role category (prospect, customer, partner, referral_source, etc.).';
comment on column public.contacts.business_relationship_tag is
  'Relationship-to-deal tag (decision maker, champion, detractor, etc.).';
comment on column public.contacts.events_attended is
  'List of Medcurity events/webinars this contact has attended.';
comment on column public.contacts.notes is
  'Free-form notes about the contact. Append-only log preferred.';
comment on column public.contacts.next_steps is
  'Next planned action with this contact (follow-up call, demo, etc.).';

-- ============================================================
-- 3. Leads — add missing SF-parity fields + cold_lead flag
-- ============================================================

alter table public.leads
  add column if not exists credential public.credential_type,
  add column if not exists phone_ext text,
  add column if not exists time_zone public.us_time_zone,
  add column if not exists type public.lead_type,
  add column if not exists priority_lead boolean not null default false,
  add column if not exists project text,
  add column if not exists business_relationship_tag public.business_relationship_tag,
  add column if not exists linkedin_url text,
  add column if not exists cold_lead boolean not null default false,
  add column if not exists cold_lead_source text;

comment on column public.leads.priority_lead is
  'High-priority lead that needs immediate sales attention.';
comment on column public.leads.project is
  'What project/initiative this lead is interested in (SRA, HIPAA cert, etc.).';
comment on column public.leads.cold_lead is
  'Marked true for leads imported from purchased lists (Cold Call SMB, Athena List, etc.). Used to exclude from active pipeline dashboards while preserving records for email-bounce validation before deletion.';
comment on column public.leads.cold_lead_source is
  'Which purchased list the cold lead came from (e.g. "Cold Call SMB", "Athena List", "eClinicalWorks List", "Medibeat").';

-- Partial indexes: the common filter is "active non-cold" or "priority".
create index if not exists idx_leads_cold_lead
  on public.leads (cold_lead) where cold_lead = true;
create index if not exists idx_leads_priority_lead
  on public.leads (priority_lead) where priority_lead = true;

-- ============================================================
-- 4. Accounts — do_not_auto_renew manual override
-- ============================================================

alter table public.accounts
  add column if not exists do_not_auto_renew boolean not null default false;

comment on column public.accounts.do_not_auto_renew is
  'Manual override to suppress renewal automation for this account regardless of renewal_type. Use when we have confirmed no auto-renewal is desired but renewal_type data is unreliable. See migration open-question Q7.';

-- ============================================================
-- 5. Opportunities — renewal_cycle_pattern
-- ============================================================

alter table public.opportunities
  add column if not exists renewal_cycle_pattern public.renewal_cycle_pattern;

comment on column public.opportunities.renewal_cycle_pattern is
  'How this opp recurs. Replaces the confusing account-level every_other_year boolean with opp-level clarity. Nullable during rollout; should be set on new closed_won deals going forward.';

-- ============================================================
-- 6. Update renewal automation to honor do_not_auto_renew
-- ============================================================

create or replace function public.generate_upcoming_renewals(
  triggered_by text default 'cron'
)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_config        public.renewal_automation_config%rowtype;
  v_parent        record;
  v_new_opp_id    uuid;
  v_new_start     date;
  v_new_end       date;
  v_new_close     date;
  v_new_name      text;
  v_new_year      integer;
  v_new_cycle     integer;
  v_months_offset integer;
  v_created       integer := 0;
  v_skipped       integer := 0;
  v_run_id        bigint;
  v_err           text;
  v_effective_end date;
begin
  select * into v_config from public.renewal_automation_config where id = 1;

  if not found or not v_config.enabled then
    return query select 0, 0;
    return;
  end if;

  insert into public.renewal_automation_runs (triggered_by)
  values (coalesce(triggered_by, 'cron'))
  returning id into v_run_id;

  begin
    for v_parent in
      select
        o.*,
        a.renewal_type    as account_renewal_type,
        a.every_other_year as account_every_other_year,
        a.do_not_auto_renew as account_do_not_auto_renew,
        coalesce(
          o.contract_end_date,
          (o.close_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
        ) as effective_end_date
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.stage = 'closed_won'
        and coalesce(
              o.contract_end_date,
              (o.close_date + (coalesce(o.contract_length_months, 12) || ' months')::interval)::date
            ) between current_date
                  and current_date + (v_config.lookahead_days || ' days')::interval
        and (o.contract_end_date is not null or o.close_date is not null)
        and coalesce(a.renewal_type::text, 'manual_renew') <> 'no_auto_renew'
        -- NEW: honor manual do_not_auto_renew override on account
        and coalesce(a.do_not_auto_renew, false) = false
        and coalesce(o.one_time_project, false) = false
        and coalesce(o.renewal_cycle_pattern::text, 'annual') <> 'one_time'
        and not exists (
          select 1 from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
            and child.archived_at is null
        )
    loop
      v_effective_end := v_parent.effective_end_date;

      if v_parent.account_every_other_year then
        if coalesce(v_parent.cycle_count, 0) % 2 = 1 then
          v_skipped := v_skipped + 1;
          continue;
        end if;
      end if;

      v_months_offset := 12;
      v_new_year := null;
      v_new_cycle := coalesce(v_parent.cycle_count, 1);

      if coalesce(v_parent.contract_length_months, 12) = 36 then
        case coalesce(v_parent.contract_year, 1)
          when 1 then
            v_new_year := 2;
            -- 3-year first-cycle Year-1 → Year-2: pull back 1 month
            -- so reminders fire ~30 days before the natural anniversary.
            -- Matches SF flow logic (verified by Brayden 2026-04-16).
            if v_new_cycle = 1 then
              v_months_offset := 11;
            end if;
          when 2 then
            v_new_year := 3;
          when 3 then
            v_new_year := 1;
            v_new_cycle := v_new_cycle + 1;
          else
            v_new_year := 1;
        end case;
      else
        v_new_year := 1;
        v_new_cycle := v_new_cycle + 1;
      end if;

      v_new_start := v_effective_end + interval '1 day';
      v_new_end   := (v_effective_end + (v_months_offset || ' months')::interval)::date;
      v_new_close := v_effective_end;

      if extract(month from v_effective_end) = 2
         and extract(day from v_effective_end) = 29
      then
        v_new_end := make_date(
          extract(year from v_new_end)::int,
          3,
          1
        );
      end if;

      if v_parent.contract_end_date is null then
        update public.opportunities
        set contract_end_date = v_effective_end
        where id = v_parent.id;
      end if;

      v_new_name := v_parent.name || ' (Renewal ' || to_char(v_new_start, 'YYYY') || ')';

      insert into public.opportunities (
        name,
        account_id,
        primary_contact_id,
        owner_user_id,
        original_sales_rep_id,
        assigned_assessor_id,
        team,
        kind,
        stage,
        amount,
        service_amount,
        product_amount,
        services_included,
        service_description,
        discount,
        payment_frequency,
        promo_code,
        contract_start_date,
        contract_end_date,
        contract_length_months,
        contract_year,
        cycle_count,
        renewal_cycle_pattern,
        expected_close_date,
        renewal_from_opportunity_id,
        auto_renewal,
        fte_range,
        fte_count,
        lead_source,
        created_by_automation,
        notes
      )
      values (
        v_new_name,
        v_parent.account_id,
        v_parent.primary_contact_id,
        coalesce(v_parent.assigned_assessor_id, v_parent.owner_user_id),
        v_parent.owner_user_id,
        v_parent.assigned_assessor_id,
        'renewals',
        'renewal',
        'lead',
        v_parent.amount,
        coalesce(v_parent.service_amount, 0),
        coalesce(v_parent.product_amount, 0),
        coalesce(v_parent.services_included, true),
        v_parent.service_description,
        v_parent.discount,
        v_parent.payment_frequency,
        v_parent.promo_code,
        v_new_start,
        v_new_end,
        v_parent.contract_length_months,
        v_new_year,
        v_new_cycle,
        v_parent.renewal_cycle_pattern,
        v_new_close,
        v_parent.id,
        true,
        v_parent.fte_range,
        v_parent.fte_count,
        v_parent.lead_source,
        true,
        format(
          'Auto-generated renewal from %s (contract end %s). Year %s, cycle %s.',
          v_parent.name,
          to_char(v_effective_end, 'YYYY-MM-DD'),
          coalesce(v_new_year::text, '1'),
          coalesce(v_new_cycle::text, '1')
        )
      )
      returning id into v_new_opp_id;

      insert into public.opportunity_products (
        opportunity_id, product_id, quantity, unit_price, discount_percent, total_price
      )
      select
        v_new_opp_id, product_id, quantity, unit_price, discount_percent, total_price
      from public.opportunity_products
      where opportunity_id = v_parent.id;

      v_created := v_created + 1;
    end loop;

    update public.renewal_automation_runs
    set finished_at = timezone('utc', now()),
        created_count = v_created,
        skipped_count = v_skipped
    where id = v_run_id;

    update public.renewal_automation_config
    set last_run_at = timezone('utc', now()),
        last_run_created_count = v_created,
        last_run_error = null,
        updated_at = timezone('utc', now())
    where id = 1;

  exception when others then
    v_err := sqlerrm;
    update public.renewal_automation_runs
    set finished_at = timezone('utc', now()),
        created_count = v_created,
        skipped_count = v_skipped,
        error_message = v_err
    where id = v_run_id;

    update public.renewal_automation_config
    set last_run_at = timezone('utc', now()),
        last_run_created_count = v_created,
        last_run_error = v_err,
        updated_at = timezone('utc', now())
    where id = 1;
    raise;
  end;

  return query select v_created, v_skipped;
end;
$fn$;

commit;
