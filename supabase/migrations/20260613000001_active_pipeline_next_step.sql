-- Add Next Step to the Active Pipeline standard report.
--
-- Request #13 (Jordan/Molly): the Active Pipeline report groups open
-- opportunities by stage but doesn't show each opp's Next Step, while the
-- Lost Customers report (v_lost_customers_qtd) already does. Managers want
-- the same at-a-glance Next Step on the open pipeline.
--
-- Re-emits v_active_pipeline from 20260424000001 with one new column
-- (o.next_step) APPENDED at the end. CREATE OR REPLACE VIEW only permits
-- adding columns at the tail, which is exactly what this does, so existing
-- readers are unaffected (the dashboard rollup in 20260506000001 selects
-- only count/amount/weighted_amount, never *). The grant from
-- 20260424000002 persists across CREATE OR REPLACE.

create or replace view public.v_active_pipeline as
select
  o.id,
  o.stage,
  case o.kind
    when 'new_business' then 'New Business'
    when 'renewal'      then 'Existing Business'
    else ''
  end                                as type,
  o.name                             as opportunity_name,
  a.name                             as account_name,
  o.close_date,
  o.amount,
  o.probability,
  (o.amount * coalesce(o.probability, 0) / 100.0)::numeric(14, 2) as weighted_amount,
  coalesce(u.full_name, 'Unassigned') as opportunity_owner,
  o.account_id,
  o.owner_user_id,
  o.next_step
from public.opportunities o
join public.accounts a on a.id = o.account_id
left join public.user_profiles u on u.id = o.owner_user_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage not in ('closed_won', 'closed_lost');

comment on view public.v_active_pipeline is
  'Open opportunities (not Closed Won or Closed Lost). SF "Active Pipeline" report. Includes next_step (added 2026-06-13).';
