-- Add lead_id to activities so leads can have their own activity timeline.
--
-- Until now, leads had no activities_fk so the LeadDetail page couldn't
-- show a timeline. Brayden 2026-04-17: leads need an activity page too.
-- When a lead converts to a contact, activities carry forward: their
-- contact_id + account_id columns get populated but lead_id is kept as
-- a provenance pointer so "activities from back when this was a lead"
-- stays queryable.

begin;

alter table public.activities
  add column if not exists lead_id uuid references public.leads (id) on delete set null;

comment on column public.activities.lead_id is
  'Lead this activity was logged against. Populated before conversion. After the lead converts to a contact, contact_id + account_id also get populated on the activity — lead_id stays as a provenance pointer so history queries still work.';

create index if not exists idx_activities_lead
  on public.activities (lead_id)
  where lead_id is not null and archived_at is null;

-- When a lead converts to a contact, copy the lead_id linkage forward
-- to contact_id + account_id on any existing activities so the
-- contact page shows the full history. This is idempotent (set, don't
-- clobber) so re-running the conversion flow won't overwrite manual
-- reassignments.
create or replace function public.carry_lead_activities_to_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only fire when a lead gets its converted_contact_id set for the
  -- first time (NULL -> not NULL).
  if new.converted_contact_id is not null
     and (old.converted_contact_id is null
          or old.converted_contact_id <> new.converted_contact_id) then
    update public.activities
    set
      contact_id = coalesce(contact_id, new.converted_contact_id),
      account_id = coalesce(account_id, new.converted_account_id)
    where lead_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_carry_lead_activities on public.leads;
create trigger trg_carry_lead_activities
  after update of converted_contact_id on public.leads
  for each row
  execute function public.carry_lead_activities_to_contact();

commit;
