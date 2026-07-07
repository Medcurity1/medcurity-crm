-- ---------------------------------------------------------------------
-- Security fix: NULL-role bypass on the bulk lead functions.
--
-- current_app_role() returns NULL when the caller has no ACTIVE profile
-- (e.g. a deactivated user whose auth token is still valid, since
-- deactivation flips is_active but does not revoke the session). The
-- guard `if current_app_role() not in ('admin','super_admin')` uses SQL
-- three-valued logic: NULL not in (...) evaluates to NULL, not TRUE, so
-- the `raise` never fires and the function proceeds — a deactivated admin
-- could still reach these SECURITY DEFINER functions (which bypass RLS)
-- to mass-archive leads or enumerate counts.
--
-- Every other privileged function in this repo already guards with
-- `current_app_role() is null OR current_app_role() not in (...)`
-- (e.g. bulk_promote_imports, convert_lead). These three new functions
-- dropped the `is null` half. Restore it. Bodies are otherwise unchanged.
-- ---------------------------------------------------------------------

begin;

-- 1) bulk_archive_leads_by_list (current def: 20260706000004)
create or replace function public.bulk_archive_leads_by_list(
  p_ids uuid[],
  p_emails text[],
  p_reason text,
  p_dry_run boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_matched int;
  v_already int;
  v_archived int := 0;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'bulk cleaning');
  v_uid uuid := auth.uid();
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  with m as (
    select l.archived_at
      from public.leads l
     where l.converted_at is null
       and l.id = any(coalesce(p_ids, '{}'::uuid[]))
  )
  select count(*), count(*) filter (where archived_at is not null)
    into v_matched, v_already
    from m;

  if not p_dry_run then
    update public.leads l
       set avoid_reason   = v_reason,
           archived_at    = coalesce(l.archived_at, timezone('utc', now())),
           archived_by    = coalesce(l.archived_by, v_uid),
           archive_reason = coalesce(l.archive_reason, 'Avoid: ' || v_reason)
     where l.converted_at is null
       and l.archived_at is null
       and l.id = any(coalesce(p_ids, '{}'::uuid[]));
    get diagnostics v_archived = row_count;
  end if;

  return jsonb_build_object(
    'matched', v_matched,
    'already_archived', v_already,
    'to_archive', greatest(v_matched - v_already, 0),
    'archived', v_archived,
    'dry_run', p_dry_run
  );
end;
$$;

-- 2) count_promotable_leads (current def: 20260706000005)
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
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
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
         where public.contact_matches_email(c, l.email) and c.archived_at is null
      )) as is_contact
    from public.leads l
    where l.id = any(coalesce(p_ids, '{}'::uuid[]))
  ) t;

  return v;
end;
$$;

commit;

notify pgrst, 'reload schema';
