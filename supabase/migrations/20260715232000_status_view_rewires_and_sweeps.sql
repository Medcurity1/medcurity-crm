-- ---------------------------------------------------------------------
-- Account Status Restructure, Step 2b — remaining readers of the
-- retiring fields move to customer_status, plus stored-data sweeps.
--
-- 1. v_lost_customers_qtd: the QTD churn view filtered on
--    lifecycle_status = 'former_customer', which is uniformly 'prospect'
--    in real data — the Lost Customers tile and v_dashboard_metrics'
--    lost_customers_qtd have shown ~0 since April. Filter moves to
--    customer_status = 'former_client' (real churn definition). SAME
--    output shape (CREATE OR REPLACE; the account_status column keeps
--    sourcing lifecycle_status until the Step 3 chain rebuild, since
--    changing its TYPE would cascade into v_dashboard_metrics).
--    EXPECT the tile to move from 0 to real values.
-- 2. v_renewal_audit: two account-level categories filtered on
--    lifecycle_status = 'customer' (matched nothing). Re-emitted
--    verbatim from 20260511000002 with customer_status sources; the
--    exposed column KEEPS the name lifecycle_status (union shape) but
--    now carries client/prospect/former_client values.
-- 3. v_accounts_status_unset: data-health view for the retiring status
--    field; no frontend consumer — dropped.
-- 4. find_renewal_backfill_anchor(): one-shot diagnostic mirroring the
--    OLD renewal gate (a.status='active'); no consumer — dropped.
-- 5. saved_reports sweep: rewrite accounts-report configs that reference
--    the retiring columns (lifecycle_status → customer_status,
--    status → sales_status) so saved reports keep working after Step 3
--    drops the columns (2 rows on staging; defensive for prod).
-- 6. automation_rules: deactivate the vestigial "Closed Won -> Active
--    Account" quick-start rule (its executor/UI action types never
--    matched, so it has always been a no-op; its action targets
--    lifecycle_status and would dangle after Step 3). The real Closed
--    Won behavior lives in the customer_status derivation triggers.
-- 7. page_layout_fields: remove status / lifecycle_status placements
--    from ACCOUNTS layouts only (leads keep their own unrelated status
--    field) so detail pages don't render dead fields after Step 3.
-- ---------------------------------------------------------------------

begin;

-- 1. Lost Customers QTD — real churn filter --------------------------------
create or replace view public.v_lost_customers_qtd as
select
  o.id,
  a.name                             as account_name,
  o.name                             as opportunity_name,
  o.stage,
  a.lifecycle_status                 as account_status,
  public.fiscal_period_label(o.close_date) as fiscal_period,
  o.amount,
  o.probability,
  case
    when o.close_date is not null then (current_date - o.close_date)
    else (current_date - o.created_at::date)
  end                                as age,
  o.close_date,
  o.created_at::date                 as created_date,
  o.next_step,
  o.lead_source,
  case o.kind
    when 'new_business' then 'New Business'
    when 'renewal'      then 'Existing Business'
    else ''
  end                                as type,
  o.account_id
from public.opportunities o
join public.accounts a on a.id = o.account_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage = 'closed_lost'
  and o.kind = 'renewal'
  and a.customer_status = 'former_client'
  and o.close_date between public.current_fiscal_quarter_start()
                       and public.current_fiscal_quarter_end();

comment on view public.v_lost_customers_qtd is
  'Existing Business closed-lost in the current fiscal quarter on former-client accounts (customer_status). Dashboard churn metric. account_status column still sources lifecycle_status pending the Step 3 chain rebuild.';

-- 2. v_renewal_audit — re-emitted from 20260511000002 with customer_status
drop view if exists public.v_renewal_audit;

create view public.v_renewal_audit
  with (security_invoker = on)
as
with cfg as (
  select
    coalesce(lookahead_days, 120) as lookahead_days,
    test_account_id
  from public.renewal_automation_config
  where id = 1
),
closed_wons as (
  select
    o.id                         as opportunity_id,
    o.account_id,
    o.name                       as opportunity_name,
    o.stage,
    o.close_date,
    o.expected_close_date,
    o.contract_start_date,
    o.contract_end_date,
    o.contract_length_months,
    o.contract_year,
    o.cycle_count,
    o.one_time_project,
    a.name                       as account_name,
    a.customer_status as lifecycle_status,
    a.renewal_type,
    a.auto_renew,
    a.every_other_year,
    a.do_not_auto_renew,
    -- New anchor: parent.close_date + 12 months. Renamed in the
    -- output column from effective_end_date for clarity; we'll keep
    -- the column name on the view though so the UI doesn't break.
    case
      when o.close_date is null then null
      else (o.close_date + interval '12 months')::date
    end                          as effective_end_date,
    exists (
      select 1
      from public.opportunities child
      where child.renewal_from_opportunity_id = o.id
        and child.archived_at is null
    ) as has_live_renewal
  from public.opportunities o
  join public.accounts a on a.id = o.account_id
  cross join cfg
  where o.archived_at is null
    and a.archived_at is null
    and o.stage = 'closed_won'
    and (o.close_date is null or o.close_date >= current_date - interval '18 months')
    and (cfg.test_account_id is null or a.id = cfg.test_account_id)
)
-- 1. WILL be created on the next run.
select
  'missing_renewal'::text                              as audit_category,
  cw.opportunity_id                                    as parent_opportunity_id,
  cw.account_id,
  cw.account_name,
  cw.opportunity_name,
  cw.close_date,
  cw.contract_end_date,
  cw.effective_end_date,
  cw.contract_length_months,
  cw.contract_year,
  cw.cycle_count,
  cw.lifecycle_status::text                            as lifecycle_status,
  cw.renewal_type::text                                as renewal_type,
  cw.auto_renew,
  cw.every_other_year,
  cw.do_not_auto_renew,
  format(
    'Anniversary %s — inside the %s-day lookahead. Will be created on the next run.',
    to_char(cw.effective_end_date, 'YYYY-MM-DD'),
    (select lookahead_days from cfg)::text
  )::text                                              as note
from closed_wons cw, cfg
where cw.has_live_renewal = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date >= current_date
  and cw.effective_end_date <= current_date + (cfg.lookahead_days || ' days')::interval

union all

-- 2. Past-due closed-wons whose anniversary has already passed without
-- a child renewal. Outside the automation window — needs manual
-- backfill or a lookahead extension.
select
  'past_due_no_renewal'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  format(
    'Anniversary %s — already past. Outside automation window. Backfill manually or extend lookahead_days.',
    to_char(cw.effective_end_date, 'YYYY-MM-DD')
  )::text
from closed_wons cw
where cw.has_live_renewal = false
  and coalesce(cw.one_time_project, false) = false
  and coalesce(cw.do_not_auto_renew, false) = false
  and cw.effective_end_date is not null
  and cw.effective_end_date < current_date

union all

select
  'missing_dates'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  'Closed-won opp has no close_date — automation cannot determine the anniversary.'::text
from closed_wons cw
where cw.close_date is null

union all

select
  'missing_contract_year'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  '36-month contract without contract_year set — cycle walk (1→2→3→1) cannot start. Set contract_year on the parent opp.'::text
from closed_wons cw
where cw.contract_length_months = 36
  and cw.contract_year is null

union all

select
  'every_other_year_skip'::text,
  cw.opportunity_id, cw.account_id, cw.account_name, cw.opportunity_name,
  cw.close_date, cw.contract_end_date, cw.effective_end_date,
  cw.contract_length_months, cw.contract_year, cw.cycle_count,
  cw.lifecycle_status::text, cw.renewal_type::text,
  cw.auto_renew, cw.every_other_year, cw.do_not_auto_renew,
  'Account is every_other_year and current cycle_count is odd — automation will skip this year by design.'::text
from closed_wons cw
where cw.every_other_year = true
  and coalesce(cw.cycle_count, 0) % 2 = 1
  and cw.has_live_renewal = false

union all

select
  'auto_renew_null'::text,
  null::uuid, a.id, a.name, null::text,
  null::date, null::date, null::date,
  null::integer, null::integer, null::integer,
  a.customer_status::text, a.renewal_type::text,
  a.auto_renew, a.every_other_year, a.do_not_auto_renew,
  'Account has no auto_renew value (renewal_type was NULL or unmapped). Automation falls back to non-auto-renew; admin should confirm.'::text
from public.accounts a
cross join cfg
where a.archived_at is null
  and a.auto_renew is null
  and a.customer_status = 'client'
  and (cfg.test_account_id is null or a.id = cfg.test_account_id)

union all

select
  'do_not_auto_renew'::text,
  null::uuid, a.id, a.name, null::text,
  null::date, null::date, null::date,
  null::integer, null::integer, null::integer,
  a.customer_status::text, a.renewal_type::text,
  a.auto_renew, a.every_other_year, a.do_not_auto_renew,
  'Account flagged do_not_auto_renew — automation will skip all renewals on this account regardless of auto_renew.'::text
from public.accounts a
cross join cfg
where a.archived_at is null
  and a.do_not_auto_renew = true
  and a.customer_status = 'client'
  and (cfg.test_account_id is null or a.id = cfg.test_account_id);

comment on view public.v_renewal_audit is
  'Surfaces closed-won opps and accounts and what the renewal automation will do with them on the next run. Anchored on parent.close_date + 12 months. Honors renewal_automation_config.test_account_id. Seven audit_category values.';

-- 3. Retiring-status data-health view: no consumers ------------------------
drop view if exists public.v_accounts_status_unset;

-- 4. Stale diagnostic mirroring the OLD renewal gate -----------------------
drop function if exists public.find_renewal_backfill_anchor();

-- 5. Saved-reports sweep: keep saved account reports working ---------------
-- Rewrites column keys and any filter/group_by references. Idempotent.
update public.saved_reports
   set config = jsonb_set(
         config,
         '{columns}',
         (
           select coalesce(jsonb_agg(
             case col
               when '"lifecycle_status"'::jsonb then '"customer_status"'::jsonb
               when '"status"'::jsonb           then '"sales_status"'::jsonb
               else col
             end), '[]'::jsonb)
           from jsonb_array_elements(config->'columns') as col
         )
       )
 where config->>'entity' = 'accounts'
   and (config->'columns') ? 'lifecycle_status'
    or config->>'entity' = 'accounts' and (config->'columns') ? 'status';

update public.saved_reports
   set config = jsonb_set(
         config,
         '{filters}',
         (
           select coalesce(jsonb_agg(
             case f->>'field'
               when 'lifecycle_status' then jsonb_set(f, '{field}', '"customer_status"')
               when 'status'           then jsonb_set(f, '{field}', '"sales_status"')
               else f
             end), '[]'::jsonb)
           from jsonb_array_elements(config->'filters') as f
         )
       )
 where config->>'entity' = 'accounts'
   and jsonb_typeof(config->'filters') = 'array'
   and exists (
     select 1 from jsonb_array_elements(config->'filters') as f
     where f->>'field' in ('lifecycle_status', 'status')
   );

update public.saved_reports
   set config = jsonb_set(config, '{group_by}',
         case config->>'group_by'
           when 'lifecycle_status' then '"customer_status"'::jsonb
           else '"sales_status"'::jsonb
         end)
 where config->>'entity' = 'accounts'
   and config->>'group_by' in ('lifecycle_status', 'status');

-- 6. Vestigial quick-start rule targeting lifecycle_status -----------------
update public.automation_rules
   set is_active = false
 where actions @> '[{"entity":"accounts","field":"lifecycle_status"}]'::jsonb;

-- 7. Dead field placements on ACCOUNTS detail layouts ----------------------
delete from public.page_layout_fields plf
 using public.page_layout_sections pls,
       public.page_layouts pl
 where plf.section_id = pls.id
   and pls.layout_id = pl.id
   and pl.entity = 'accounts'
   and plf.field_key in ('status', 'lifecycle_status');

commit;

notify pgrst, 'reload schema';
