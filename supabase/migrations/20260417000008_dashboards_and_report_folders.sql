-- Dashboards + report folders.
--
-- Lets users create multiple named dashboards (personal or shared) and
-- organize saved reports into folders (public / private). Mirrors the
-- Salesforce folder + dashboard UX Brayden wants to replicate at a
-- minimum for leadership-facing views.
--
-- Dashboards hold an ordered list of widgets; each widget points at a
-- pre-built widget type OR a saved_report id.

begin;

-- ---------------------------------------------------------------------
-- Folders
-- ---------------------------------------------------------------------

create table if not exists public.report_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_public boolean not null default false,
  owner_user_id uuid not null references public.user_profiles (id) on delete cascade,
  parent_folder_id uuid references public.report_folders (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint report_folders_name_not_empty check (length(trim(name)) > 0)
);

create index if not exists idx_report_folders_owner
  on public.report_folders (owner_user_id)
  where is_public = false;
create index if not exists idx_report_folders_public
  on public.report_folders (is_public)
  where is_public = true;

alter table public.report_folders enable row level security;

drop policy if exists "folders_read" on public.report_folders;
create policy "folders_read" on public.report_folders
  for select to authenticated
  using (is_public = true or owner_user_id = auth.uid() or public.is_admin());

drop policy if exists "folders_write_own" on public.report_folders;
create policy "folders_write_own" on public.report_folders
  for all to authenticated
  using (owner_user_id = auth.uid() or public.is_admin())
  with check (owner_user_id = auth.uid() or public.is_admin());

-- Add folder + privacy to saved_reports if that table exists. Not all
-- deployments have it; the IF EXISTS dance keeps this migration safe.
do $$ begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'saved_reports') then
    execute 'alter table public.saved_reports
             add column if not exists folder_id uuid references public.report_folders (id) on delete set null,
             add column if not exists is_public boolean not null default false';
    execute 'create index if not exists idx_saved_reports_folder on public.saved_reports (folder_id) where folder_id is not null';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Dashboards
-- ---------------------------------------------------------------------

create table if not exists public.dashboards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_user_id uuid not null references public.user_profiles (id) on delete cascade,
  is_public boolean not null default false,
  -- Free-form layout blob: array of { i, x, y, w, h, widget }
  -- where widget is one of { type: 'report', report_id: uuid }
  -- or a built-in like { type: 'kpi', metric: 'pipeline_arr' }.
  -- Keeping this as jsonb rather than a relational table lets admins
  -- extend widget types without schema changes.
  layout jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint dashboards_name_not_empty check (length(trim(name)) > 0)
);

create index if not exists idx_dashboards_owner
  on public.dashboards (owner_user_id)
  where is_public = false;
create index if not exists idx_dashboards_public
  on public.dashboards (is_public)
  where is_public = true;

alter table public.dashboards enable row level security;

drop policy if exists "dashboards_read" on public.dashboards;
create policy "dashboards_read" on public.dashboards
  for select to authenticated
  using (is_public = true or owner_user_id = auth.uid() or public.is_admin());

drop policy if exists "dashboards_write_own" on public.dashboards;
create policy "dashboards_write_own" on public.dashboards
  for all to authenticated
  using (owner_user_id = auth.uid() or public.is_admin())
  with check (owner_user_id = auth.uid() or public.is_admin());

-- Auto-update updated_at
create or replace function public.touch_dashboard_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;
drop trigger if exists trg_dashboards_updated_at on public.dashboards;
create trigger trg_dashboards_updated_at
  before update on public.dashboards
  for each row execute function public.touch_dashboard_updated_at();

drop trigger if exists trg_report_folders_updated_at on public.report_folders;
create trigger trg_report_folders_updated_at
  before update on public.report_folders
  for each row execute function public.touch_dashboard_updated_at();

commit;
