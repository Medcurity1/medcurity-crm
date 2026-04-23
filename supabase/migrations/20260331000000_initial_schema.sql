create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('sales', 'renewals', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'account_lifecycle') then
    create type public.account_lifecycle as enum ('prospect', 'customer', 'former_customer');
  end if;

  if not exists (select 1 from pg_type where typname = 'opportunity_team') then
    create type public.opportunity_team as enum ('sales', 'renewals');
  end if;

  if not exists (select 1 from pg_type where typname = 'opportunity_kind') then
    create type public.opportunity_kind as enum ('new_business', 'renewal');
  end if;

  if not exists (select 1 from pg_type where typname = 'opportunity_stage') then
    create type public.opportunity_stage as enum (
      'lead',
      'qualified',
      'proposal',
      'verbal_commit',
      'closed_won',
      'closed_lost'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'activity_type') then
    create type public.activity_type as enum ('call', 'email', 'meeting', 'note', 'task');
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role public.app_role not null default 'sales',
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
as $$
  select up.role
  from public.user_profiles up
  where up.id = auth.uid()
    and up.is_active = true;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid references public.user_profiles (id),
  lifecycle_status public.account_lifecycle not null default 'prospect',
  website text,
  industry text,
  notes text,
  current_contract_start_date date,
  current_contract_end_date date,
  current_contract_length_months integer check (current_contract_length_months is null or current_contract_length_months > 0),
  archived_at timestamptz,
  archived_by uuid references public.user_profiles (id),
  archive_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  owner_user_id uuid references public.user_profiles (id),
  first_name text not null,
  last_name text not null,
  email text,
  title text,
  phone text,
  is_primary boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references public.user_profiles (id),
  archive_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint contacts_email_format check (email is null or position('@' in email) > 1)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  product_family text,
  description text,
  is_active boolean not null default true,
  default_arr numeric(12,2) check (default_arr is null or default_arr >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  primary_contact_id uuid references public.contacts (id),
  owner_user_id uuid references public.user_profiles (id),
  team public.opportunity_team not null default 'sales',
  kind public.opportunity_kind not null default 'new_business',
  name text not null,
  stage public.opportunity_stage not null default 'lead',
  amount numeric(12,2) not null default 0 check (amount >= 0),
  expected_close_date date,
  close_date date,
  contract_start_date date,
  contract_end_date date,
  contract_length_months integer check (contract_length_months is null or contract_length_months > 0),
  contract_year integer check (contract_year is null or contract_year > 0),
  source_opportunity_id uuid references public.opportunities (id),
  loss_reason text,
  notes text,
  archived_at timestamptz,
  archived_by uuid references public.user_profiles (id),
  archive_reason text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint opportunities_close_dates check (
    close_date is null or expected_close_date is null or close_date >= expected_close_date - 3650
  ),
  constraint opportunities_contract_dates check (
    contract_end_date is null or contract_start_date is null or contract_end_date >= contract_start_date
  )
);

create table if not exists public.opportunity_products (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  product_id uuid not null references public.products (id),
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  arr_amount numeric(12,2) not null default 0 check (arr_amount >= 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (opportunity_id, product_id)
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts (id),
  contact_id uuid references public.contacts (id),
  opportunity_id uuid references public.opportunities (id),
  owner_user_id uuid references public.user_profiles (id),
  activity_type public.activity_type not null,
  subject text not null,
  body text,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.opportunity_stage_history (
  id bigint generated always as identity primary key,
  opportunity_id uuid not null references public.opportunities (id) on delete cascade,
  from_stage public.opportunity_stage,
  to_stage public.opportunity_stage not null,
  changed_by uuid references public.user_profiles (id),
  changed_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid not null,
  action text not null,
  changed_by uuid references public.user_profiles (id),
  changed_at timestamptz not null default timezone('utc', now()),
  old_data jsonb,
  new_data jsonb
);

create index if not exists idx_accounts_owner on public.accounts (owner_user_id);
create index if not exists idx_accounts_archived_at on public.accounts (archived_at);
create index if not exists idx_contacts_account on public.contacts (account_id);
create index if not exists idx_contacts_archived_at on public.contacts (archived_at);
create index if not exists idx_opportunities_account on public.opportunities (account_id);
create index if not exists idx_opportunities_owner on public.opportunities (owner_user_id);
create index if not exists idx_opportunities_team_stage on public.opportunities (team, stage);
create index if not exists idx_opportunities_contract_end on public.opportunities (contract_end_date);
create index if not exists idx_opportunities_archived_at on public.opportunities (archived_at);
create index if not exists idx_stage_history_opportunity on public.opportunity_stage_history (opportunity_id, changed_at desc);
create index if not exists idx_audit_logs_table_record on public.audit_logs (table_name, record_id, changed_at desc);

create or replace function public.log_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
begin
  target_id := coalesce(new.id, old.id);

  insert into public.audit_logs (
    table_name,
    record_id,
    action,
    changed_by,
    old_data,
    new_data
  )
  values (
    tg_table_name,
    target_id,
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return coalesce(new, old);
end;
$$;

create or replace function public.track_stage_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.opportunity_stage_history (
      opportunity_id,
      from_stage,
      to_stage,
      changed_by
    )
    values (
      new.id,
      null,
      new.stage,
      auth.uid()
    );
  elsif tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    insert into public.opportunity_stage_history (
      opportunity_id,
      from_stage,
      to_stage,
      changed_by
    )
    values (
      new.id,
      old.stage,
      new.stage,
      auth.uid()
    );
  end if;

  return new;
end;
$$;

create or replace function public.archive_record(target_table text, target_id uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() is null then
    raise exception 'Not authorized';
  end if;

  if target_table not in ('accounts', 'contacts', 'opportunities') then
    raise exception 'Unsupported table';
  end if;

  execute format(
    'update public.%I set archived_at = timezone(''utc'', now()), archived_by = auth.uid(), archive_reason = $1 where id = $2 and archived_at is null',
    target_table
  )
  using reason, target_id;
end;
$$;

create or replace function public.restore_record(target_table text, target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can restore records';
  end if;

  if target_table not in ('accounts', 'contacts', 'opportunities') then
    raise exception 'Unsupported table';
  end if;

  execute format(
    'update public.%I set archived_at = null, archived_by = null, archive_reason = null where id = $1',
    target_table
  )
  using target_id;
end;
$$;

create or replace view public.active_pipeline as
select
  o.id,
  o.name,
  o.team,
  o.kind,
  o.stage,
  o.amount,
  o.expected_close_date,
  o.owner_user_id,
  a.id as account_id,
  a.name as account_name
from public.opportunities o
join public.accounts a on a.id = o.account_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage not in ('closed_won', 'closed_lost');

create or replace view public.renewal_queue as
select
  o.id as source_opportunity_id,
  o.account_id,
  a.name as account_name,
  o.owner_user_id,
  o.contract_end_date,
  o.amount as current_arr,
  case
    when o.contract_end_date is null then null
    else (o.contract_end_date - current_date)
  end as days_until_renewal
from public.opportunities o
join public.accounts a on a.id = o.account_id
where o.archived_at is null
  and a.archived_at is null
  and o.stage = 'closed_won'
  and o.contract_end_date is not null
  and o.contract_end_date between current_date and current_date + interval '120 days';

create or replace view public.pipeline_summary as
select
  team,
  stage,
  count(*) as opportunity_count,
  coalesce(sum(amount), 0)::numeric(12,2) as total_amount
from public.opportunities
where archived_at is null
group by team, stage;

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

drop trigger if exists trg_contacts_updated_at on public.contacts;
create trigger trg_contacts_updated_at
before update on public.contacts
for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row execute function public.set_updated_at();

drop trigger if exists trg_opportunities_updated_at on public.opportunities;
create trigger trg_opportunities_updated_at
before update on public.opportunities
for each row execute function public.set_updated_at();

drop trigger if exists trg_opportunity_products_updated_at on public.opportunity_products;
create trigger trg_opportunity_products_updated_at
before update on public.opportunity_products
for each row execute function public.set_updated_at();

drop trigger if exists trg_activities_updated_at on public.activities;
create trigger trg_activities_updated_at
before update on public.activities
for each row execute function public.set_updated_at();

drop trigger if exists trg_accounts_audit on public.accounts;
create trigger trg_accounts_audit
after insert or update or delete on public.accounts
for each row execute function public.log_row_change();

drop trigger if exists trg_contacts_audit on public.contacts;
create trigger trg_contacts_audit
after insert or update or delete on public.contacts
for each row execute function public.log_row_change();

drop trigger if exists trg_products_audit on public.products;
create trigger trg_products_audit
after insert or update or delete on public.products
for each row execute function public.log_row_change();

drop trigger if exists trg_opportunities_audit on public.opportunities;
create trigger trg_opportunities_audit
after insert or update or delete on public.opportunities
for each row execute function public.log_row_change();

drop trigger if exists trg_opportunity_products_audit on public.opportunity_products;
create trigger trg_opportunity_products_audit
after insert or update or delete on public.opportunity_products
for each row execute function public.log_row_change();

drop trigger if exists trg_activities_audit on public.activities;
create trigger trg_activities_audit
after insert or update or delete on public.activities
for each row execute function public.log_row_change();

drop trigger if exists trg_opportunities_stage_history on public.opportunities;
create trigger trg_opportunities_stage_history
after insert or update on public.opportunities
for each row execute function public.track_stage_changes();

alter table public.user_profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.products enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_products enable row level security;
alter table public.activities enable row level security;
alter table public.opportunity_stage_history enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "user_profiles_select_self_or_admin" on public.user_profiles;
create policy "user_profiles_select_self_or_admin"
on public.user_profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists "user_profiles_admin_manage" on public.user_profiles;
drop policy if exists "user_profiles_admin_insert" on public.user_profiles;
create policy "user_profiles_admin_insert"
on public.user_profiles
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "user_profiles_admin_update" on public.user_profiles;
create policy "user_profiles_admin_update"
on public.user_profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "accounts_read_active" on public.accounts;
create policy "accounts_read_active"
on public.accounts
for select
to authenticated
using (archived_at is null or public.is_admin());

drop policy if exists "accounts_write_crm_roles" on public.accounts;
drop policy if exists "accounts_insert_crm_roles" on public.accounts;
create policy "accounts_insert_crm_roles"
on public.accounts
for insert
to authenticated
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "accounts_update_crm_roles" on public.accounts;
create policy "accounts_update_crm_roles"
on public.accounts
for update
to authenticated
using (public.current_app_role() in ('sales', 'renewals', 'admin'))
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "contacts_read_active" on public.contacts;
create policy "contacts_read_active"
on public.contacts
for select
to authenticated
using (archived_at is null or public.is_admin());

drop policy if exists "contacts_write_crm_roles" on public.contacts;
drop policy if exists "contacts_insert_crm_roles" on public.contacts;
create policy "contacts_insert_crm_roles"
on public.contacts
for insert
to authenticated
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "contacts_update_crm_roles" on public.contacts;
create policy "contacts_update_crm_roles"
on public.contacts
for update
to authenticated
using (public.current_app_role() in ('sales', 'renewals', 'admin'))
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "products_read_authenticated" on public.products;
create policy "products_read_authenticated"
on public.products
for select
to authenticated
using (true);

drop policy if exists "products_admin_write" on public.products;
drop policy if exists "products_admin_insert" on public.products;
create policy "products_admin_insert"
on public.products
for insert
to authenticated
with check (public.is_admin());

drop policy if exists "products_admin_update" on public.products;
create policy "products_admin_update"
on public.products
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "opportunities_read_active" on public.opportunities;
create policy "opportunities_read_active"
on public.opportunities
for select
to authenticated
using (archived_at is null or public.is_admin());

drop policy if exists "opportunities_write_crm_roles" on public.opportunities;
drop policy if exists "opportunities_insert_crm_roles" on public.opportunities;
create policy "opportunities_insert_crm_roles"
on public.opportunities
for insert
to authenticated
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "opportunities_update_crm_roles" on public.opportunities;
create policy "opportunities_update_crm_roles"
on public.opportunities
for update
to authenticated
using (public.current_app_role() in ('sales', 'renewals', 'admin'))
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "opportunity_products_read_authenticated" on public.opportunity_products;
create policy "opportunity_products_read_authenticated"
on public.opportunity_products
for select
to authenticated
using (true);

drop policy if exists "opportunity_products_write_crm_roles" on public.opportunity_products;
drop policy if exists "opportunity_products_insert_crm_roles" on public.opportunity_products;
create policy "opportunity_products_insert_crm_roles"
on public.opportunity_products
for insert
to authenticated
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "opportunity_products_update_crm_roles" on public.opportunity_products;
create policy "opportunity_products_update_crm_roles"
on public.opportunity_products
for update
to authenticated
using (public.current_app_role() in ('sales', 'renewals', 'admin'))
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "activities_read_authenticated" on public.activities;
create policy "activities_read_authenticated"
on public.activities
for select
to authenticated
using (true);

drop policy if exists "activities_write_crm_roles" on public.activities;
drop policy if exists "activities_insert_crm_roles" on public.activities;
create policy "activities_insert_crm_roles"
on public.activities
for insert
to authenticated
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "activities_update_crm_roles" on public.activities;
create policy "activities_update_crm_roles"
on public.activities
for update
to authenticated
using (public.current_app_role() in ('sales', 'renewals', 'admin'))
with check (public.current_app_role() in ('sales', 'renewals', 'admin'));

drop policy if exists "stage_history_read_authenticated" on public.opportunity_stage_history;
create policy "stage_history_read_authenticated"
on public.opportunity_stage_history
for select
to authenticated
using (true);

drop policy if exists "audit_logs_admin_read" on public.audit_logs;
create policy "audit_logs_admin_read"
on public.audit_logs
for select
to authenticated
using (public.is_admin());
