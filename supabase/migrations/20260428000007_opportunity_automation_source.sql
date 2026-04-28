-- Add a `automation_source` picklist on opportunities so we can tell
-- "this renewal opp was auto-created by Salesforce, then imported"
-- vs "this renewal opp was auto-created by the new CRM's renewal job."
--
-- Brayden flagged this during cutover prep: the `created_by_automation`
-- boolean lights up in both cases, but he can't tell whether to trust
-- the data (SF-era) or whether the new automation is working as
-- expected (CRM-era).
--
-- Values: 'sf_import' | 'crm_renewal_v1' | null (manually-created).
-- Backfill: every existing created_by_automation=true row is from the
-- SF import (the new CRM's renewal automation hasn't run in production
-- yet per Brayden's last status check). Once SF is decommissioned the
-- 'sf_import' value is frozen and we just stamp 'crm_renewal_v1' going
-- forward.
--
-- Idempotent.

-- 1. Column
alter table public.opportunities
  add column if not exists automation_source text;

comment on column public.opportunities.automation_source is
  'Where this opp was auto-created. ''sf_import'' = imported from Salesforce automation; ''crm_renewal_v1'' = new-CRM renewal job. null = manually created.';

-- 2. Soft check constraint so a typo doesn't sneak through
alter table public.opportunities
  drop constraint if exists opportunities_automation_source_check;
alter table public.opportunities
  add constraint opportunities_automation_source_check
  check (
    automation_source is null
    or automation_source in ('sf_import', 'crm_renewal_v1')
  );

-- 3. Backfill existing rows
update public.opportunities
   set automation_source = 'sf_import'
 where created_by_automation = true
   and automation_source is null;

-- 4. Trigger: any future row inserted with created_by_automation=true
--    and no explicit source is, by definition, from the new CRM
--    renewal job. (run_renewal_automation_now() doesn't currently set
--    this column, and rather than rewriting that whole function we
--    fill it in via a trigger here.)
create or replace function public.opportunities_stamp_automation_source()
returns trigger
language plpgsql
as $$
begin
  if new.created_by_automation = true and new.automation_source is null then
    new.automation_source := 'crm_renewal_v1';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_opportunities_stamp_automation_source on public.opportunities;
create trigger trg_opportunities_stamp_automation_source
  before insert on public.opportunities
  for each row execute function public.opportunities_stamp_automation_source();
