-- ---------------------------------------------------------------------
-- Fix: resolve_lead_ids_by_email silently truncated at 1,000 matches.
-- It returned SETOF uuid, and PostgREST caps set-returning results at
-- db-max-rows (1000) — so a 2,000-email chunk could only ever match
-- 1,000 leads. Caught during the staging perf test of Jordan's-list
-- sizing (card read "1,000 of 1,957 emails found"). Return a single
-- uuid[] instead — one scalar value, no row cap.
-- ---------------------------------------------------------------------

begin;

drop function if exists public.resolve_lead_ids_by_email(text[]);

create or replace function public.resolve_lead_ids_by_email(p_emails text[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid[];
begin
  if public.current_app_role() is null
     or public.current_app_role() not in ('admin', 'super_admin') then
    raise exception 'Not authorized';
  end if;

  select coalesce(array_agg(distinct l.id), '{}'::uuid[])
    into v
    from public.leads l
    join unnest(coalesce(p_emails, '{}'::text[])) e(email)
      on lower(l.email) = lower(btrim(e.email));

  return v;
end;
$$;
grant execute on function public.resolve_lead_ids_by_email(text[]) to authenticated;

commit;

notify pgrst, 'reload schema';
