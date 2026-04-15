-- Phase 8: Renewal automation.
--
-- Replaces the Salesforce automation that duplicated last year's closed_won
-- opportunities a few months before their contract_end_date so renewals show
-- up in the pipeline early.
--
-- Behavior:
--   * Daily cron calls generate_upcoming_renewals()
--   * For each closed_won opportunity whose contract_end_date is within
--     renewal_lookahead_days of today, and which has no live child renewal,
--     insert a new opportunity:
--       - name: "<parent name> (Renewal <new FY>)"
--       - kind: renewal, team: renewals, stage: lead
--       - contract_start_date: parent.contract_end_date + 1 day
--       - contract_end_date: shifted 1 year forward
--       - expected_close_date: parent.contract_end_date (close before current expires)
--       - amount/service/product amounts: copied from parent
--       - primary_contact_id, owner_user_id: copied
--       - renewal_from_opportunity_id: parent.id
--       - auto_renewal: true
--     And clone any opportunity_products line items.
--   * Accounts with renewal_type = 'no_auto_renew' are skipped.
--   * A run log is kept in renewal_automation_runs.

begin;

-- -------------------------------------------------------------------
-- 1. Config table (single row, key/value style for flexibility)
-- -------------------------------------------------------------------
create table if not exists public.renewal_automation_config (
  id smallint primary key default 1,
  enabled boolean not null default true,
  lookahead_days integer not null default 120 check (lookahead_days between 30 and 365),
  last_run_at timestamptz,
  last_run_created_count integer,
  last_run_error text,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint renewal_automation_config_singleton check (id = 1)
);

insert into public.renewal_automation_config (id)
values (1)
on conflict (id) do nothing;

alter table public.renewal_automation_config enable row level security;

drop policy if exists "renewal_config_admin_read" on public.renewal_automation_config;
create policy "renewal_config_admin_read"
on public.renewal_automation_config
for select to authenticated
using (public.is_admin());

drop policy if exists "renewal_config_admin_write" on public.renewal_automation_config;
create policy "renewal_config_admin_write"
on public.renewal_automation_config
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- -------------------------------------------------------------------
-- 2. Run log
-- -------------------------------------------------------------------
create table if not exists public.renewal_automation_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  created_count integer not null default 0,
  skipped_count integer not null default 0,
  error_message text,
  triggered_by text not null default 'cron' check (triggered_by in ('cron', 'manual'))
);

alter table public.renewal_automation_runs enable row level security;

drop policy if exists "renewal_runs_admin_read" on public.renewal_automation_runs;
create policy "renewal_runs_admin_read"
on public.renewal_automation_runs
for select to authenticated
using (public.is_admin());

create index if not exists idx_renewal_runs_started
  on public.renewal_automation_runs (started_at desc);

-- -------------------------------------------------------------------
-- 3. The generator function
-- -------------------------------------------------------------------
create or replace function public.generate_upcoming_renewals(
  triggered_by text default 'cron'
)
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config        public.renewal_automation_config%rowtype;
  v_parent        record;
  v_new_opp_id    uuid;
  v_new_start     date;
  v_new_end       date;
  v_new_close     date;
  v_new_name      text;
  v_created       integer := 0;
  v_skipped       integer := 0;
  v_run_id        bigint;
  v_err           text;
begin
  select * into v_config from public.renewal_automation_config where id = 1;

  if not found or not v_config.enabled then
    return query select 0, 0;
    return;
  end if;

  insert into public.renewal_automation_runs (triggered_by)
  values (coalesce(triggered_by, 'cron'))
  returning id into v_run_id;

  begin
    for v_parent in
      select
        o.*,
        a.renewal_type as account_renewal_type
      from public.opportunities o
      join public.accounts a on a.id = o.account_id
      where o.archived_at is null
        and a.archived_at is null
        and o.stage = 'closed_won'
        and o.contract_end_date is not null
        and o.contract_end_date between current_date
                                    and current_date + (v_config.lookahead_days || ' days')::interval
        and coalesce(a.renewal_type::text, 'manual_renew') <> 'no_auto_renew'
        -- No live child renewal already exists
        and not exists (
          select 1 from public.opportunities child
          where child.renewal_from_opportunity_id = o.id
            and child.archived_at is null
        )
    loop
      v_new_start := v_parent.contract_end_date + interval '1 day';
      v_new_end   := (v_parent.contract_end_date + interval '1 year')::date;
      v_new_close := v_parent.contract_end_date;
      v_new_name  := v_parent.name || ' (Renewal ' || to_char(v_new_start, 'YYYY') || ')';

      insert into public.opportunities (
        name,
        account_id,
        primary_contact_id,
        owner_user_id,
        team,
        kind,
        stage,
        amount,
        service_amount,
        product_amount,
        services_included,
        service_description,
        contract_start_date,
        contract_end_date,
        expected_close_date,
        renewal_from_opportunity_id,
        auto_renewal,
        notes
      )
      values (
        v_new_name,
        v_parent.account_id,
        v_parent.primary_contact_id,
        v_parent.owner_user_id,
        'renewals',
        'renewal',
        'lead',
        v_parent.amount,
        coalesce(v_parent.service_amount, 0),
        coalesce(v_parent.product_amount, 0),
        coalesce(v_parent.services_included, true),
        v_parent.service_description,
        v_new_start,
        v_new_end,
        v_new_close,
        v_parent.id,
        true,
        format(
          'Auto-generated renewal from %s (contract end %s).',
          v_parent.name,
          to_char(v_parent.contract_end_date, 'YYYY-MM-DD')
        )
      )
      returning id into v_new_opp_id;

      -- Clone line items
      insert into public.opportunity_products (
        opportunity_id, product_id, quantity, unit_price, discount_percent, total_price
      )
      select
        v_new_opp_id, product_id, quantity, unit_price, discount_percent, total_price
      from public.opportunity_products
      where opportunity_id = v_parent.id;

      v_created := v_created + 1;
    end loop;

    update public.renewal_automation_runs
    set finished_at = timezone('utc', now()),
        created_count = v_created,
        skipped_count = v_skipped
    where id = v_run_id;

    update public.renewal_automation_config
    set last_run_at = timezone('utc', now()),
        last_run_created_count = v_created,
        last_run_error = null,
        updated_at = timezone('utc', now())
    where id = 1;

  exception when others then
    v_err := sqlerrm;
    update public.renewal_automation_runs
    set finished_at = timezone('utc', now()),
        created_count = v_created,
        skipped_count = v_skipped,
        error_message = v_err
    where id = v_run_id;

    update public.renewal_automation_config
    set last_run_at = timezone('utc', now()),
        last_run_created_count = v_created,
        last_run_error = v_err,
        updated_at = timezone('utc', now())
    where id = 1;
    raise;
  end;

  return query select v_created, v_skipped;
end;
$$;

grant execute on function public.generate_upcoming_renewals(text) to authenticated;

-- Wrapper for admin-triggered manual run with an RLS check on the caller.
create or replace function public.run_renewal_automation_now()
returns table (created_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can trigger renewal automation';
  end if;
  return query select * from public.generate_upcoming_renewals('manual');
end;
$$;

grant execute on function public.run_renewal_automation_now() to authenticated;

-- -------------------------------------------------------------------
-- 4. pg_cron schedule (if the extension is available)
--    Runs daily at 09:00 UTC. Skips silently if pg_cron not installed.
-- -------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Remove any prior schedule with this name
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'renewal_automation_daily';

    perform cron.schedule(
      'renewal_automation_daily',
      '0 9 * * *',
      $cron$select public.generate_upcoming_renewals('cron');$cron$
    );
  end if;
end $$;

commit;
