-- Lead qualification tracking
do $$ begin
  if not exists (select 1 from pg_type where typname = 'lead_qualification') then
    create type public.lead_qualification as enum ('unqualified', 'mql', 'sql', 'sal');
  end if;
end $$;

alter table public.leads add column if not exists qualification public.lead_qualification default 'unqualified';
alter table public.leads add column if not exists qualification_date timestamptz;
alter table public.leads add column if not exists score integer default 0 check (score is null or score >= 0);
alter table public.leads add column if not exists score_factors jsonb default '[]'::jsonb;

-- Lead source on contacts (so we track where the contact originally came from)
alter table public.contacts add column if not exists lead_source public.lead_source;
alter table public.contacts add column if not exists original_lead_id uuid references public.leads(id);

-- Sales sequences (cadences)
create table if not exists public.sequences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  owner_user_id uuid references public.user_profiles(id),
  steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- Sequence enrollments
create table if not exists public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  lead_id uuid references public.leads(id),
  contact_id uuid references public.contacts(id),
  account_id uuid references public.accounts(id),
  owner_user_id uuid references public.user_profiles(id),
  current_step integer not null default 1,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'replied', 'bounced')),
  next_touch_at timestamptz,
  enrolled_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  paused_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_sequence_enrollments_sequence on public.sequence_enrollments(sequence_id);
create index if not exists idx_sequence_enrollments_lead on public.sequence_enrollments(lead_id);
create index if not exists idx_sequence_enrollments_status on public.sequence_enrollments(status);
create index if not exists idx_sequence_enrollments_next_touch on public.sequence_enrollments(next_touch_at) where status = 'active';

-- Targeted lead lists
create table if not exists public.lead_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_user_id uuid not null references public.user_profiles(id),
  is_dynamic boolean not null default false,
  filter_config jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.lead_list_members (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lead_lists(id) on delete cascade,
  lead_id uuid references public.leads(id),
  contact_id uuid references public.contacts(id),
  added_at timestamptz not null default timezone('utc', now()),
  unique(list_id, lead_id),
  unique(list_id, contact_id)
);

-- RLS
alter table public.sequences enable row level security;
alter table public.sequence_enrollments enable row level security;
alter table public.lead_lists enable row level security;
alter table public.lead_list_members enable row level security;

create policy "sequences_read" on public.sequences for select to authenticated using (true);
create policy "sequences_write" on public.sequences for all to authenticated using (public.current_app_role() in ('sales','admin')) with check (public.current_app_role() in ('sales','admin'));
create policy "enrollments_read" on public.sequence_enrollments for select to authenticated using (true);
create policy "enrollments_write" on public.sequence_enrollments for all to authenticated using (public.current_app_role() in ('sales','admin')) with check (public.current_app_role() in ('sales','admin'));
create policy "lead_lists_read" on public.lead_lists for select to authenticated using (owner_user_id = auth.uid() or public.is_admin());
create policy "lead_lists_write" on public.lead_lists for all to authenticated using (owner_user_id = auth.uid() or public.is_admin()) with check (owner_user_id = auth.uid() or public.is_admin());
create policy "lead_list_members_read" on public.lead_list_members for select to authenticated using (true);
create policy "lead_list_members_write" on public.lead_list_members for all to authenticated using (public.current_app_role() in ('sales','admin')) with check (public.current_app_role() in ('sales','admin'));

-- Triggers
create trigger trg_sequences_updated_at before update on public.sequences for each row execute function public.set_updated_at();
create trigger trg_sequence_enrollments_updated_at before update on public.sequence_enrollments for each row execute function public.set_updated_at();
create trigger trg_lead_lists_updated_at before update on public.lead_lists for each row execute function public.set_updated_at();

-- Dashboard widget configs
create table if not exists public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id),
  widget_type text not null,
  config jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.dashboard_widgets enable row level security;
create policy "dashboard_widgets_own" on public.dashboard_widgets for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create trigger trg_dashboard_widgets_updated_at before update on public.dashboard_widgets for each row execute function public.set_updated_at();
