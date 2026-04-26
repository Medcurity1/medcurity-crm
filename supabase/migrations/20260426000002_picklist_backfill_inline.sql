-- ---------------------------------------------------------------------
-- Re-attempt picklist_options backfill, inline (no helper function).
-- ---------------------------------------------------------------------
-- The previous migration (20260426000001) used a SQL function which may
-- have failed silently on some Postgres configs. This version inlines
-- the label-humanization with initcap() instead. Simpler, more reliable.
--
-- Idempotent — uses on conflict do nothing.

begin;

-- Helper: convert 'no_auto_renew' → 'No Auto Renew' inline.
--   replace underscores with spaces, then initcap.
-- (initcap doesn't handle acronyms specially, but admins can rename via UI.)

with discovered as (
  -- Accounts
  select 'accounts'::text as entity, 'account_type'::text as field, account_type::text as value, count(*) as ct from public.accounts where account_type is not null and account_type::text <> '' group by account_type
  union all
  select 'accounts', 'industry',                    industry::text,                    count(*) from public.accounts where industry is not null and industry <> ''                                  group by industry
  union all
  select 'accounts', 'industry_category',           industry_category::text,           count(*) from public.accounts where industry_category is not null                                            group by industry_category
  union all
  select 'accounts', 'renewal_type',                renewal_type::text,                count(*) from public.accounts where renewal_type is not null                                                 group by renewal_type
  union all
  select 'accounts', 'status',                      status::text,                      count(*) from public.accounts where status is not null                                                       group by status
  union all
  select 'accounts', 'lifecycle_status',            lifecycle_status::text,            count(*) from public.accounts where lifecycle_status is not null                                              group by lifecycle_status
  union all
  select 'accounts', 'rating',                      rating::text,                      count(*) from public.accounts where rating is not null and rating <> ''                                      group by rating
  union all
  select 'accounts', 'lead_source',                 lead_source::text,                 count(*) from public.accounts where lead_source is not null                                                  group by lead_source
  union all
  select 'accounts', 'timezone',                    timezone::text,                    count(*) from public.accounts where timezone is not null and timezone <> ''                                  group by timezone
  -- Contacts
  union all
  select 'contacts', 'credential',                  credential::text,                  count(*) from public.contacts where credential is not null                                                   group by credential
  union all
  select 'contacts', 'time_zone',                   time_zone::text,                   count(*) from public.contacts where time_zone is not null                                                    group by time_zone
  union all
  select 'contacts', 'type',                        type::text,                        count(*) from public.contacts where type is not null                                                         group by type
  union all
  select 'contacts', 'business_relationship_tag',   business_relationship_tag::text,   count(*) from public.contacts where business_relationship_tag is not null                                    group by business_relationship_tag
  union all
  select 'contacts', 'lead_source',                 lead_source::text,                 count(*) from public.contacts where lead_source is not null                                                  group by lead_source
  -- Leads
  union all
  select 'leads', 'status',                         status::text,                      count(*) from public.leads where status is not null                                                          group by status
  union all
  select 'leads', 'source',                         source::text,                      count(*) from public.leads where source is not null                                                          group by source
  union all
  select 'leads', 'qualification',                  qualification::text,               count(*) from public.leads where qualification is not null                                                   group by qualification
  union all
  select 'leads', 'type',                           type::text,                        count(*) from public.leads where type is not null                                                            group by type
  union all
  select 'leads', 'project_segment',                project_segment::text,             count(*) from public.leads where project_segment is not null                                                 group by project_segment
  union all
  select 'leads', 'industry_category',              industry_category::text,           count(*) from public.leads where industry_category is not null                                               group by industry_category
  union all
  select 'leads', 'credential',                     credential::text,                  count(*) from public.leads where credential is not null                                                      group by credential
  union all
  select 'leads', 'time_zone',                      time_zone::text,                   count(*) from public.leads where time_zone is not null                                                       group by time_zone
  union all
  select 'leads', 'business_relationship_tag',      business_relationship_tag::text,   count(*) from public.leads where business_relationship_tag is not null                                       group by business_relationship_tag
  union all
  select 'leads', 'rating',                         rating::text,                      count(*) from public.leads where rating is not null and rating <> ''                                         group by rating
  -- Opportunities
  union all
  select 'opportunities', 'lead_source',            lead_source::text,                 count(*) from public.opportunities where lead_source is not null                                             group by lead_source
  union all
  select 'opportunities', 'payment_frequency',      payment_frequency::text,           count(*) from public.opportunities where payment_frequency is not null                                       group by payment_frequency
  union all
  select 'opportunities', 'contract_length_months', contract_length_months::text,      count(*) from public.opportunities where contract_length_months is not null                                  group by contract_length_months
  union all
  select 'opportunities', 'contract_year',          contract_year::text,               count(*) from public.opportunities where contract_year is not null                                           group by contract_year
)
insert into public.picklist_options (field_key, value, label, sort_order, is_active)
select
  d.entity || '.' || d.field as field_key,
  d.value,
  -- Replace underscores with spaces, then initcap to Title Case.
  -- e.g. 'no_auto_renew' → 'No Auto Renew'
  initcap(replace(d.value, '_', ' ')) as label,
  100 + (row_number() over (partition by d.entity, d.field order by d.ct desc, d.value)) * 10 as sort_order,
  true as is_active
from discovered d
where d.value is not null and trim(d.value) <> ''
on conflict (field_key, value) do nothing;

commit;
