-- ---------------------------------------------------------------------
-- Automatic account Customer Status  (Summer's Account Type request,
-- 2026-06-29: "I would Prefer just Clients, Prospects, and Former Clients"
-- + "Automated is always better").
--
-- Adds a derived, always-maintained `customer_status` on accounts:
--     client        — has a closed-won deal whose contract is still live
--     former_client — bought before, nothing live now
--     prospect      — never closed-won
--
-- The rule is COPIED from v_marketing_suppression (20260624000007), the
-- Brayden-blessed "are they a customer" signal that already drives the
-- do-not-email list and the dashboard. So this badge agrees with both by
-- construction (a live contract = contract_end_date >= today, or, when no
-- end date is set, close_date within the last 365 days).
--
-- Why a NEW column instead of reusing accounts.lifecycle_status (which is
-- the same 3-state enum): lifecycle_status is referenced by ~20 SQL views
-- and ~20 frontend files and is written by the account form on every save;
-- repurposing it risks shifting reported numbers. A dedicated column has
-- zero blast radius.
--
-- Maintenance: triggers on opportunities keep it fresh on every deal
-- change (exception-safe — a derivation bug can never block a deal save),
-- and a daily pg_cron sweep catches contracts lapsing past today. A narrow
-- override (set ONLY by the closed-lost "still contracted?" prompt) lets a
-- rep correct it; everything else is automatic.
-- ---------------------------------------------------------------------

begin;

-- 1. Columns -----------------------------------------------------------
alter table public.accounts
  add column if not exists customer_status text not null default 'prospect'
    check (customer_status in ('client', 'prospect', 'former_client')),
  -- Override: only the closed-lost prompt (or an admin clearing it) writes
  -- this. NULL = fully automatic. Only the "demote/keep" answers are
  -- meaningful, so the allowed values are client | former_client.
  add column if not exists customer_status_override text
    check (customer_status_override in ('client', 'former_client')),
  add column if not exists customer_status_override_reason text,
  add column if not exists customer_status_override_at timestamptz,
  add column if not exists customer_status_override_by uuid
    references public.user_profiles (id) on delete set null,
  add column if not exists customer_status_derived_at timestamptz;

create index if not exists idx_accounts_customer_status
  on public.accounts (customer_status);

-- 2. Pure derivation (no override) — mirrors v_marketing_suppression ----
create or replace function public.derive_account_customer_status(p_account_id uuid)
returns text
language sql
stable
as $$
  select case
    -- Any closed-won deal whose contract is still live → client.
    when bool_or(
           (o.contract_end_date is not null and o.contract_end_date >= current_date)
           or (o.contract_end_date is null and o.close_date is not null
               and o.close_date >= current_date - 365)
         ) then 'client'
    -- Had a closed-won at some point, but none live now → former_client.
    when count(*) > 0 then 'former_client'
    -- Never closed-won → prospect.
    else 'prospect'
  end
  from public.opportunities o
  where o.account_id = p_account_id
    and o.stage = 'closed_won'
    and o.archived_at is null;
$$;

comment on function public.derive_account_customer_status(uuid) is
  'Pure customer-hood from closed-won contract dates. Mirrors v_marketing_suppression. Does NOT consider the manual override.';

-- 3. Recompute one account (override wins; writes only on change) -------
create or replace function public.recompute_account_customer_status(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_final text;
begin
  if p_account_id is null then
    return;
  end if;
  select coalesce(a.customer_status_override, public.derive_account_customer_status(a.id))
    into v_final
    from public.accounts a
   where a.id = p_account_id;
  if v_final is null then
    return;  -- account not found
  end if;
  update public.accounts
     set customer_status = v_final,
         customer_status_derived_at = now()
   where id = p_account_id
     and customer_status is distinct from v_final;  -- no-op writes avoided
end;
$$;

-- 4. Opportunity trigger — recompute the affected account(s), never block
--    the parent write (a derivation failure degrades to a warning) -------
create or replace function public.trg_opp_recompute_customer_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'DELETE' then
      perform public.recompute_account_customer_status(old.account_id);
      return old;
    end if;
    -- Reparented opp: refresh the account it left, too.
    if tg_op = 'UPDATE' and old.account_id is distinct from new.account_id then
      perform public.recompute_account_customer_status(old.account_id);
    end if;
    perform public.recompute_account_customer_status(new.account_id);
    return new;
  exception when others then
    raise warning 'customer_status recompute failed for opp %: %',
      coalesce(new.id, old.id), sqlerrm;
    return coalesce(new, old);
  end;
end;
$$;

drop trigger if exists trg_opp_customer_status on public.opportunities;
create trigger trg_opp_customer_status
  after insert or update or delete on public.opportunities
  for each row execute function public.trg_opp_recompute_customer_status();

-- 5. Override setter — used by the closed-lost "still contracted?" prompt
--    and by an admin clearing an override. Pass p_override = NULL to clear.
create or replace function public.set_account_customer_status_override(
  p_account_id uuid,
  p_override text,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_crm_write_role() then
    raise exception 'insufficient privileges to set customer status';
  end if;
  if p_override is not null and p_override not in ('client', 'former_client') then
    raise exception 'invalid customer_status override: %', p_override;
  end if;
  update public.accounts
     set customer_status_override        = p_override,
         customer_status_override_reason = case when p_override is null then null else p_reason end,
         customer_status_override_at     = case when p_override is null then null else now() end,
         customer_status_override_by     = case when p_override is null then null else auth.uid() end
   where id = p_account_id;
  perform public.recompute_account_customer_status(p_account_id);
end;
$$;

grant execute on function public.set_account_customer_status_override(uuid, text, text) to authenticated;

-- 6. Daily sweep — catches contracts lapsing past today with no deal edit
create or replace function public.recompute_all_customer_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.accounts a
     set customer_status = d.new_status,
         customer_status_derived_at = now()
    from (
      select id,
             coalesce(customer_status_override,
                      public.derive_account_customer_status(id)) as new_status
        from public.accounts
    ) d
   where d.id = a.id
     and a.customer_status is distinct from d.new_status;
end;
$$;

-- 7. One-time backfill of every existing account -----------------------
update public.accounts a
   set customer_status = d.new_status,
       customer_status_derived_at = now()
  from (
    select id,
           coalesce(customer_status_override,
                    public.derive_account_customer_status(id)) as new_status
      from public.accounts
  ) d
 where d.id = a.id;

commit;

-- 8. Daily pg_cron sweep (resilient; degrades to a warning, same pattern
--    as the task-recurrence engine). Runs after the 09:00 renewal job.
do $$
declare
  v_jobid bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '[customer_status] pg_cron not installed — daily sweep not scheduled (still callable via recompute_all_customer_statuses())';
    return;
  end if;
  -- Drop any prior copy of this job by name, then (re)create it.
  perform cron.unschedule(jobid)
    from cron.job
   where jobname = 'customer-status-daily-sweep';
  v_jobid := cron.schedule(
    'customer-status-daily-sweep',
    '15 9 * * *',
    $cron$ select public.recompute_all_customer_statuses(); $cron$
  );
exception when others then
  raise warning '[customer_status] pg_cron schedule failed (sweep still callable manually): %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
