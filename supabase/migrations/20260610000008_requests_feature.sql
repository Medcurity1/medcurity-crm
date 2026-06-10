-- ---------------------------------------------------------------------
-- Requests feature (ports the Nexus "requests" workflow into the CRM).
--
-- Three request types, one table:
--   * collateral — a marketing/design ask. Worked + checked off by the
--     collateral team (routed to Jordan + Nathan).
--   * product    — a product/feature ask. Reviewed by Rachel (routed to
--     Rachel + Nathan); Approve files a Jira ticket, Deny closes it.
--   * crm        — an ask to change the CRM itself. Worked + checked off
--     (routed to Jordan + Nathan).
--
-- Submission is open to any authenticated user. The people who ACT on a
-- request are resolved from `request_routing` (a small, editable mapping)
-- rather than hardcoded emails the way Nexus did it. On insert, an
-- in-app notification fires to each routed recipient. Email notices and
-- the Jira/AI integrations are layered on top later (they need secrets);
-- this migration is the pure-DB foundation and works on its own.
-- ---------------------------------------------------------------------

begin;

-- ── Enums ────────────────────────────────────────────────────────────
do $$ begin
  create type public.request_type as enum ('collateral', 'product', 'crm');
exception when duplicate_object then null; end $$;

do $$ begin
  -- pending  → awaiting action
  -- completed→ collateral/crm checked off as done
  -- approved → product approved (Jira ticket filed)
  -- denied   → product declined
  -- cancelled→ withdrawn
  create type public.request_status as enum
    ('pending', 'completed', 'approved', 'denied', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.request_priority as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

-- ── requests table ───────────────────────────────────────────────────
create table if not exists public.requests (
  id                uuid primary key default gen_random_uuid(),
  type              public.request_type not null,
  status            public.request_status not null default 'pending',
  priority          public.request_priority not null default 'medium',
  title             text not null,
  description       text,
  -- type-specific fields live here (e.g. collateral audience/usage/format,
  -- crm change_type). Keeps the table stable as form fields evolve.
  details           jsonb not null default '{}'::jsonb,
  requester_user_id uuid references public.user_profiles(id),
  requester_name    text,                 -- snapshot for display resilience
  -- product → Jira
  jira_issue_key    text,
  jira_issue_url    text,
  ai_summary        text,                 -- optional 1-line summary (Anthropic)
  -- completion / decision
  completed_at      timestamptz,
  completed_by      uuid references public.user_profiles(id),
  decision_note     text,
  created_at        timestamptz not null default timezone('utc', now()),
  updated_at        timestamptz not null default timezone('utc', now())
);

create index if not exists idx_requests_type_status on public.requests(type, status);
create index if not exists idx_requests_created_at  on public.requests(created_at desc);
create index if not exists idx_requests_requester   on public.requests(requester_user_id);

drop trigger if exists trg_requests_updated_at on public.requests;
create trigger trg_requests_updated_at before update on public.requests
for each row execute function public.set_updated_at();

-- ── request_routing: who acts on each type ───────────────────────────
create table if not exists public.request_routing (
  type    public.request_type not null,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  primary key (type, user_id)
);

-- Seed the routing Brayden/Nathan specified. Resolved by name at apply
-- time; if a name doesn't match a profile yet, that slot is simply not
-- seeded (admins can add it later via the routing table).
insert into public.request_routing (type, user_id)
select t.type, up.id
from (values ('collateral'::public.request_type), ('crm'::public.request_type)) as t(type)
cross join public.user_profiles up
where up.full_name in ('Jordan Mayer', 'Nathan Gellatly')
on conflict do nothing;

insert into public.request_routing (type, user_id)
select 'product'::public.request_type, up.id
from public.user_profiles up
where up.full_name in ('Rachel Kunkel', 'Nathan Gellatly')
on conflict do nothing;

-- ── In-app notification on submit ────────────────────────────────────
create or replace function public.notify_request_recipients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  v_label := case new.type
    when 'collateral' then 'collateral request'
    when 'product'    then 'product request'
    when 'crm'        then 'CRM request'
    else 'request'
  end;

  insert into public.notifications (user_id, type, title, message, link)
  select rr.user_id,
         'system',
         'New ' || v_label,
         coalesce(new.requester_name, '') ||
           case when new.requester_name is not null then ': ' else '' end ||
           new.title,
         '/nexus'
  from public.request_routing rr
  where rr.type = new.type;

  return new;
end;
$$;

drop trigger if exists trg_requests_notify on public.requests;
create trigger trg_requests_notify
after insert on public.requests
for each row execute function public.notify_request_recipients();

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.requests enable row level security;

drop policy if exists "requests_insert_authenticated" on public.requests;
create policy "requests_insert_authenticated" on public.requests
  for insert to authenticated
  with check (requester_user_id = auth.uid());

-- Submitter sees their own; admins/super_admins see everything.
drop policy if exists "requests_select" on public.requests;
create policy "requests_select" on public.requests
  for select to authenticated
  using (
    requester_user_id = auth.uid()
    or public.current_app_role() in ('admin', 'super_admin')
  );

-- Only admins/super_admins change a request (complete / approve / deny).
drop policy if exists "requests_update_admin" on public.requests;
create policy "requests_update_admin" on public.requests
  for update to authenticated
  using (public.current_app_role() in ('admin', 'super_admin'))
  with check (public.current_app_role() in ('admin', 'super_admin'));

alter table public.request_routing enable row level security;

drop policy if exists "request_routing_select" on public.request_routing;
create policy "request_routing_select" on public.request_routing
  for select to authenticated using (true);

drop policy if exists "request_routing_admin_write" on public.request_routing;
create policy "request_routing_admin_write" on public.request_routing
  for all to authenticated
  using (public.current_app_role() in ('admin', 'super_admin'))
  with check (public.current_app_role() in ('admin', 'super_admin'));

commit;

notify pgrst, 'reload schema';
