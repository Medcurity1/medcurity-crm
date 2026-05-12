-- Dashboard goals + widgets storage — moves the per-quarter goal store
-- and the manual-entry widgets (Most Recent Quote, QTD Billing actual,
-- Dev project line items) off per-browser localStorage and into
-- Postgres. Mirrors the dashboard_milestones table that already exists
-- (see 20260512000001_dashboard_milestones.sql).
--
-- Name note: `dashboard_widgets` is already taken by an older
-- migration (20260404000003_mql_sql_and_sequences.sql) for an unused
-- per-user widget-config store. We pick `team_dashboard_widgets` to
-- avoid the collision rather than dropping the orphan table.
--
-- Why two tables instead of one: goals and widgets are read/written
-- independently by different components, and goals has a separate
-- "locks" payload that's edited from the admin page. Keeping them
-- distinct rows means an edit on one doesn't invalidate the other's
-- query cache.
--
-- Shape: singleton-row tables, full-blob jsonb payloads. Brayden
-- typically has a handful of quarters of goal data and a small widgets
-- object — full-blob write-through on each change is cheap and keeps
-- the React component code trivial.
--
-- RLS: any authenticated user can read+write. The owner-only edit gate
-- already lives in the UI; the TV browser is logged in to the CRM so
-- it can SELECT just like any other tab.

begin;

-- ---------------------------------------------------------------------
-- dashboard_goals — per-quarter goal store + lock state
-- ---------------------------------------------------------------------
create table if not exists public.dashboard_goals (
  key         text primary key,
  -- The full localStorage payload (dashboard_goals_by_quarter_v1 or
  -- dashboard_goals_lock_by_quarter_v1) is stored verbatim in `data`.
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default timezone('utc', now()),
  updated_by  uuid references auth.users(id)
);

insert into public.dashboard_goals (key, data)
values
  ('goals_by_quarter', '{}'::jsonb),
  ('locks_by_quarter', '{}'::jsonb)
on conflict (key) do nothing;

alter table public.dashboard_goals enable row level security;

drop policy if exists "dashboard_goals_read" on public.dashboard_goals;
create policy "dashboard_goals_read"
  on public.dashboard_goals
  for select
  to authenticated
  using (true);

drop policy if exists "dashboard_goals_write" on public.dashboard_goals;
create policy "dashboard_goals_write"
  on public.dashboard_goals
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- team_dashboard_widgets — manual-entry widgets (quote, QTD billing, dev list)
-- ---------------------------------------------------------------------
create table if not exists public.team_dashboard_widgets (
  key         text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default timezone('utc', now()),
  updated_by  uuid references auth.users(id)
);

insert into public.team_dashboard_widgets (key, data)
values ('singleton', '{}'::jsonb)
on conflict (key) do nothing;

alter table public.team_dashboard_widgets enable row level security;

drop policy if exists "team_dashboard_widgets_read" on public.team_dashboard_widgets;
create policy "team_dashboard_widgets_read"
  on public.team_dashboard_widgets
  for select
  to authenticated
  using (true);

drop policy if exists "team_dashboard_widgets_write" on public.team_dashboard_widgets;
create policy "team_dashboard_widgets_write"
  on public.team_dashboard_widgets
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------
-- Shared updated_at touch trigger (one function, attached to both)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_kv_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists dashboard_goals_touch_trg on public.dashboard_goals;
create trigger dashboard_goals_touch_trg
  before update on public.dashboard_goals
  for each row execute function public.dashboard_kv_touch();

drop trigger if exists team_dashboard_widgets_touch_trg on public.team_dashboard_widgets;
create trigger team_dashboard_widgets_touch_trg
  before update on public.team_dashboard_widgets
  for each row execute function public.dashboard_kv_touch();

commit;
