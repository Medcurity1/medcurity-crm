-- ============================================================
-- Partners audit fixes (SQL, part 3) — include pure members in the view
-- ----------------------------------------------------------------
-- v_partner_accounts (from 20260623000001) keyed "partner-ness" on being
-- an account_type=Partner, a legacy partner_account/partner_prospect, or
-- an UMBRELLA (has members). It missed accounts that are ONLY a member of
-- someone (under an umbrella but not themselves flagged a partner), so the
-- "Members (under a partner)" filter on /partners under-reported vs the
-- old code (which listed all member accounts). Add the member case.
-- ============================================================

begin;

create or replace view public.v_partner_accounts as
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
    a.account_type = 'Partner'
    or a.partner_account is not null
    or a.partner_prospect = true
    or mc.account_id is not null    -- is an umbrella (has members)
    or mem.account_id is not null   -- is a member (under an umbrella)
  );

comment on view public.v_partner_accounts is
  'Partner-flagged accounts (account_type=Partner, legacy partner_account text, partner_prospect, any account_partners umbrella, OR any account that is a member under an umbrella) with member_count + umbrella/member/top_level flags precomputed. Powers the /partners page server-side.';

commit;

notify pgrst, 'reload schema';
