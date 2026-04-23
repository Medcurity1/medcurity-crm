-- Add created_by and updated_by to all core tables
alter table public.accounts add column if not exists created_by uuid references public.user_profiles(id);
alter table public.accounts add column if not exists updated_by uuid references public.user_profiles(id);
alter table public.contacts add column if not exists created_by uuid references public.user_profiles(id);
alter table public.contacts add column if not exists updated_by uuid references public.user_profiles(id);
alter table public.opportunities add column if not exists created_by uuid references public.user_profiles(id);
alter table public.opportunities add column if not exists updated_by uuid references public.user_profiles(id);
alter table public.leads add column if not exists created_by uuid references public.user_profiles(id);
alter table public.leads add column if not exists updated_by uuid references public.user_profiles(id);

-- Trigger to auto-set created_by on insert and updated_by on update
create or replace function public.set_created_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Apply trigger to all core tables
drop trigger if exists trg_accounts_created_updated_by on public.accounts;
create trigger trg_accounts_created_updated_by
before insert or update on public.accounts
for each row execute function public.set_created_updated_by();

drop trigger if exists trg_contacts_created_updated_by on public.contacts;
create trigger trg_contacts_created_updated_by
before insert or update on public.contacts
for each row execute function public.set_created_updated_by();

drop trigger if exists trg_opportunities_created_updated_by on public.opportunities;
create trigger trg_opportunities_created_updated_by
before insert or update on public.opportunities
for each row execute function public.set_created_updated_by();

drop trigger if exists trg_leads_created_updated_by on public.leads;
create trigger trg_leads_created_updated_by
before insert or update on public.leads
for each row execute function public.set_created_updated_by();

-- Data integrity monitoring view
create or replace view public.data_health_check as
select
  'accounts' as entity,
  count(*) as total_records,
  count(*) filter (where archived_at is not null) as archived_records,
  count(*) filter (where created_at > now() - interval '24 hours') as created_last_24h,
  count(*) filter (where updated_at > now() - interval '24 hours') as modified_last_24h,
  count(*) filter (where name is null or name = '') as missing_name,
  count(*) filter (where owner_user_id is null) as unassigned_records
from public.accounts
union all
select 'contacts', count(*), count(*) filter (where archived_at is not null),
  count(*) filter (where created_at > now() - interval '24 hours'),
  count(*) filter (where updated_at > now() - interval '24 hours'),
  count(*) filter (where first_name is null or last_name is null),
  count(*) filter (where owner_user_id is null)
from public.contacts
union all
select 'opportunities', count(*), count(*) filter (where archived_at is not null),
  count(*) filter (where created_at > now() - interval '24 hours'),
  count(*) filter (where updated_at > now() - interval '24 hours'),
  count(*) filter (where name is null or name = ''),
  count(*) filter (where owner_user_id is null)
from public.opportunities
union all
select 'leads', count(*), count(*) filter (where archived_at is not null),
  count(*) filter (where created_at > now() - interval '24 hours'),
  count(*) filter (where updated_at > now() - interval '24 hours'),
  count(*) filter (where first_name is null or last_name is null),
  count(*) filter (where owner_user_id is null)
from public.leads;

-- Storage monitoring function
create or replace function public.get_database_stats()
returns jsonb
language plpgsql
security definer
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'total_rows', (
      select sum(n_live_tup)
      from pg_stat_user_tables
      where schemaname = 'public'
    ),
    'database_size', pg_size_pretty(pg_database_size(current_database())),
    'database_size_bytes', pg_database_size(current_database()),
    'largest_tables', (
      select jsonb_agg(jsonb_build_object(
        'table', relname,
        'rows', n_live_tup,
        'size', pg_size_pretty(pg_total_relation_size(relid))
      ) order by pg_total_relation_size(relid) desc)
      from pg_stat_user_tables
      where schemaname = 'public'
      limit 10
    ),
    'audit_log_count', (select count(*) from public.audit_logs),
    'oldest_audit_log', (select min(changed_at) from public.audit_logs)
  ) into result;
  return result;
end;
$$;
