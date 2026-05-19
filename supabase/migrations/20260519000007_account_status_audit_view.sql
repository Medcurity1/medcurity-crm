-- Read-only audit view for account.status.
--
-- Why this exists:
--   Renewals are about to be re-enabled. The live function will
--   filter parents through `a.status = 'active'`. `accounts.status`
--   is the SF-equivalent of `Account.Status__c` and uses the enum
--   ('discovery','pending','active','inactive','churned').
--
--   `status` is set manually + by ad-hoc rules, so it can drift out
--   of sync with reality. Surface the four classic mismatches so an
--   admin can fix them BEFORE we add the `status = 'active'` filter
--   to the renewals function:
--
--     1. status='active' but no Closed Won on record.
--     2. status='active' but every Closed Won has expired with no
--        live renewal child.
--     3. status IN ('discovery','pending','inactive','churned') but
--        has an active (unexpired) Closed Won — should be 'active'.
--     4. status='inactive' or 'churned' but has an active Closed Won
--        — they came back, should be 'active'.
--
-- IMPORTANT: this is an AUDIT, not a derivation. We don't auto-flip
-- anyone — surfaces the mismatch only.
--
-- Read-only. Inherits RLS via security_invoker.

begin;

drop view if exists public.v_account_status_audit;

create view public.v_account_status_audit
  with (security_invoker = on)
as
with closed_won_summary as (
  select
    o.account_id,
    count(*)                                                            as closed_won_count,
    max(o.close_date)                                                   as latest_closed_won_date,
    max(o.contract_end_date)                                            as latest_contract_end,
    bool_or(
      o.contract_end_date is null or o.contract_end_date >= current_date
    )                                                                   as has_active_contract,
    bool_or(
      exists (
        select 1 from public.opportunities child
        where child.renewal_from_opportunity_id = o.id
          and child.archived_at is null
          and child.stage not in ('closed_lost')
      )
    )                                                                   as has_any_live_renewal_child
  from public.opportunities o
  where o.archived_at is null
    and o.stage = 'closed_won'
    and coalesce(o.one_time_project, false) = false
  group by o.account_id
),
joined as (
  select
    a.id                                                                as account_id,
    a.name                                                              as account_name,
    a.status::text                                                      as current_status,
    coalesce(cw.closed_won_count, 0)                                    as closed_won_count,
    cw.latest_closed_won_date,
    cw.latest_contract_end,
    coalesce(cw.has_active_contract, false)                             as has_active_contract,
    coalesce(cw.has_any_live_renewal_child, false)                      as has_any_live_renewal_child,
    a.owner_user_id
  from public.accounts a
  left join closed_won_summary cw on cw.account_id = a.id
  where a.archived_at is null
)
-- Case 1: status='active' but no Closed Won at all.
select
  'active_with_no_closed_won'::text                                     as audit_category,
  j.account_id,
  j.account_name,
  j.current_status,
  'discovery or pending'::text                                          as suggested_status,
  j.closed_won_count,
  j.latest_closed_won_date,
  j.latest_contract_end,
  j.has_active_contract,
  j.has_any_live_renewal_child,
  j.owner_user_id,
  'Marked active but no Closed Won on record. Could be a mislabel or migration gap.'::text as notes
from joined j
where j.current_status = 'active'
  and j.closed_won_count = 0

union all

-- Case 2: status='active' but every Closed Won has expired with no
-- live renewal child.
select
  'active_with_expired_contracts'::text,
  j.account_id,
  j.account_name,
  j.current_status,
  'inactive or churned'::text,
  j.closed_won_count,
  j.latest_closed_won_date,
  j.latest_contract_end,
  j.has_active_contract,
  j.has_any_live_renewal_child,
  j.owner_user_id,
  'Marked active but every Closed Won has contract_end_date in the past and no live renewal. Likely churned.'::text
from joined j
where j.current_status = 'active'
  and j.closed_won_count > 0
  and j.has_active_contract = false
  and j.has_any_live_renewal_child = false

union all

-- Case 3: status NOT 'active' (and not 'inactive'/'churned' — handled
-- in case 4) but has an active Closed Won contract.
select
  'non_active_with_live_contract'::text,
  j.account_id,
  j.account_name,
  j.current_status,
  'active'::text,
  j.closed_won_count,
  j.latest_closed_won_date,
  j.latest_contract_end,
  j.has_active_contract,
  j.has_any_live_renewal_child,
  j.owner_user_id,
  'Marked discovery/pending but has an unexpired Closed Won contract. Should be active.'::text
from joined j
where j.current_status in ('discovery', 'pending')
  and j.has_active_contract = true

union all

-- Case 4: status='inactive' or 'churned' but has an active contract.
select
  'churned_with_live_contract'::text,
  j.account_id,
  j.account_name,
  j.current_status,
  'active'::text,
  j.closed_won_count,
  j.latest_closed_won_date,
  j.latest_contract_end,
  j.has_active_contract,
  j.has_any_live_renewal_child,
  j.owner_user_id,
  'Marked inactive/churned but has an unexpired Closed Won contract. They came back; should be active. CRITICAL: renewal filter (status=active) would skip this account.'::text
from joined j
where j.current_status in ('inactive', 'churned')
  and j.has_active_contract = true;

comment on view public.v_account_status_audit is
  'Surfaces accounts whose accounts.status looks wrong relative to deal history. Four categories: active_with_no_closed_won, active_with_expired_contracts, non_active_with_live_contract, churned_with_live_contract. Audit only. Run before re-enabling renewals to prevent silent skips of mislabeled active customers.';

commit;
