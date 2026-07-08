-- ---------------------------------------------------------------------
-- Close-readiness gate config (Rachel): require complete client info on
-- the ACCOUNT before an opportunity can be marked Closed Won — phone,
-- billing address, FTE range, and at least one contact email.
--
-- The checker (src/lib/closeReadiness.ts) reads these rows to decide
-- which of the four checks to enforce, so Rachel's list stays adjustable
-- without a code change. The checker falls back to enforcing all four
-- when these rows are absent, so the gate works even before this deploys.
--
-- `required_field_config` (created in 20260403000001) has a CHECK that
-- only allowed entity in ('accounts','contacts','opportunities','leads').
-- We widen it to admit the 'opportunity_close' pseudo-entity, then seed.
--
-- Idempotent + guarded: safe to re-run; no-ops if the table is absent.
-- ---------------------------------------------------------------------

begin;

do $$
declare
  c record;
begin
  if to_regclass('public.required_field_config') is null then
    return;
  end if;

  -- Drop whatever CHECK constraint currently guards `entity` (its name is
  -- auto-generated and can differ across environments), then re-add a
  -- widened one. Dropping every entity-referencing CHECK first keeps this
  -- re-runnable and avoids leaving a stale narrow constraint behind.
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.required_field_config'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%entity%'
  loop
    execute format(
      'alter table public.required_field_config drop constraint %I', c.conname
    );
  end loop;

  alter table public.required_field_config
    add constraint required_field_config_entity_check
    check (entity in ('accounts', 'contacts', 'opportunities', 'leads', 'opportunity_close'));

  -- Seed the four close-readiness keys (unique on (entity, field_key)).
  insert into public.required_field_config (entity, field_key, is_required)
  values
    ('opportunity_close', 'account_phone', true),
    ('opportunity_close', 'account_billing_address', true),
    ('opportunity_close', 'account_fte_range', true),
    ('opportunity_close', 'contact_email', true)
  on conflict (entity, field_key) do nothing;
end $$;

commit;
