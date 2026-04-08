create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null,
  body text not null,
  category text, -- e.g. 'Outreach', 'Follow-up', 'Nurture'
  is_shared boolean not null default false,
  owner_user_id uuid not null references public.user_profiles(id),
  usage_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_email_templates_owner on public.email_templates(owner_user_id);
create index if not exists idx_email_templates_category on public.email_templates(category);

alter table public.email_templates enable row level security;
create policy "email_templates_read" on public.email_templates for select to authenticated
using (owner_user_id = auth.uid() or is_shared = true);
create policy "email_templates_write" on public.email_templates for all to authenticated
using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

create trigger trg_email_templates_updated_at before update on public.email_templates
for each row execute function public.set_updated_at();
