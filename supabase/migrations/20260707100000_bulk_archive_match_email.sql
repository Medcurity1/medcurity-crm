-- ---------------------------------------------------------------------
-- Bulk archive: match by lead id OR email (not id only).
--
-- 20260706000004 dropped email matching because `id = ANY(...) OR
-- lower(email) = ANY(...)` seq-scanned the whole leads table and blew the
-- statement timeout on ~8k lists. But an id-only match means a file that
-- has emails but not the internal UUID column (e.g. a plain leads-list
-- export) matches nothing.
--
-- Fix: (1) add an expression index on lower(btrim(email)) so email lookups
-- are index-backed, and (2) match id and email as a UNION of two separate
-- index-friendly scans (PK for ids, the new index for emails) instead of an
-- OR — the UNION lets the planner use each index and avoids the seq-scan.
-- ---------------------------------------------------------------------

begin;

create index if not exists idx_leads_lower_email
  on public.leads (lower(btrim(email)))
  where email is not null;

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
  v_emails text[];
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  -- Normalize the incoming emails once (lower + btrim, drop blanks) so the
  -- comparison matches the lower(btrim(email)) expression index.
  select coalesce(array_agg(distinct e), '{}'::text[]) into v_emails
    from (
      select lower(btrim(x)) as e
      from unnest(coalesce(p_emails, '{}'::text[])) as x
      where nullif(btrim(x), '') is not null
    ) s;

  -- Count: union of id-matches and email-matches (dedup'd), non-converted only.
  with matched as (
    select l.id, l.archived_at
      from public.leads l
     where l.converted_at is null
       and l.id = any(coalesce(p_ids, '{}'::uuid[]))
    union
    select l.id, l.archived_at
      from public.leads l
     where l.converted_at is null
       and l.email is not null
       and lower(btrim(l.email)) = any(v_emails)
  )
  select count(*), count(*) filter (where archived_at is not null)
    into v_matched, v_already
    from matched;

  if not p_dry_run then
    with matched as (
      select l.id
        from public.leads l
       where l.converted_at is null
         and l.id = any(coalesce(p_ids, '{}'::uuid[]))
      union
      select l.id
        from public.leads l
       where l.converted_at is null
         and l.email is not null
         and lower(btrim(l.email)) = any(v_emails)
    )
    update public.leads l
       set avoid_reason   = v_reason,
           archived_at    = coalesce(l.archived_at, timezone('utc', now())),
           archived_by    = coalesce(l.archived_by, v_uid),
           archive_reason = coalesce(l.archive_reason, 'Avoid: ' || v_reason)
     where l.id in (select id from matched)
       and l.archived_at is null;
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

commit;

notify pgrst, 'reload schema';
