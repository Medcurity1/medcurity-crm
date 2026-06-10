-- ---------------------------------------------------------------------
-- Opportunity form glitch: business_type and contract_length were left
-- toggled "required" in the admin required-fields config, but sales
-- often can't fill them at creation (Brayden flagged this). The zod
-- schema already treats both as optional, so the only thing still
-- gating them is the required_field_config row. Clear it.
--
-- Idempotent + guarded (the config table may not exist on every env).
-- ---------------------------------------------------------------------

begin;

do $$
begin
  if to_regclass('public.required_field_config') is not null then
    update public.required_field_config
       set is_required = false
     where entity = 'opportunities'
       and field_key in ('business_type', 'contract_length_months', 'contract_length');
  end if;
end $$;

commit;
