-- ---------------------------------------------------------------------
-- Two fixes on the requests feature.
--
-- (A) SECURITY — request-attachments storage bucket was wide open.
--     The metadata table request_attachments is correctly scoped to
--     requester-or-admin, but the storage.objects policies granted
--     SELECT and INSERT to ANY authenticated user for the whole bucket:
--
--       using (bucket_id = 'request-attachments')            -- select
--       with check (bucket_id = 'request-attachments')       -- insert
--
--     So any logged-in user (e.g. a sales rep, or a deactivated user with
--     a still-valid token) could list the bucket and createSignedUrl() to
--     download attachments on requests they aren't allowed to see, and
--     could upload junk to any path. There was also no DELETE policy, so
--     the client's orphan-cleanup (remove the object if the metadata
--     insert fails) was silently denied and orphans accumulated.
--
--     Upload path convention is `${request_id}/${...}` (see
--     src/features/requests/api.ts), so (storage.foldername(name))[1] is
--     the request id. Scope every object policy through the parent
--     request — SELECT rides the requests table's own RLS (mirrors the
--     metadata table exactly); INSERT/DELETE require the caller to own the
--     request or be an admin.
--
-- (B) ROBUSTNESS — notify_request_resolved inserted the notification
--     without an exception guard, so any future failure inserting it
--     (e.g. a notifications constraint change) would abort the admin's
--     "Mark complete" UPDATE itself. A courtesy ping must never block the
--     actual resolution. Wrap it, matching trg_opp_record_win's pattern.
-- ---------------------------------------------------------------------

begin;

-- ── (A) Storage object policies ──────────────────────────────────────

-- SELECT: only objects whose parent request the caller can see. The
-- subquery runs under the caller's RLS on public.requests (requester or
-- admin), so this mirrors the request_attachments metadata policy.
drop policy if exists "request_attachments_obj_select" on storage.objects;
create policy "request_attachments_obj_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'request-attachments'
    and exists (
      select 1 from public.requests r
      where r.id::text = (storage.foldername(name))[1]
    )
  );

-- INSERT: only into a folder for a request the caller owns (or as admin).
-- The request row is created before its files upload, so this passes for
-- legitimate submissions.
drop policy if exists "request_attachments_obj_insert" on storage.objects;
create policy "request_attachments_obj_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'request-attachments'
    and (
      exists (
        select 1 from public.requests r
        where r.id::text = (storage.foldername(name))[1]
          and r.requester_user_id = auth.uid()
      )
      or public.current_app_role() in ('admin', 'super_admin')
    )
  );

-- DELETE: request owner (needed for the client's orphan rollback) or admin.
drop policy if exists "request_attachments_obj_delete" on storage.objects;
create policy "request_attachments_obj_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'request-attachments'
    and (
      exists (
        select 1 from public.requests r
        where r.id::text = (storage.foldername(name))[1]
          and r.requester_user_id = auth.uid()
      )
      or public.current_app_role() in ('admin', 'super_admin')
    )
  );

-- ── (B) Harden the resolve-notification trigger ─────────────────────

create or replace function public.notify_request_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_verb text;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.requester_user_id is null then
    return new;
  end if;

  v_verb := case new.status
    when 'completed' then 'completed'
    when 'approved'  then 'approved'
    when 'denied'    then 'denied'
    else null
  end;
  if v_verb is null then
    return new;
  end if;

  -- Don't notify the submitter if they resolved it themselves.
  if new.completed_by is not null and new.completed_by = new.requester_user_id then
    return new;
  end if;

  -- A courtesy notification must never abort the resolution itself.
  begin
    insert into public.notifications (user_id, type, title, message, link)
    values (
      new.requester_user_id,
      'system',
      'Request ' || v_verb,
      coalesce(nullif(btrim(new.title), ''), 'Your request') || ' was ' || v_verb || '.',
      '/requests'
    );
  exception when others then
    -- Swallow: the request status change must still commit.
    null;
  end;

  return new;
end;
$$;

commit;

notify pgrst, 'reload schema';
