-- ---------------------------------------------------------------------
-- Customer Status refinements (from the adversarial review of 20260630000002).
--
-- 1. ONE-TIME PROJECTS no longer count as an active "Client". The dashboard
--    customer count + ARR (20260625000006) exclude one_time_project deals, so a
--    one-time project leaving the badge as "Client" disagreed with the customer
--    tiles. Now: a one-time-project deal never makes an account a Client, but a
--    past one (like any past closed-won) still makes them a Former Client rather
--    than a Prospect.
--
-- 2. STALE "Former Client" OVERRIDE auto-clears. A rep's closed-lost
--    "they've left" override is meant to catch an early churn the contract dates
--    don't show yet. But if the account later lands a NEW closed-won with a live
--    contract (created AFTER the override), they've clearly come back, so the
--    override is obsolete and recompute now drops it instead of pinning them
--    Former Client forever.
--
-- The daily sweep now routes every account through recompute() so the auto-clear
-- applies there too, and a one-time re-backfill corrects existing rows.
-- ---------------------------------------------------------------------

begin;

-- 1. Derivation: one-time projects don't make a Client (Option C) -------
create or replace function public.derive_account_customer_status(p_account_id uuid)
returns text
language sql
stable
as $$
  select case
    -- Client = an ONGOING (non one-time) closed-won whose contract is still live.
    when bool_or(
           coalesce(o.one_time_project, false) = false
           and (
             (o.contract_end_date is not null and o.contract_end_date >= current_date)
             or (o.contract_end_date is null and o.close_date is not null
                 and o.close_date >= current_date - 365)
           )
         ) then 'client'
    -- Bought before (including one-time projects), nothing ongoing-live now.
    when count(*) > 0 then 'former_client'
    else 'prospect'
  end
  from public.opportunities o
  where o.account_id = p_account_id
    and o.stage = 'closed_won'
    and o.archived_at is null;
$$;

comment on function public.derive_account_customer_status(uuid) is
  'Pure customer-hood from ongoing (non one-time) closed-won contract dates. Agrees with the dashboard customer count. Does NOT consider the manual override.';

-- 2. Recompute: auto-clear a stale former_client override --------------
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
  if p_account_id is null then
    return;
  end if;

  select a.customer_status_override, a.customer_status_override_at
    into v_override, v_override_at
    from public.accounts a
   where a.id = p_account_id;

  v_derived := public.derive_account_customer_status(p_account_id);

  -- A 'former_client' override is obsolete once the account lands a NEW
  -- closed-won (created after the override) that makes it a live client again —
  -- they came back. Clear it so the automation takes over. (A still-live
  -- contract that PRE-DATES the override is the intended override case — the
  -- rep knows it's effectively dead — so the created_at filter preserves that.)
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

-- 3. Daily sweep routes every account through recompute() so the auto-clear
--    + one-time rule apply uniformly (5,600 accounts -> a few seconds/day).
create or replace function public.recompute_all_customer_statuses()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from public.accounts loop
    perform public.recompute_account_customer_status(r.id);
  end loop;
end;
$$;

-- 4. Re-backfill so existing rows reflect the new one-time rule + auto-clear.
do $$
declare
  r record;
begin
  for r in select id from public.accounts loop
    perform public.recompute_account_customer_status(r.id);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
