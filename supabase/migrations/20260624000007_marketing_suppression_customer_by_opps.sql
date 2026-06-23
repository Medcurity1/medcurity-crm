-- ============================================================
-- v_marketing_suppression — fix the "customer" / "former customer" reasons.
--
-- The first cut (20260624000006) keyed customer-hood off
-- accounts.lifecycle_status ('customer' / 'former_customer'). On staging that
-- column is uniformly 'prospect' — the lifecycle derivation backfill
-- (rebuild-backlog 7.8b / account-status-derivation-spec) hasn't run yet — so
-- BOTH customer reasons returned ZERO rows. That's the single most important
-- bucket for the suppression list ("every contact at a customer account").
--
-- Fix: derive customer-hood from the GROUND-TRUTH signal that actually exists
-- today — a Closed-Won opportunity — using the same active-vs-lapsed rule the
-- Lost Customers (Account-based) report uses (per Brayden 2026-05-29):
--   currently a customer  ⟺  ≥1 closed_won opp whose contract is still live:
--                            contract_end_date >= today  (if set),
--                            else close_date >= today - 365  (assume 1-yr term).
--   former customer        ⟺  had ≥1 closed_won ever, but none still live.
--
-- We OR in the lifecycle_status values too, so this keeps working unchanged
-- AND gets sharper automatically once the lifecycle backfill eventually runs.
-- Customer and former are mutually exclusive (a contact lands in exactly one).
--
-- Everything else (partner / do-not-contact / do-not-market / nle / archived /
-- the leads branch) is unchanged. Same output columns, so the report UI needs
-- no change.
-- ============================================================

begin;

create or replace view public.v_marketing_suppression
with (security_invoker = on) as
with won as (
  -- One row per account that has ever closed-won, with whether ANY of those
  -- closed-won deals is still in-contract (= the account is a current customer).
  select o.account_id,
         bool_or(
           (o.contract_end_date is not null and o.contract_end_date >= current_date)
           or (o.contract_end_date is null and o.close_date is not null
               and o.close_date >= current_date - 365)
         ) as active_won
    from public.opportunities o
   where o.stage = 'closed_won'
     and o.archived_at is null
     and o.account_id is not null
   group by o.account_id
),
c as (
  select c.id, c.first_name, c.last_name, c.email, c.account_id, c.owner_user_id,
         c.do_not_contact, c.no_longer_employed, c.archived_at,
         a.name as account_name, a.account_type, a.lifecycle_status,
         a.do_not_contact as account_dnc, a.archived_at as account_archived,
         (w.account_id is not null)       as ever_won,
         coalesce(w.active_won, false)     as active_won
    from public.contacts c
    left join public.accounts a on a.id = c.account_id
    left join won w on w.account_id = c.account_id
   where c.email is not null and btrim(c.email) <> ''
),
l as (
  select l.id, l.first_name, l.last_name, l.email, l.company, l.owner_user_id,
         l.do_not_market_to, l.do_not_contact, l.avoid_reason, l.archived_at
    from public.leads l
   where l.email is not null and btrim(l.email) <> ''
)
-- ── Contact categories (the people the owner named) ──────────────────────
-- Current customer: any live closed-won contract (or lifecycle says so).
select 'contact'::text as source_kind, c.id as source_id, 'customer_account'::text as reason,
       c.first_name, c.last_name, c.email, c.account_name as company,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where (c.active_won or c.lifecycle_status = 'customer')
   and c.account_archived is null
union all
-- Former customer: bought before, nothing live now (and NOT a current customer).
select 'contact', c.id, 'former_customer_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where not (c.active_won or c.lifecycle_status = 'customer')
   and (c.ever_won or c.lifecycle_status = 'former_customer')
   and c.account_archived is null
union all
select 'contact', c.id, 'partner_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where c.account_id is not null
   and exists (select 1 from public.v_partner_accounts vpa where vpa.id = c.account_id)
union all
select 'contact', c.id, 'contact_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.do_not_contact = true
union all
select 'contact', c.id, 'account_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.account_dnc = true and c.account_archived is null
union all
select 'contact', c.id, 'contact_no_longer_employed',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.no_longer_employed = true
union all
select 'contact', c.id, 'contact_archived',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.archived_at is not null
-- ── Lead / import categories (live today; retire with leads) ─────────────
union all
select 'lead', l.id, 'lead_do_not_market',
       l.first_name, l.last_name, l.email, l.company,
       null::uuid, null::text, null::public.account_lifecycle, l.owner_user_id
  from l where l.do_not_market_to = true
union all
select 'lead', l.id, 'lead_do_not_contact',
       l.first_name, l.last_name, l.email, l.company,
       null::uuid, null::text, null::public.account_lifecycle, l.owner_user_id
  from l where l.do_not_contact = true
union all
select 'lead', l.id, 'lead_avoid',
       l.first_name, l.last_name, l.email, l.company,
       null::uuid, null::text, null::public.account_lifecycle, l.owner_user_id
  from l where l.avoid_reason is not null
union all
select 'lead', l.id, 'lead_archived',
       l.first_name, l.last_name, l.email, l.company,
       null::uuid, null::text, null::public.account_lifecycle, l.owner_user_id
  from l where l.archived_at is not null;

grant select on public.v_marketing_suppression to authenticated;
-- explicitly NOT granted to anon (PII).

commit;

notify pgrst, 'reload schema';
