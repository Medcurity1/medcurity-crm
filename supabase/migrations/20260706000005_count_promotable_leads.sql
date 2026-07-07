-- ---------------------------------------------------------------------
-- Preview counts for "Bulk promote from file" (Phase 2 of the lead cleanup).
--
-- The actual promotion reuses the existing, battle-tested
-- bulk_promote_imports(uuid[]) — this function just powers the dry-run
-- PREVIEW so an admin can see, before committing, how many matched leads
-- will actually become contacts vs. be skipped. Mirrors bulk_promote_imports'
-- own skip rules exactly:
--   - already_done   : status='converted' OR converted_account_id set OR archived
--   - already_contact: eligible otherwise, but the email already has a live contact
--   - promotable     : everything else (these will be promoted)
-- Admin-only. Callers chunk the id list to keep each call fast.
-- ---------------------------------------------------------------------

begin;

create or replace function public.count_promotable_leads(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v jsonb;
begin
  if public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  select jsonb_build_object(
    'matched',         count(*),
    'promotable',      count(*) filter (where eligible and not is_contact),
    'already_done',    count(*) filter (where not eligible),
    'already_contact', count(*) filter (where eligible and is_contact)
  )
  into v
  from (
    select
      (l.status is distinct from 'converted'::public.lead_status
        and l.converted_account_id is null
        and l.archived_at is null) as eligible,
      (l.email is not null and exists (
        select 1 from public.contacts c
         where lower(c.email) = lower(l.email) and c.archived_at is null
      )) as is_contact
    from public.leads l
    where l.id = any(coalesce(p_ids, '{}'::uuid[]))
  ) t;

  return v;
end;
$$;

grant execute on function public.count_promotable_leads(uuid[]) to authenticated;

commit;

notify pgrst, 'reload schema';
