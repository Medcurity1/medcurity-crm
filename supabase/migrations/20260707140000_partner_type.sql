-- ---------------------------------------------------------------------
-- Partner Type (Rachel's request, 2026-07-07): "Ability to distinguish
-- partners" — SF previously had a field identifying the type of partner
-- (Strategic, Referral, etc.); she wants it back, required when a record
-- is marked as a partner, for consistent partner data + reporting/filtering.
--
-- Design:
--   - accounts.partner_type text, values in picklist_options
--     ('accounts.partner_type') so admins can rename/add types in the
--     Admin > Picklists UI without code changes. Starter set = the four
--     she named: Strategic, Referral, Technology, Reseller.
--   - "Required when marked as a partner" is enforced in the account form
--     (conditional on account_type = 'Partner'), NOT as a DB constraint —
--     678 existing partners have no type yet and must stay editable/
--     importable; the form rule cleans them up gradually as they're touched.
--   - The 36 former 'Partner - Alliance' accounts (PointClickCare, Netsmart,
--     MatrixCare … — EHR/software vendors; 20260630000003 folded them into
--     plain 'Partner') are recovered from the audit trail and backfilled as
--     'Technology' — the closest of Rachel's types. Easy to reassign later.
--   - v_partner_accounts is recreated so the new column (and any accounts
--     columns added since its last CREATE, e.g. customer_status) flow
--     through `a.*` to the /partners page. v_marketing_suppression depends
--     on it, so both are dropped and recreated verbatim (suppression logic
--     unchanged from 20260624000008).
-- ---------------------------------------------------------------------

begin;

-- 1. The column. Plain text validated by the picklist UI (same pattern as
--    accounts.partnership_status / accounts.account_type).
alter table public.accounts add column if not exists partner_type text;

-- 2. Rachel's starter types (admin-editable in Admin > Picklists).
insert into public.picklist_options (field_key, value, label, sort_order, is_active)
values
  ('accounts.partner_type', 'Strategic',  'Strategic',  10, true),
  ('accounts.partner_type', 'Referral',   'Referral',   20, true),
  ('accounts.partner_type', 'Technology', 'Technology', 30, true),
  ('accounts.partner_type', 'Reseller',   'Reseller',   40, true)
on conflict (field_key, value)
  do update set label = excluded.label,
                sort_order = excluded.sort_order,
                is_active = true;

-- 3. Recover the former 'Partner - Alliance' accounts from the audit trail.
--    trg_accounts_audit wrote old_data/new_data JSONB for every row the
--    20260630000003 bulk UPDATE touched. Checking new_data too catches any
--    account whose type was SET to alliance and never changed afterward.
update public.accounts a
   set partner_type = 'Technology'
 where a.partner_type is null
   and a.archived_at is null
   and exists (
     select 1
       from public.audit_logs al
      where al.table_name = 'accounts'
        and al.record_id  = a.id
        and ( al.old_data->>'account_type' = 'Partner - Alliance'
           or al.new_data->>'account_type' = 'Partner - Alliance' )
   );

-- 4. Surface Partner Type on the account Detail page, in the existing
--    "Partner Information" section (same idempotent pattern as
--    20260613000002; sort 55 lands it next to Partnership Status).
do $$
declare
  v_layout_id uuid;
  v_section_id uuid;
begin
  select id into v_layout_id from public.page_layouts
    where entity = 'accounts' and name = 'standard';
  if v_layout_id is not null then
    select id into v_section_id from public.page_layout_sections
      where layout_id = v_layout_id and title = 'Partner Information'
      order by sort_order limit 1;
    if v_section_id is not null then
      insert into public.page_layout_fields (section_id, field_key, sort_order, width)
      select v_section_id, 'partner_type', 55, 'half'
      where not exists (
        select 1 from public.page_layout_fields
        where section_id = v_section_id and field_key = 'partner_type');
    end if;
  end if;
end $$;

-- 5. Recreate the partner view so a.* picks up partner_type (and other
--    accounts columns added since 20260624000009). CREATE OR REPLACE can't
--    reorder view columns, so drop + recreate; v_marketing_suppression
--    depends on this view and is dropped/recreated verbatim below.
drop view if exists public.v_marketing_suppression;
drop view if exists public.v_partner_accounts;

create view public.v_partner_accounts
with (security_invoker = on) as
with member_counts as (
  select partner_account_id as account_id, count(*)::int as member_count
  from public.account_partners
  group by partner_account_id
),
members as (
  select distinct member_account_id as account_id
  from public.account_partners
)
select
  a.*,
  coalesce(mc.member_count, 0)        as member_count,
  (mc.account_id is not null)         as is_umbrella,
  (mem.account_id is not null)        as is_member,
  (mc.account_id is not null and mem.account_id is null) as is_top_level,
  up.full_name                        as owner_full_name
from public.accounts a
left join member_counts mc on mc.account_id = a.id
left join members mem       on mem.account_id = a.id
left join public.user_profiles up on up.id = a.owner_user_id
where a.archived_at is null
  and (
    a.account_type ilike 'Partner%'
    or a.partner_account is not null
    or a.partner_prospect = true
    or mc.account_id is not null
    or mem.account_id is not null
  );

comment on view public.v_partner_accounts is
  'Partner-flagged accounts (account_type ILIKE Partner%, legacy partner_account text, partner_prospect, any account_partners umbrella, OR any member under an umbrella) with member_count + umbrella/member/top_level flags + partner_type. Powers /partners server-side.';

grant select on public.v_partner_accounts to authenticated;

-- 6. v_marketing_suppression — verbatim from 20260624000008 (no logic change;
--    recreated only because it depends on v_partner_accounts).
create view public.v_marketing_suppression
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
select 'contact'::text as source_kind, c.id as source_id, 'customer_account'::text as reason,
       c.first_name, c.last_name, c.email, c.account_name as company,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where (c.active_won or c.lifecycle_status = 'customer')
union all
select 'contact', c.id, 'former_customer_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where not (c.active_won or c.lifecycle_status = 'customer')
   and (c.ever_won or c.lifecycle_status = 'former_customer')
union all
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
