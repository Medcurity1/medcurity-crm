-- ---------------------------------------------------------------------
-- Perf fix for bulk_archive_leads_by_list.
--
-- The first version matched by `id = ANY(p_ids) OR lower(email) = ANY(...)`.
-- The email half forced a sequential scan of the whole leads table against a
-- multi-thousand-element array; on a real ~8k-row list the UPDATE (plus
-- per-row triggers) blew past the statement timeout and failed.
--
-- Fix: match by lead id ONLY, via the primary-key index. The verification
-- export's `ID` column IS the CRM lead id (confirmed: 100% valid UUIDs), so
-- id-matching is exact AND complete — email matching added nothing but cost.
-- The client also chunks the id list so each call stays small and fast.
-- Same signature (p_emails kept but ignored) so the UI contract is unchanged.
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
  v_matched int;
  v_already int;
  v_archived int := 0;
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'bulk cleaning');
  v_uid uuid := auth.uid();
begin
  if public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  -- Match by lead id via the PK index. Fast, exact, and complete for these
  -- exports. (p_emails is intentionally unused — see migration note.)
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

commit;

notify pgrst, 'reload schema';
