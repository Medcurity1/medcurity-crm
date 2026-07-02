-- ---------------------------------------------------------------------
-- Security hardening from the 2026-07-01 deep audit.
--
-- 1. Renewal RPCs (preview_upcoming_renewals, generate_upcoming_renewals)
--    were SECURITY DEFINER with NO role check — any logged-in user (even
--    read_only) could read the whole renewal pipeline or GENERATE renewal
--    opportunities. Now admin-gated for web callers; the pg_cron path is
--    unaffected (it doesn't run under an anon/authenticated JWT).
-- 2. customer_status recompute RPCs get the same treatment (write-role
--    gate for web callers; the opportunities trigger and cron sweep are
--    unaffected).
-- 3. account-attachments storage SELECT now requires an active CRM role
--    (INSERT/DELETE were already gated in 20260626000003; SELECT wasn't).
-- 4. tags / contact_tags SELECT gated on an active role (was using(true)).
--
-- Gate pattern: web callers arrive via PostgREST with auth.role() of
-- 'anon' or 'authenticated' — those must pass the role check. pg_cron /
-- direct-owner contexts have a different auth.role() and pass through.
-- ---------------------------------------------------------------------

begin;

-- ── 1. Renewal automation RPCs: rename originals, add gated wrappers ──
-- Re-emitting the large bodies here would be error-prone, so we rename
-- the originals out of reach and put gated pass-throughs at the public
-- names. Call signatures are IDENTICAL, so the admin UI, the
-- run_renewal_automation wrapper, and the cron command keep working.

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'preview_upcoming_renewals_unsafe') then
    alter function public.preview_upcoming_renewals() rename to preview_upcoming_renewals_unsafe;
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'generate_upcoming_renewals_unsafe') then
    alter function public.generate_upcoming_renewals(text) rename to generate_upcoming_renewals_unsafe;
  end if;
end $$;

-- Nobody calls the renamed originals directly.
revoke execute on function public.preview_upcoming_renewals_unsafe()      from public, anon, authenticated;
revoke execute on function public.generate_upcoming_renewals_unsafe(text) from public, anon, authenticated;

create or replace function public.preview_upcoming_renewals()
returns table (
  status                  text,
  parent_opportunity_id   uuid,
  parent_opportunity_name text,
  account_id              uuid,
  account_name            text,
  account_status          text,
  close_date              date,
  contract_signed_date    date,
  contract_end_date       date,
  contract_length_months  integer,
  contract_year           integer,
  cycle_count             integer,
  one_time_project        boolean,
  do_not_auto_renew       boolean,
  archived                boolean,
  computed_anniversary    date,
  anchor_field            text,
  days_until_anniversary  integer,
  lookahead_days          integer,
  test_account_id         uuid,
  reason                  text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_admin() then
    raise exception 'insufficient privileges';
  end if;
  return query select * from public.preview_upcoming_renewals_unsafe();
end;
$$;

create or replace function public.generate_upcoming_renewals(triggered_by text default 'cron')
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_admin() then
    raise exception 'insufficient privileges';
  end if;
  return query select * from public.generate_upcoming_renewals_unsafe(triggered_by);
end;
$$;

revoke execute on function public.preview_upcoming_renewals()      from public, anon;
revoke execute on function public.generate_upcoming_renewals(text) from public, anon;
grant execute on function public.preview_upcoming_renewals()      to authenticated;
grant execute on function public.generate_upcoming_renewals(text) to authenticated;

-- ── 2. customer_status recompute RPCs ────────────────────────────────
-- The single-account recompute runs from the opportunities trigger in a
-- normal user session, so its gate is the WRITE role — anyone who can
-- edit a deal already passes; a read_only user (or anon key holder)
-- calling the RPC directly is now blocked.
create or replace function public.recompute_account_customer_status(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_override    text;
  v_override_at timestamptz;
  v_derived     text;
  v_final       text;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not public.has_crm_write_role() then
    raise exception 'insufficient privileges';
  end if;

  if p_account_id is null then
    return;
  end if;

  select a.customer_status_override, a.customer_status_override_at
    into v_override, v_override_at
    from public.accounts a
   where a.id = p_account_id;

  v_derived := public.derive_account_customer_status(p_account_id);

  if v_override = 'former_client'
     and v_derived = 'client'
     and v_override_at is not null
     and exists (
       select 1
         from public.opportunities o
        where o.account_id = p_account_id
          and o.stage = 'closed_won'
          and o.archived_at is null
          and coalesce(o.one_time_project, false) = false
          and o.created_at > v_override_at
     ) then
    update public.accounts
       set customer_status_override        = null,
           customer_status_override_reason = null,
           customer_status_override_at     = null,
           customer_status_override_by     = null
     where id = p_account_id;
    v_override := null;
  end if;

  v_final := coalesce(v_override, v_derived);
  if v_final is null then
    return;
  end if;

  update public.accounts
     set customer_status = v_final,
         customer_status_derived_at = now()
   where id = p_account_id
     and customer_status is distinct from v_final;
end;
$$;

-- The all-accounts sweep is cron/admin-only.
create or replace function public.recompute_all_customer_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_admin() then
    raise exception 'insufficient privileges';
  end if;
  for r in select id from public.accounts loop
    perform public.recompute_account_customer_status(r.id);
  end loop;
end;
$$;

revoke execute on function public.recompute_account_customer_status(uuid) from public, anon;
revoke execute on function public.recompute_all_customer_statuses()       from public, anon;
grant execute on function public.recompute_account_customer_status(uuid) to authenticated;
grant execute on function public.recompute_all_customer_statuses()       to authenticated;

-- ── 3. account-attachments storage: SELECT requires an active role ───
drop policy if exists "account_attachments_obj_select" on storage.objects;
create policy "account_attachments_obj_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'account-attachments' and public.current_app_role() is not null);

-- ── 4. tags / contact_tags: active-role read gate ────────────────────
drop policy if exists "tags_read" on public.tags;
create policy "tags_read" on public.tags
  for select to authenticated using (public.current_app_role() is not null);

drop policy if exists "contact_tags_read" on public.contact_tags;
create policy "contact_tags_read" on public.contact_tags
  for select to authenticated using (public.current_app_role() is not null);

commit;

notify pgrst, 'reload schema';
