-- ---------------------------------------------------------------------
-- Auto-backfill picklist_options from actual data
-- ---------------------------------------------------------------------
-- Reads every distinct non-null value present in the data for each
-- picklist-eligible field and inserts it into picklist_options if not
-- already there. This way the dropdown UI reflects what's REALLY in
-- your CRM, not just hand-curated guesses.
--
-- Idempotent — uses on conflict do nothing, so re-running is safe.
--
-- Label generation: Title Case the value with underscores → spaces.
-- e.g. 'no_auto_renew' → 'No Auto Renew'. Admins can rename labels
-- via the Picklists admin UI without affecting the stored value.

begin;

create or replace function public._picklist_humanize_label(v text)
returns text
language sql
immutable
as $$
  select string_agg(
    case
      when w in ('mql', 'sql', 'sal', 'arr', 'fte', 'crm', 'voa', 'fqhc', 'ceo', 'cfo', 'coo', 'cto', 'cio', 'cmo', 'ciso', 'md', 'do', 'rn', 'np', 'pa', 'lpn', 'chc', 'chps', 'chpc') then upper(w)
      else upper(substring(w, 1, 1)) || substring(w, 2)
    end,
    ' '
  )
  from regexp_split_to_table(replace(coalesce(v, ''), '_', ' '), '\s+') as w
  where w <> '';
$$;

-- For each (entity, field) pair, suck in distinct non-null values.
-- The CTE structure mirrors picklist-scan.sql so we get all picklist-
-- eligible columns covered.
with discovered as (
  select 'accounts'::text as entity, 'account_type'::text as field, account_type::text as value, count(*) as ct from public.accounts where account_type is not null group by account_type
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
  public._picklist_humanize_label(d.value) as label,
  -- Sort by frequency (most-used first), in 10-step increments so admins
  -- can wedge custom rows in between later.
  100 + (row_number() over (partition by d.entity, d.field order by d.ct desc, d.value)) * 10 as sort_order,
  true as is_active
from discovered d
where d.value is not null and trim(d.value) <> ''
on conflict (field_key, value) do nothing;

drop function if exists public._picklist_humanize_label(text);

commit;
