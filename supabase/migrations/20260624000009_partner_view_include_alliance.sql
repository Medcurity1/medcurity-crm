-- ============================================================
-- v_partner_accounts — include 'Partner - Alliance' accounts.
--
-- The view recognized partners by account_type = 'Partner' EXACTLY, so the 36
-- 'Partner - Alliance' accounts (PointClickCare, Netsmart, MatrixCare, Medhost,
-- SoftwareONE … — EHR/software alliance partners) never appeared on the
-- /partners page unless they happened to carry a legacy partner_account /
-- partner_prospect flag (only 1 did). Broaden the type match to ILIKE 'Partner%'
-- so it catches BOTH 'Partner' and 'Partner - Alliance'. (The only two
-- partner-prefixed account_types — 714 accounts total.)
--
-- 'Referral' is intentionally NOT matched: those are medical practices acquired
-- via a referral channel (prospects/customers), not referral partners.
--
-- Uses CREATE OR REPLACE (not DROP) because v_marketing_suppression depends on
-- this view — a DROP would cascade. Column list/order is unchanged, and we
-- re-assert security_invoker = on (set in 20260623000006) so the PII-safe RLS
-- posture is preserved. Idempotent and read-only-safe (only the /partners page
-- and the Do-Not-Email report read this view).
-- ============================================================

begin;

create or replace view public.v_partner_accounts
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
    a.account_type ilike 'Partner%'   -- 'Partner' AND 'Partner - Alliance'
    or a.partner_account is not null
    or a.partner_prospect = true
    or mc.account_id is not null
    or mem.account_id is not null
  );

comment on view public.v_partner_accounts is
  'Partner-flagged accounts (account_type ILIKE Partner% [Partner + Partner - Alliance], legacy partner_account text, partner_prospect, any account_partners umbrella, OR any member under an umbrella) with member_count + umbrella/member/top_level flags. Powers /partners server-side.';

grant select on public.v_partner_accounts to authenticated;

commit;

notify pgrst, 'reload schema';
