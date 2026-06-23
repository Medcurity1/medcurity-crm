-- ============================================================
-- Partners audit fixes (SQL, part 4) — re-assert v_partner_accounts
-- ----------------------------------------------------------------
-- Safety net: 20260623000003's original CREATE OR REPLACE VIEW form
-- could no-op/fail silently on environments where its version was already
-- recorded (the column-order conflict from the appended referring_partner
-- column). This migration unconditionally rebuilds the view via DROP +
-- CREATE so EVERY environment ends up with the member-inclusive definition.
-- Idempotent and safe (only the frontend reads this view).
-- ============================================================

begin;

drop view if exists public.v_partner_accounts;

create view public.v_partner_accounts as
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
    or mc.account_id is not null
    or mem.account_id is not null
  );

comment on view public.v_partner_accounts is
  'Partner-flagged accounts (account_type=Partner, legacy partner_account text, partner_prospect, any account_partners umbrella, OR any member under an umbrella) with member_count + umbrella/member/top_level flags. Powers /partners server-side.';

grant select on public.v_partner_accounts to authenticated;

commit;

notify pgrst, 'reload schema';
