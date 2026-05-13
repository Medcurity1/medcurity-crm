-- Flip the default on opportunities.services_included from true to false.
--
-- Background: the column was added with `default true` in
-- 20260403000001_enhanced_fields_and_custom_fields.sql. That meant
-- every existing row got `true` at migration time, and every insert
-- that doesn't explicitly send the column (notably some SF-import
-- paths) also lands `true`. Rachel reported the checkbox appearing
-- "automatically checked for everyone" — that's the cause.
--
-- This migration changes only the COLUMN DEFAULT going forward.
-- It does NOT backfill historical rows — those still say `true` and
-- need to be reviewed/corrected case-by-case (separate decision).
-- A backfill `update opportunities set services_included = false`
-- would silently invalidate any opp where services genuinely are
-- included, which is the opposite of what Rachel wants.

alter table public.opportunities
  alter column services_included set default false;

comment on column public.opportunities.services_included is
  'Whether services are included in this deal. Defaults to false at the column level (changed from true in 20260513000002). Historical rows imported before this change may still read true and should be reviewed individually.';
