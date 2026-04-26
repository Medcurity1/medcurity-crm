-- =================================================================
-- Picklist Scanner — discover real distinct values per field
-- =================================================================
-- Paste this into Supabase Dashboard → SQL Editor → New query.
-- Run it. The output is the actual distinct values present in your
-- CRM data for every picklist-eligible field, with counts. Use this
-- to seed picklist_options with REAL values.
--
-- Output columns: entity, field, value, row_count
-- Sorted by entity, field, count descending.
-- =================================================================

with picklist_scan as (
  -- ACCOUNTS
  select 'accounts' as entity, 'account_type'        as field, account_type::text        as value from public.accounts
  union all
  select 'accounts', 'industry',                              industry::text                       from public.accounts
  union all
  select 'accounts', 'industry_category',                     industry_category::text              from public.accounts
  union all
  select 'accounts', 'renewal_type',                          renewal_type::text                   from public.accounts
  union all
  select 'accounts', 'status',                                status::text                         from public.accounts
  union all
  select 'accounts', 'lifecycle_status',                      lifecycle_status::text               from public.accounts
  union all
  select 'accounts', 'rating',                                rating::text                         from public.accounts
  union all
  select 'accounts', 'lead_source',                           lead_source::text                    from public.accounts
  union all
  select 'accounts', 'lead_source_detail',                    lead_source_detail::text             from public.accounts
  union all
  select 'accounts', 'timezone',                              timezone::text                       from public.accounts
  union all
  select 'accounts', 'fte_range',                             fte_range::text                      from public.accounts
  union all
  -- CONTACTS
  select 'contacts', 'credential',                            credential::text                     from public.contacts
  union all
  select 'contacts', 'time_zone',                             time_zone::text                      from public.contacts
  union all
  select 'contacts', 'type',                                  type::text                           from public.contacts
  union all
  select 'contacts', 'business_relationship_tag',             business_relationship_tag::text      from public.contacts
  union all
  select 'contacts', 'lead_source',                           lead_source::text                    from public.contacts
  union all
  select 'contacts', 'department',                            department::text                     from public.contacts
  union all
  -- LEADS
  select 'leads', 'status',                                   status::text                         from public.leads
  union all
  select 'leads', 'source',                                   source::text                         from public.leads
  union all
  select 'leads', 'qualification',                            qualification::text                  from public.leads
  union all
  select 'leads', 'type',                                     type::text                           from public.leads
  union all
  select 'leads', 'project_segment',                          project_segment::text                from public.leads
  union all
  select 'leads', 'industry_category',                        industry_category::text              from public.leads
  union all
  select 'leads', 'credential',                               credential::text                     from public.leads
  union all
  select 'leads', 'time_zone',                                time_zone::text                      from public.leads
  union all
  select 'leads', 'business_relationship_tag',                business_relationship_tag::text      from public.leads
  union all
  select 'leads', 'rating',                                   rating::text                         from public.leads
  union all
  -- OPPORTUNITIES
  select 'opportunities', 'stage',                            stage::text                          from public.opportunities
  union all
  select 'opportunities', 'kind',                             kind::text                           from public.opportunities
  union all
  select 'opportunities', 'team',                             team::text                           from public.opportunities
  union all
  select 'opportunities', 'lead_source',                      lead_source::text                    from public.opportunities
  union all
  select 'opportunities', 'lead_source_detail',               lead_source_detail::text             from public.opportunities
  union all
  select 'opportunities', 'payment_frequency',                payment_frequency::text              from public.opportunities
  union all
  select 'opportunities', 'contract_length_months',           contract_length_months::text         from public.opportunities
  union all
  select 'opportunities', 'contract_year',                    contract_year::text                  from public.opportunities
  union all
  select 'opportunities', 'fte_range',                        fte_range::text                      from public.opportunities
)
select
  entity,
  field,
  coalesce(value, '(null)') as value,
  count(*) as row_count
from picklist_scan
group by entity, field, value
order by entity, field, row_count desc, value;
