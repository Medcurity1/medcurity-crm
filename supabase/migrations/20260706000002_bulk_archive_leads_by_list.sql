-- ---------------------------------------------------------------------
-- Bulk-archive imports (leads) from an uploaded verification list.
--
-- Use case: an email-verification tool (e.g. MillionVerifier) is run over
-- the leads and returns files labelling them bad / risky / good. Admins
-- upload the bad + risky files; this matches those rows against existing
-- leads (by lead id and/or email) and archives them in one shot, stamped
-- with a reason — using the SAME fields mark_import_avoid uses, so the
-- archived leads are excluded from all future imports / dedup and never
-- creep back in.
--
-- Supports a dry-run mode so the UI can PREVIEW the match counts before
-- anything is actually archived. Admin-only.
-- ---------------------------------------------------------------------

begin;

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
  v_lower_emails text[];
  v_matched int;
  v_already int;
  v_archived int := 0;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'bulk cleaning');
  v_uid uuid := auth.uid();
begin
  if public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  -- Normalise the email list once (lowercased, blanks / em-dash placeholders dropped).
  select array_agg(lower(btrim(e)))
    into v_lower_emails
    from unnest(coalesce(p_emails, '{}')) e
   where e is not null and btrim(e) <> '' and btrim(e) <> '—';

  -- Count what would be affected. Converted leads are tombstones — leave them.
  with m as (
    select l.archived_at
      from public.leads l
     where l.converted_at is null
       and (
         l.id = any(coalesce(p_ids, '{}'::uuid[]))
         or (v_lower_emails is not null and l.email is not null and lower(l.email) = any(v_lower_emails))
       )
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
       and (
         l.id = any(coalesce(p_ids, '{}'::uuid[]))
         or (v_lower_emails is not null and l.email is not null and lower(l.email) = any(v_lower_emails))
       );
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

grant execute on function public.bulk_archive_leads_by_list(uuid[], text[], text, boolean) to authenticated;

commit;

notify pgrst, 'reload schema';
