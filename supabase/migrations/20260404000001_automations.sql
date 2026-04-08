-- Process automation rules and execution log
-- Allows admins to define trigger-based automations that fire when
-- records are created, updated, or change stage/status.

create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  trigger_entity text not null check (trigger_entity in ('accounts', 'contacts', 'opportunities', 'leads')),
  trigger_event text not null check (trigger_event in ('created', 'updated', 'stage_changed', 'status_changed')),
  -- Array of condition objects: [{ field, operator, value }]
  trigger_conditions jsonb not null default '[]'::jsonb,
  -- Array of action objects: [{ type, ... }]
  -- Supported action types:
  --   update_field: { type, entity, field, value }
  --   create_activity: { type, activity_type, subject, due_offset_days? }
  --   send_notification: { type, message }
  actions jsonb not null default '[]'::jsonb,
  created_by uuid references public.user_profiles (id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger automation_rules_updated_at
  before update on public.automation_rules
  for each row execute function public.set_updated_at();

alter table public.automation_rules enable row level security;

-- All authenticated users can read automation rules
create policy "automations_read"
  on public.automation_rules
  for select to authenticated
  using (true);

-- Only admins can create/update/delete rules
create policy "automations_admin_write"
  on public.automation_rules
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Automation execution log
-- Tracks every time an automation rule fires, including success/failure.
create table if not exists public.automation_log (
  id bigint generated always as identity primary key,
  rule_id uuid not null references public.automation_rules (id) on delete cascade,
  trigger_record_id uuid not null,
  trigger_entity text not null,
  actions_executed jsonb not null default '[]'::jsonb,
  success boolean not null default true,
  error_message text,
  executed_at timestamptz not null default timezone('utc', now())
);

alter table public.automation_log enable row level security;

-- Only admins can view the execution log
create policy "automation_log_read"
  on public.automation_log
  for select to authenticated
  using (public.is_admin());

-- Index for looking up logs by rule
create index if not exists idx_automation_log_rule
  on public.automation_log (rule_id, executed_at desc);

-- Index for looking up logs by trigger record
create index if not exists idx_automation_log_record
  on public.automation_log (trigger_record_id, executed_at desc);
