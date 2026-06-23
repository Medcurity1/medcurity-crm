-- ============================================================
-- v_marketing_suppression — the "Do Not Email" list.
-- Everyone we should SUBTRACT from any marketing/email campaign, each row
-- tagged with WHY (reason). A person appears once PER reason, so the report
-- can be filtered to a single category (e.g. just partners, just do-not-market)
-- and the whole sheet (deduped by email) is the master suppression list.
--
-- Live view (no materialization) so a re-download always reflects current
-- flags. PII (names/emails): security_invoker + granted to authenticated ONLY,
-- never anon (see 20260616000010). Modeled on v_cold_call_contacts.
--
-- NOTE: the leads/imports half is correct today but will go empty once leads
-- are retired (see pulse-leads-removal-plan) — its UNION branch can be dropped
-- cleanly then.
-- ============================================================

begin;

create or replace view public.v_marketing_suppression
with (security_invoker = on) as
with c as (
  select c.id, c.first_name, c.last_name, c.email, c.account_id, c.owner_user_id,
         c.do_not_contact, c.no_longer_employed, c.archived_at,
         a.name as account_name, a.account_type, a.lifecycle_status,
         a.do_not_contact as account_dnc, a.archived_at as account_archived
    from public.contacts c
    left join public.accounts a on a.id = c.account_id
   where c.email is not null and btrim(c.email) <> ''
),
l as (
  select l.id, l.first_name, l.last_name, l.email, l.company, l.owner_user_id,
         l.do_not_market_to, l.do_not_contact, l.avoid_reason, l.archived_at
    from public.leads l
   where l.email is not null and btrim(l.email) <> ''
)
-- ── Contact categories (the people the owner named) ──────────────────────
select 'contact'::text as source_kind, c.id as source_id, 'customer_account'::text as reason,
       c.first_name, c.last_name, c.email, c.account_name as company,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.lifecycle_status = 'customer' and c.account_archived is null
union all
select 'contact', c.id, 'former_customer_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.lifecycle_status = 'former_customer' and c.account_archived is null
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
