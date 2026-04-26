-- ---------------------------------------------------------------------
-- Field inventory view — Salesforce Object Manager equivalent
-- ---------------------------------------------------------------------
-- Exposes information_schema.columns for the CRM tables in a single
-- queryable view so the admin UI can render an Object Manager page
-- without each user needing direct schema access.
--
-- Joins:
--   - foreign-key relationships (so we can show "Account → Opportunities")
--   - picklist_options counts (to flag picklist-backed columns)

create or replace view public.v_field_inventory as
with cols as (
  select
    c.table_name as entity,
    c.column_name as field,
    c.data_type as data_type,
    c.udt_name as udt_name,
    c.is_nullable = 'YES' as nullable,
    c.column_default as default_value,
    c.ordinal_position
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in (
      'accounts', 'contacts', 'leads', 'opportunities',
      'opportunity_products', 'products', 'price_books',
      'price_book_entries', 'activities', 'partners',
      'account_partners', 'tasks'
    )
),
fk as (
  -- Every foreign key from any of our entity tables → its target.
  select
    tc.table_name as entity,
    kcu.column_name as field,
    ccu.table_name as references_table,
    ccu.column_name as references_field
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
    and tc.table_schema = kcu.table_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
    and ccu.table_schema = tc.table_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public'
),
picklist_counts as (
  select
    split_part(field_key, '.', 1) as entity,
    split_part(field_key, '.', 2) as field,
    count(*) as picklist_options
  from public.picklist_options
  where is_active = true
  group by field_key
)
select
  cols.entity,
  cols.field,
  cols.data_type,
  cols.udt_name,
  case
    when cols.data_type = 'USER-DEFINED' then 'enum (' || cols.udt_name || ')'
    when picklist_counts.picklist_options is not null then 'picklist (' || picklist_counts.picklist_options || ' values)'
    when cols.data_type = 'uuid' and fk.references_table is not null then 'lookup → ' || fk.references_table
    else cols.data_type
  end as field_type_friendly,
  cols.nullable as is_nullable,
  cols.default_value,
  fk.references_table,
  fk.references_field,
  picklist_counts.picklist_options,
  cols.ordinal_position
from cols
left join fk
  on fk.entity = cols.entity
  and fk.field = cols.field
left join picklist_counts
  on picklist_counts.entity = cols.entity
  and picklist_counts.field = cols.field
order by cols.entity, cols.ordinal_position;

grant select on public.v_field_inventory to authenticated, anon;

comment on view public.v_field_inventory is
  'Salesforce Object Manager equivalent. Enumerates every column on every CRM entity with its data type, FK target, picklist option count, and nullability. Used by Admin → Object Manager page.';
