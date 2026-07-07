-- ---------------------------------------------------------------------
-- Bulk archive: optionally include already-converted leads.
--
-- 20260707100000 matches by id OR email but still hard-filters
-- `converted_at is null`, so a lead that's already been converted to a
-- contact never matches — even when the file lists its exact id/email.
-- That's the right default (you normally archive un-converted junk), but
-- when someone wants to clean up the leftover LEAD rows for contacts that
-- already exist, they need those converted rows to match too.
--
-- Fix: add `p_include_converted boolean default false`. When true, drop the
-- `converted_at is null` guard from both the count and the update so the
-- file matches converted leads as well. Archiving a converted lead only
-- hides/stamps the lead row — it never touches the contact it became.
--
-- Signature changes (adds a 5th arg), so DROP the old 4-arg function first
-- to avoid leaving a stale overload that PostgREST could resolve against.
-- ---------------------------------------------------------------------

begin;

drop function if exists public.bulk_archive_leads_by_list(uuid[], text[], text, boolean);

create or replace function public.bulk_archive_leads_by_list(
  p_ids uuid[],
  p_emails text[],
  p_reason text,
  p_dry_run boolean default true,
  p_include_converted boolean default false
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

  -- Count: union of id-matches and email-matches (dedup'd). When
  -- p_include_converted is false we keep the historical `converted_at is null`
  -- guard; when true we let converted leads match too.
  with matched as (
    select l.id, l.archived_at
      from public.leads l
     where (p_include_converted or l.converted_at is null)
       and l.id = any(coalesce(p_ids, '{}'::uuid[]))
    union
    select l.id, l.archived_at
      from public.leads l
     where (p_include_converted or l.converted_at is null)
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
       where (p_include_converted or l.converted_at is null)
         and l.id = any(coalesce(p_ids, '{}'::uuid[]))
      union
      select l.id
        from public.leads l
       where (p_include_converted or l.converted_at is null)
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
