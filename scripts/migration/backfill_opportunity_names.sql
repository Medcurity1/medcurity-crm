-- ---------------------------------------------------------------------
-- Backfill opportunity.name from attached products' short_name | code | name
--
-- For every opp that has at least one attached product, rebuild its name
-- as "SHORT1 | SHORT2 | SHORT3" using the same priority order the form's
-- "Use suggested" button does:
--     short_name (preferred)  →  code  →  name  (fallback)
--
-- Skips opps whose CURRENT name has been manually customized — defined as
-- a name that does NOT look like a product join (i.e. doesn't contain
-- ' | ' OR is one of the system-generated "Customer Service" / SF auto
-- names). This is conservative: better to leave a manual name alone than
-- wipe out a rep's intentional naming.
--
-- DRY-RUN MODE: change the bottom `commit;` to `rollback;` to preview
-- the diagnostic SELECT (count of opps that will be renamed + a sample)
-- without persisting.
--
-- Run in PROD CRM Supabase SQL Editor (or staging) once.
-- ---------------------------------------------------------------------

begin;

-- Build the suggested name per opp (only for opps with at least 1 product)
with computed as (
  select
    op.opportunity_id,
    string_agg(
      coalesce(
        nullif(trim(p.short_name), ''),
        nullif(trim(p.code), ''),
        nullif(trim(p.name), '')
      ),
      ' | '
      order by op.created_at, op.id
    ) as suggested_name
  from public.opportunity_products op
  join public.products p on p.id = op.product_id
  where op.archived_at is null
    and p.archived_at is null
  group by op.opportunity_id
  having string_agg(
    coalesce(
      nullif(trim(p.short_name), ''),
      nullif(trim(p.code), ''),
      nullif(trim(p.name), '')
    ),
    ' | '
    order by op.created_at, op.id
  ) is not null
),
candidates as (
  select
    o.id,
    o.name as current_name,
    c.suggested_name
  from public.opportunities o
  join computed c on c.opportunity_id = o.id
  where o.archived_at is null
    -- Skip names that already match the suggestion (no work to do)
    and o.name is distinct from c.suggested_name
    -- Only target names that LOOK auto-generated:
    --   • slug-only (lowercase + hyphens, possibly already pipe-joined)
    --   • exact "Customer Service" placeholder
    --   • already pipe-joined (we'll rebuild with new short names)
    and (
      o.name ~ '^[a-z0-9-|\s]+$'           -- all lowercase / hyphens / pipes
      or o.name = 'Customer Service'
      or o.name like '% | %'                -- contains the join separator
      or o.name ~ '^[a-z]+(-[a-z]+)+'       -- starts with a slug
    )
)
-- Diagnostic: see what we're about to update
select
  count(*) as opps_to_rename,
  count(*) filter (where current_name like '% | %') as already_pipe_joined,
  count(*) filter (where current_name = 'Customer Service') as customer_service_count
from candidates;

-- Sample — first 10 renames (so you can eyeball before commit)
select id, current_name, suggested_name
from (
  select
    o.id, o.name as current_name,
    string_agg(
      coalesce(nullif(trim(p.short_name), ''), nullif(trim(p.code), ''), nullif(trim(p.name), '')),
      ' | ' order by op.created_at, op.id
    ) as suggested_name
  from public.opportunities o
  join public.opportunity_products op on op.opportunity_id = o.id
  join public.products p on p.id = op.product_id
  where o.archived_at is null and op.archived_at is null and p.archived_at is null
  group by o.id, o.name
) sub
where current_name is distinct from suggested_name
  and (
    current_name ~ '^[a-z0-9-|\s]+$'
    or current_name = 'Customer Service'
    or current_name like '% | %'
    or current_name ~ '^[a-z]+(-[a-z]+)+'
  )
order by id
limit 10;

-- The actual update
with computed as (
  select
    op.opportunity_id,
    string_agg(
      coalesce(
        nullif(trim(p.short_name), ''),
        nullif(trim(p.code), ''),
        nullif(trim(p.name), '')
      ),
      ' | '
      order by op.created_at, op.id
    ) as suggested_name
  from public.opportunity_products op
  join public.products p on p.id = op.product_id
  where op.archived_at is null
    and p.archived_at is null
  group by op.opportunity_id
)
update public.opportunities o
set name = c.suggested_name,
    updated_at = timezone('utc', now())
from computed c
where c.opportunity_id = o.id
  and o.archived_at is null
  and o.name is distinct from c.suggested_name
  and c.suggested_name is not null
  and trim(c.suggested_name) <> ''
  and (
    o.name ~ '^[a-z0-9-|\s]+$'
    or o.name = 'Customer Service'
    or o.name like '% | %'
    or o.name ~ '^[a-z]+(-[a-z]+)+'
  );

-- Confirmation
select
  count(*) filter (where name like '% | %') as pipe_joined_opps,
  count(*) as total_active_opps
from public.opportunities
where archived_at is null;

commit;
