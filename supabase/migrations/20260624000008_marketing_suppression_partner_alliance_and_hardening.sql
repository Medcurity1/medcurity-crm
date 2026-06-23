-- ============================================================
-- v_marketing_suppression — accuracy audit fixes (2026-06-23).
--
-- A live-data audit of who could be WRONGLY emailed (false negatives — the
-- dangerous direction for a suppression list) found one real leak plus two
-- latent gaps worth closing now:
--
-- 1) REAL LEAK — alliance partners not suppressed.
--    The partner reason keyed off v_partner_accounts, which matches
--    account_type = 'Partner' EXACTLY. But Medcurity also has 36
--    account_type = 'Partner - Alliance' accounts (PointClickCare, Netsmart,
--    MatrixCare, Medhost, SoftwareONE … — EHR/software alliance partners) and
--    only 1 of them was otherwise partner-flagged. Result: ~93 partner contacts
--    were missing from the list. Fix: the partner reason now ALSO matches any
--    account whose account_type starts with 'Partner' (covers 'Partner' and
--    'Partner - Alliance'; the only two partner-prefixed types — 714 accounts).
--    NOTE: 'Referral' accounts were deliberately NOT included — those are
--    medical practices acquired via a referral channel (prospects/customers,
--    not partners); the customers among them are already caught by the
--    customer reason, and the prospects must stay e-mailable.
--
-- 2) HARDENING — secondary emails (0 rows affected today, future-proofing).
--    Contacts can carry email2/email3. Currently unused (0 of 8,106 populated),
--    but if a customer/partner's secondary email is ever used in a campaign it
--    would leak. The contact source now emits one suppression row PER non-empty
--    email (email/email2/email3), so all of a person's addresses are covered.
--
-- 3) HARDENING — stop excluding archived accounts (0 rows affected today).
--    The customer/former/account-DNC reasons excluded contacts whose account is
--    archived. For a suppression list that's the wrong way to err. Removed —
--    over-suppressing an archived-account contact is harmless; missing one is
--    not. (1 archived account today, with 0 e-mailable contacts.)
--
-- Everything else is unchanged. Customer-hood still derives from closed_won
-- opportunities (see 20260624000007). PII: security_invoker + authenticated
-- only, never anon.
-- ============================================================

begin;

create or replace view public.v_marketing_suppression
with (security_invoker = on) as
with won as (
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
  -- One row per contact PER non-empty email (email / email2 / email3), so a
  -- person is suppressed at every address they hold. Contacts with no usable
  -- email produce no rows (the lateral returns nothing).
  select c.id, c.first_name, c.last_name, em.email, c.account_id, c.owner_user_id,
         c.do_not_contact, c.no_longer_employed, c.archived_at,
         a.name as account_name, a.account_type, a.lifecycle_status,
         a.do_not_contact as account_dnc, a.archived_at as account_archived,
         (w.account_id is not null)       as ever_won,
         coalesce(w.active_won, false)     as active_won
    from public.contacts c
    left join public.accounts a on a.id = c.account_id
    left join won w on w.account_id = c.account_id
    cross join lateral (
      select e as email
        from unnest(array[
          nullif(btrim(c.email), ''),
          nullif(btrim(c.email2), ''),
          nullif(btrim(c.email3), '')
        ]) as e
       where e is not null
    ) em
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
union all
-- Former customer: bought before, nothing live now (and NOT a current customer).
select 'contact', c.id, 'former_customer_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where not (c.active_won or c.lifecycle_status = 'customer')
   and (c.ever_won or c.lifecycle_status = 'former_customer')
union all
-- Partner: the canonical partner view OR any 'Partner%' account_type
-- (catches 'Partner' AND 'Partner - Alliance').
select 'contact', c.id, 'partner_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where c.account_id is not null
   and (
        exists (select 1 from public.v_partner_accounts vpa where vpa.id = c.account_id)
        or c.account_type ilike 'Partner%'
       )
union all
select 'contact', c.id, 'contact_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.do_not_contact = true
union all
select 'contact', c.id, 'account_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.account_dnc = true
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
