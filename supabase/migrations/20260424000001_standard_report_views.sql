-- ---------------------------------------------------------------------
-- Standard report views
-- ---------------------------------------------------------------------
-- Backs the 9 Salesforce-aligned standard reports and their dashboard
-- metrics. Each view is the single source of truth for:
--   (a) the React report UI (queries via supabase-js)
--   (b) external consumers (e.g. financial spreadsheet) via the
--       Supabase REST API: /rest/v1/<view_name>?select=*
--
-- Fiscal periods are calendar quarters (Jan-Mar, Apr-Jun, Jul-Sep,
-- Oct-Dec). Change the v_fiscal_period() function if Medcurity moves
-- to a custom fiscal year.
--
-- Type mapping (SF → CRM):
--   'New Business'      → opportunities.kind = 'new_business'
--   'Existing Business' → opportunities.kind = 'renewal'
--
-- RLS: views inherit the base tables' RLS, so the same authenticated
-- user sees the same rows they would in a direct query.

begin;

-- ---------------------------------------------------------------------
-- Helper: fiscal period label ('Q2-2026')
-- ---------------------------------------------------------------------
create or replace function public.fiscal_period_label(d date)
returns text
language sql
immutable
as $$
  select case
    when d is null then null
    else 'Q' || extract(quarter from d)::text || '-' || extract(year from d)::text
  end;
$$;

grant execute on function public.fiscal_period_label(date) to authenticated, anon;

-- ---------------------------------------------------------------------
-- Helper: current fiscal quarter range (inclusive)
-- ---------------------------------------------------------------------
create or replace function public.current_fiscal_quarter_start()
returns date
language sql
stable
as $$
  select date_trunc('quarter', current_date)::date;
$$;

create or replace function public.current_fiscal_quarter_end()
returns date
language sql
stable
as $$
  select (date_trunc('quarter', current_date) + interval '3 months' - interval '1 day')::date;
$$;

grant execute on function public.current_fiscal_quarter_start() to authenticated, anon;
grant execute on function public.current_fiscal_quarter_end() to authenticated, anon;

-- ---------------------------------------------------------------------
-- 1. ARR Base Dataset
--    All opportunities with ARR-relevant columns. Matches the SF
--    "ARR Base Dataset" report. Exclude: one_time_project=true,
--    Opportunity Name = 'Customer Service'. Include all types
--    (new_business, renewal, null) per spec.
-- ---------------------------------------------------------------------
create or replace view public.v_arr_base_dataset as
select
  o.id,
  a.name                             as account_name,
  a.account_number,
  o.name                             as opportunity_name,
  coalesce(u.full_name, 'Unassigned') as opportunity_owner,
  u.role                             as owner_role,
  o.created_at::date                 as created_date,
  o.close_date,
  case
    when o.close_date is not null then (current_date - o.close_date)
    else (current_date - o.created_at::date)
  end                                as age,
  o.amount,
  public.fiscal_period_label(o.close_date) as fiscal_period,
  o.payment_frequency,
  coalesce(o.one_time_project, false) as one_time_project,
  o.stage,
  case o.kind
    when 'new_business' then 'New Business'
    when 'renewal'      then 'Existing Business'
    else ''
  end                                as type,
  a.account_type,
  (
    select ap2.name
    from public.account_partners p
    join public.accounts ap2 on ap2.id = p.partner_account_id
    where p.member_account_id = a.id
    order by p.created_at asc
    limit 1
  )                                  as primary_partner,
  o.lead_source,
  o.probability,
  o.next_step,
  o.account_id,
  o.owner_user_id
from public.opportunities o
join public.accounts a on a.id = o.account_id
left join public.user_profiles u on u.id = o.owner_user_id
where o.archived_at is null
  and a.archived_at is null
  and coalesce(o.one_time_project, false) = false
  and o.name is distinct from 'Customer Service';

comment on view public.v_arr_base_dataset is
  'ARR base dataset. All opps (excluding one-time projects and Customer Service). Columns match SF ARR report.';

-- ---------------------------------------------------------------------
-- 2. ARR Rolling 365
--    Monthly closed-won revenue + trailing-365-day running ARR.
--    Used for the ARR by Quarter chart on the dashboard.
-- ---------------------------------------------------------------------
create or replace view public.v_arr_rolling_365 as
with months as (
  select generate_series(
    date_trunc('month', current_date - interval '36 months'),
    date_trunc('month', current_date),
    interval '1 month'
  )::date as month_start
),
won_opps as (
  select
    date_trunc('month', o.close_date)::date as month_start,
    o.close_date,
    o.amount
  from public.opportunities o
  where o.archived_at is null
    and o.stage = 'closed_won'
    and coalesce(o.one_time_project, false) = false
    and o.close_date is not null
),
monthly as (
  select
    m.month_start,
    coalesce(sum(w.amount), 0) as closed_won_amount,
    count(w.*)                 as deal_count
  from months m
  left join won_opps w on w.month_start = m.month_start
  group by m.month_start
)
select
  m.month_start,
  public.fiscal_period_label(m.month_start) as fiscal_period,
  m.closed_won_amount,
  m.deal_count,
  coalesce((
    select sum(w.amount)
    from won_opps w
    where w.close_date > (m.month_start + interval '1 month' - interval '1 day')::date - interval '365 days'
      and w.close_date <= (m.month_start + interval '1 month' - interval '1 day')::date
  ), 0) as trailing_365_arr
from monthly m
order by m.month_start asc;

comment on view public.v_arr_rolling_365 is
  'Monthly closed-won totals + trailing-365-day ARR for the ARR chart.';

-- ---------------------------------------------------------------------
-- 3. New Customers (current fiscal quarter, closed_won, new_business)
-- ---------------------------------------------------------------------
create or replace view public.v_new_customers_qtd as
select
  o.id,
  coalesce(u.full_name, 'Unassigned') as opportunity_owner,
  a.name                             as account_name,
  o.name                             as opportunity_name,
  case o.kind
    when 'new_business' then 'New Business'
    when 'renewal'      then 'Existing Business'
    else ''
  end                                as type,
  o.amount,
  o.close_date,
  o.lead_source,
  public.fiscal_period_label(o.close_date) as fiscal_period,
  o.account_id,
  o.owner_user_id
from public.opportunities o
join public.accounts a on a.id = o.account_id
left join public.user_profiles u on u.id = o.owner_user_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage = 'closed_won'
  and o.kind = 'new_business'
  and o.close_date between public.current_fiscal_quarter_start()
                       and public.current_fiscal_quarter_end();

comment on view public.v_new_customers_qtd is
  'New Business closed-won in the current fiscal quarter. Dashboard "New Customers QTD" counts rows here.';

-- ---------------------------------------------------------------------
-- 4. Lost Customers (current fiscal quarter, closed_lost,
--    existing_business, account inactive)
-- ---------------------------------------------------------------------
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
  and a.lifecycle_status = 'former_customer'
  and o.close_date between public.current_fiscal_quarter_start()
                       and public.current_fiscal_quarter_end();

comment on view public.v_lost_customers_qtd is
  'Existing Business closed-lost in the current fiscal quarter on inactive accounts. Dashboard churn metric.';

-- ---------------------------------------------------------------------
-- 5. Active Pipeline (open opps, grouped semantics via Type + Stage)
-- ---------------------------------------------------------------------
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
  o.owner_user_id
from public.opportunities o
join public.accounts a on a.id = o.account_id
left join public.user_profiles u on u.id = o.owner_user_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage not in ('closed_won', 'closed_lost');

comment on view public.v_active_pipeline is
  'Open opportunities (not Closed Won or Closed Lost). SF "Active Pipeline" report.';

-- ---------------------------------------------------------------------
-- 6. Renewals (current fiscal quarter, closed_won, existing_business,
--    opportunity_name ≠ "EHR Implementation")
-- ---------------------------------------------------------------------
create or replace view public.v_renewals_qtd as
select
  o.id,
  u.role                             as owner_role,
  coalesce(u.full_name, 'Unassigned') as opportunity_owner,
  a.name                             as account_name,
  o.name                             as opportunity_name,
  o.stage,
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
  o.account_id,
  o.owner_user_id
from public.opportunities o
join public.accounts a on a.id = o.account_id
left join public.user_profiles u on u.id = o.owner_user_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage = 'closed_won'
  and o.kind = 'renewal'
  and o.name is distinct from 'EHR Implementation'
  and o.close_date between public.current_fiscal_quarter_start()
                       and public.current_fiscal_quarter_end();

comment on view public.v_renewals_qtd is
  'Existing Business closed-won in the current fiscal quarter, excluding EHR Implementation. SF "Renewals" report.';

-- ---------------------------------------------------------------------
-- 7. SQL Accounts (accounts with SQL events in the reporting period)
--    SQL event = a contact on the account has sql_date set.
-- ---------------------------------------------------------------------
create or replace view public.v_sql_accounts as
select distinct on (a.id, c.id)
  c.id                               as contact_id,
  a.id                               as account_id,
  c.first_name,
  c.last_name,
  c.title,
  a.name                             as account_name,
  coalesce(au.full_name, 'Unassigned') as account_owner,
  a.created_at::date                 as account_created_date,
  coalesce(a.lead_source, '')        as lead_source,
  a.notes                            as description,
  c.sql_date,
  c.mql_date
from public.accounts a
join public.contacts c on c.account_id = a.id
left join public.user_profiles au on au.id = a.owner_user_id
where a.archived_at is null
  and c.archived_at is null
  and c.sql_date is not null
order by a.id, c.id, c.sql_date desc;

comment on view public.v_sql_accounts is
  'Accounts with qualified contacts (SQL event). Filter client-side by fiscal period if needed.';

-- ---------------------------------------------------------------------
-- 8. MQL Contacts (MQL, not SQL yet, marketable)
-- ---------------------------------------------------------------------
create or replace view public.v_mql_contacts as
select
  c.id                               as contact_id,
  c.first_name,
  c.last_name,
  c.title,
  a.name                             as account_name,
  c.phone,
  c.mobile_phone as mobile,
  c.email,
  coalesce(au.full_name, 'Unassigned') as account_owner,
  c.mql_date,
  c.account_id
from public.contacts c
join public.accounts a on a.id = c.account_id
left join public.user_profiles au on au.id = a.owner_user_id
where c.archived_at is null
  and a.archived_at is null
  and c.mql_date is not null
  and c.sql_date is null
  and coalesce(c.do_not_contact, false) = false;

comment on view public.v_mql_contacts is
  'Marketable contacts with MQL date but no SQL date yet. Filter by fiscal period client-side.';

-- ---------------------------------------------------------------------
-- 9. MQL Leads (current fiscal quarter, not converted)
-- ---------------------------------------------------------------------
create or replace view public.v_mql_leads_qtd as
select
  l.id                               as lead_id,
  coalesce(l.lead_source::text, 'unknown') as lead_source,
  l.first_name,
  l.last_name,
  l.title,
  l.email,
  l.phone,
  l.mobile_phone as mobile,
  coalesce(u.full_name, 'Unassigned') as lead_owner,
  l.mql_date,
  coalesce(l.do_not_market_to, false) as do_not_market_to,
  l.status,
  l.owner_user_id
from public.leads l
left join public.user_profiles u on u.id = l.owner_user_id
where l.archived_at is null
  and l.mql_date is not null
  and l.mql_date between public.current_fiscal_quarter_start()
                     and public.current_fiscal_quarter_end()
  and l.status is distinct from 'converted';

comment on view public.v_mql_leads_qtd is
  'Leads with MQL date in the current fiscal quarter, not yet converted.';

-- ---------------------------------------------------------------------
-- 10. MQL Dedup (unique marketable people across leads + contacts)
-- ---------------------------------------------------------------------
create or replace view public.v_mql_dedup as
with combined as (
  select
    'lead'::text    as source_kind,
    l.id            as source_id,
    lower(trim(coalesce(l.email, '')))   as email_key,
    regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') as phone_key,
    lower(trim(coalesce(l.first_name, '') || ' ' || coalesce(l.last_name, '') || '|' || coalesce(l.company, ''))) as name_key,
    l.mql_date
  from public.leads l
  where l.archived_at is null
    and l.mql_date is not null
  union all
  select
    'contact'::text as source_kind,
    c.id            as source_id,
    lower(trim(coalesce(c.email, '')))   as email_key,
    regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') as phone_key,
    lower(trim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '') || '|' || coalesce(a.name, ''))) as name_key,
    c.mql_date
  from public.contacts c
  join public.accounts a on a.id = c.account_id
  where c.archived_at is null
    and a.archived_at is null
    and c.mql_date is not null
),
ranked as (
  select
    c.*,
    -- Dedup key: first non-empty of email, phone, name-account.
    case
      when c.email_key <> '' then 'e:' || c.email_key
      when c.phone_key <> '' then 'p:' || c.phone_key
      else 'n:' || c.name_key
    end as dedup_key,
    row_number() over (
      partition by case
        when c.email_key <> '' then 'e:' || c.email_key
        when c.phone_key <> '' then 'p:' || c.phone_key
        else 'n:' || c.name_key
      end
      order by c.mql_date asc, c.source_id asc
    ) as rn
  from combined c
)
select
  dedup_key,
  source_kind    as earliest_source_kind,
  source_id      as earliest_source_id,
  mql_date       as earliest_mql_date
from ranked
where rn = 1;

comment on view public.v_mql_dedup is
  'Deduplicated MQLs across leads + contacts by email / phone / name+account. Earliest MQL date wins.';

-- ---------------------------------------------------------------------
-- 11. Dashboard scalar metrics
-- ---------------------------------------------------------------------
create or replace view public.v_dashboard_metrics as
with arr as (
  select trailing_365_arr as current_arr
  from public.v_arr_rolling_365
  order by month_start desc
  limit 1
),
new_cust as (
  select count(*)::int as new_customers_qtd,
         coalesce(sum(amount), 0) as new_customer_amount_qtd
  from public.v_new_customers_qtd
),
renewals as (
  select count(*)::int as renewals_qtd,
         coalesce(sum(amount), 0) as renewals_amount_qtd
  from public.v_renewals_qtd
),
pipeline as (
  select count(*)::int as pipeline_count,
         coalesce(sum(amount), 0) as pipeline_amount,
         coalesce(sum(weighted_amount), 0) as pipeline_weighted_amount
  from public.v_active_pipeline
),
lost as (
  select count(*)::int as lost_customers_qtd,
         coalesce(sum(amount), 0) as lost_customer_amount_qtd
  from public.v_lost_customers_qtd
),
sql_counts as (
  select count(*)::int as sql_qtd
  from public.v_sql_accounts
  where sql_date between public.current_fiscal_quarter_start()
                     and public.current_fiscal_quarter_end()
),
mql_totals as (
  select
    (select count(*)::int from public.v_mql_leads_qtd)                                  as mql_leads_qtd,
    (select count(*)::int from public.v_mql_contacts
       where mql_date between public.current_fiscal_quarter_start()
                          and public.current_fiscal_quarter_end())                      as mql_contacts_qtd,
    (select count(*)::int from public.v_mql_dedup
       where earliest_mql_date between public.current_fiscal_quarter_start()
                                   and public.current_fiscal_quarter_end())             as mql_unique_qtd
),
-- Start-of-quarter active customer + dollar base for NRR.
-- "Starting" = accounts that were lifecycle_status=active on the first
-- day of the current quarter (approximated by active_since before the
-- quarter start AND churn_date null or after start).
starting as (
  select
    count(*)::int as starting_customers,
    coalesce(sum(current_arr_snapshot.amount), 0) as starting_arr
  from public.accounts a
  left join lateral (
    select amount
    from public.opportunities o
    where o.account_id = a.id
      and o.stage = 'closed_won'
      and coalesce(o.one_time_project, false) = false
    order by o.close_date desc nulls last
    limit 1
  ) current_arr_snapshot on true
  where a.archived_at is null
    and a.active_since is not null
    and a.active_since < public.current_fiscal_quarter_start()
    and (a.churn_date is null or a.churn_date >= public.current_fiscal_quarter_start())
),
-- Churn in the current quarter, for NRR denominator maths.
churn as (
  select
    count(*)::int as churn_customers_qtd,
    coalesce(sum(a.churn_amount), 0) as churn_amount_qtd
  from public.accounts a
  where a.archived_at is null
    and a.lifecycle_status = 'former_customer'
    and a.churn_date is not null
    and a.churn_date between public.current_fiscal_quarter_start()
                         and public.current_fiscal_quarter_end()
)
select
  now()                             as computed_at,
  public.current_fiscal_quarter_start() as fiscal_quarter_start,
  public.current_fiscal_quarter_end()   as fiscal_quarter_end,
  public.fiscal_period_label(public.current_fiscal_quarter_start()) as fiscal_period,
  -- Sales / ARR
  coalesce((select current_arr from arr), 0)                as current_arr,
  (select new_customers_qtd from new_cust)                  as new_customers_qtd,
  (select new_customer_amount_qtd from new_cust)            as new_customer_amount_qtd,
  (select renewals_qtd from renewals)                       as renewals_qtd,
  (select renewals_amount_qtd from renewals)                as renewals_amount_qtd,
  (select pipeline_count from pipeline)                     as pipeline_count,
  (select pipeline_amount from pipeline)                    as pipeline_amount,
  (select pipeline_weighted_amount from pipeline)           as pipeline_weighted_amount,
  -- Customer Success
  (select lost_customers_qtd from lost)                     as lost_customers_qtd,
  (select lost_customer_amount_qtd from lost)               as lost_customer_amount_qtd,
  (select starting_customers from starting)                 as starting_customers,
  (select starting_arr from starting)                       as starting_arr,
  (select churn_customers_qtd from churn)                   as churn_customers_qtd,
  (select churn_amount_qtd from churn)                      as churn_amount_qtd,
  -- NRR (legacy): 1 - churn%
  case
    when (select starting_customers from starting) > 0
      then (1 - (select churn_customers_qtd from churn)::numeric
                / (select starting_customers from starting)::numeric) * 100
    else null
  end                                                        as nrr_by_customer_legacy_pct,
  case
    when (select starting_arr from starting) > 0
      then (1 - (select churn_amount_qtd from churn)
                / nullif((select starting_arr from starting), 0)) * 100
    else null
  end                                                        as nrr_by_dollar_legacy_pct,
  -- NRR (true): (starting - churn + expansion) / starting; expansion
  -- treated as 0 for now (no upsell tracking yet).
  case
    when (select starting_customers from starting) > 0
      then ((select starting_customers from starting) - (select churn_customers_qtd from churn))::numeric
           / (select starting_customers from starting)::numeric * 100
    else null
  end                                                        as nrr_by_customer_true_pct,
  case
    when (select starting_arr from starting) > 0
      then ((select starting_arr from starting) - (select churn_amount_qtd from churn))::numeric
           / nullif((select starting_arr from starting), 0) * 100
    else null
  end                                                        as nrr_by_dollar_true_pct,
  -- Marketing
  (select sql_qtd from sql_counts)                           as sql_qtd,
  (select mql_leads_qtd from mql_totals)                     as mql_leads_qtd,
  (select mql_contacts_qtd from mql_totals)                  as mql_contacts_qtd,
  (select mql_unique_qtd from mql_totals)                    as mql_unique_qtd;

comment on view public.v_dashboard_metrics is
  'Single-row scalar metrics powering the Team Dashboard KPI tiles.';

commit;
