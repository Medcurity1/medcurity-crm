-- Custom pipeline views
create table if not exists public.pipeline_views (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references public.user_profiles (id),
  is_shared boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  -- config schema: { stages: string[], team_filter?: string, kind_filter?: string, sort_by?: string }
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_pipeline_views_owner on public.pipeline_views (owner_user_id);

drop trigger if exists trg_pipeline_views_updated_at on public.pipeline_views;
drop trigger if exists trg_pipeline_views_updated_at on public.pipeline_views;
create trigger trg_pipeline_views_updated_at
before update on public.pipeline_views
for each row execute function public.set_updated_at();

alter table public.pipeline_views enable row level security;

drop policy if exists "pipeline_views_read" on public.pipeline_views;
drop policy if exists "pipeline_views_read" on public.pipeline_views;
create policy "pipeline_views_read"
on public.pipeline_views
for select
to authenticated
using (owner_user_id = auth.uid() or is_shared = true);

drop policy if exists "pipeline_views_insert" on public.pipeline_views;
drop policy if exists "pipeline_views_insert" on public.pipeline_views;
create policy "pipeline_views_insert"
on public.pipeline_views
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists "pipeline_views_update" on public.pipeline_views;
drop policy if exists "pipeline_views_update" on public.pipeline_views;
create policy "pipeline_views_update"
on public.pipeline_views
for update
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "pipeline_views_delete" on public.pipeline_views;
drop policy if exists "pipeline_views_delete" on public.pipeline_views;
create policy "pipeline_views_delete"
on public.pipeline_views
for delete
to authenticated
using (owner_user_id = auth.uid());

-- Saved reports
create table if not exists public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null references public.user_profiles (id),
  is_shared boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  -- config schema: { entity: string, columns: string[], filters: Filter[], sort: Sort, group_by?: string }
  -- Added in 20260403000002 originally as a separate ALTER, but
  -- the ALTER was now guarded by a table-exists check; baking the
  -- column directly into the CREATE makes a fresh DB land on the
  -- same shape regardless of migration order.
  folder text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_saved_reports_owner on public.saved_reports (owner_user_id);

drop trigger if exists trg_saved_reports_updated_at on public.saved_reports;
drop trigger if exists trg_saved_reports_updated_at on public.saved_reports;
create trigger trg_saved_reports_updated_at
before update on public.saved_reports
for each row execute function public.set_updated_at();

alter table public.saved_reports enable row level security;

drop policy if exists "saved_reports_read" on public.saved_reports;
drop policy if exists "saved_reports_read" on public.saved_reports;
create policy "saved_reports_read"
on public.saved_reports
for select
to authenticated
using (owner_user_id = auth.uid() or is_shared = true);

drop policy if exists "saved_reports_insert" on public.saved_reports;
drop policy if exists "saved_reports_insert" on public.saved_reports;
create policy "saved_reports_insert"
on public.saved_reports
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists "saved_reports_update" on public.saved_reports;
drop policy if exists "saved_reports_update" on public.saved_reports;
create policy "saved_reports_update"
on public.saved_reports
for update
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "saved_reports_delete" on public.saved_reports;
drop policy if exists "saved_reports_delete" on public.saved_reports;
create policy "saved_reports_delete"
on public.saved_reports
for delete
to authenticated
using (owner_user_id = auth.uid());
