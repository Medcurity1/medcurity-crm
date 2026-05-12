-- Dashboard milestones storage — moves the Development line items off
-- per-browser localStorage and into Postgres so the TV view (different
-- browser, same domain) sees the same list the laptop edits.
--
-- Shape: single-row key-value table, jsonb array of milestones. Brayden
-- typically has <20 rows; full-array write-through on each change is
-- cheap and keeps the React component code trivial. Matches the
-- `Milestone` interface in src/features/reports/dashboardMilestones.ts.
--
-- RLS: any authenticated user can read+write. The owner-only edit gate
-- already lives in the UI; the TV browser is logged in to the CRM so
-- it can SELECT just like any other tab.

begin;

create table if not exists public.dashboard_milestones (
  -- Singleton row. PK is fixed text so upserts always hit the same row.
  key         text primary key,
  items       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default timezone('utc', now()),
  updated_by  uuid references auth.users(id)
);

-- Seed the singleton row so the first SELECT returns an empty list
-- rather than no rows (which the client would otherwise have to treat
-- as a separate cold-start case).
insert into public.dashboard_milestones (key, items)
values ('singleton', '[]'::jsonb)
on conflict (key) do nothing;

alter table public.dashboard_milestones enable row level security;

drop policy if exists "dashboard_milestones_read" on public.dashboard_milestones;
create policy "dashboard_milestones_read"
  on public.dashboard_milestones
  for select
  to authenticated
  using (true);

drop policy if exists "dashboard_milestones_write" on public.dashboard_milestones;
create policy "dashboard_milestones_write"
  on public.dashboard_milestones
  for all
  to authenticated
  using (true)
  with check (true);

-- Keep updated_at fresh on every UPDATE.
create or replace function public.dashboard_milestones_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists dashboard_milestones_touch_trg on public.dashboard_milestones;
create trigger dashboard_milestones_touch_trg
  before update on public.dashboard_milestones
  for each row execute function public.dashboard_milestones_touch();

commit;
