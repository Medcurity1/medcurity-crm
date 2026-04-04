-- ============================================================
-- 1. SF ID columns on all core entities (for Salesforce migration)
-- ============================================================
alter table public.accounts add column if not exists sf_id text;
alter table public.contacts add column if not exists sf_id text;
alter table public.opportunities add column if not exists sf_id text;
alter table public.leads add column if not exists sf_id text;

create unique index if not exists idx_accounts_sf_id on public.accounts (sf_id) where sf_id is not null;
create unique index if not exists idx_contacts_sf_id on public.contacts (sf_id) where sf_id is not null;
create unique index if not exists idx_opportunities_sf_id on public.opportunities (sf_id) where sf_id is not null;
create unique index if not exists idx_leads_sf_id on public.leads (sf_id) where sf_id is not null;

-- ============================================================
-- 2. Duplicate detection functions (plpgsql for deferred validation)
-- ============================================================
create or replace function public.find_duplicate_accounts(account_name text)
returns table (id uuid, name text, lifecycle_status public.account_lifecycle, owner_user_id uuid, similarity_score float)
language plpgsql stable as $$
begin
  return query
  select a.id, a.name, a.lifecycle_status, a.owner_user_id,
    case when lower(a.name) = lower(account_name) then 1.0::float
         when lower(a.name) like lower(account_name) || '%' then 0.9::float
         when lower(a.name) like '%' || lower(account_name) || '%' then 0.7::float
         else 0.5::float end as similarity_score
  from public.accounts a where a.archived_at is null
    and (lower(a.name) = lower(account_name) or lower(a.name) like '%' || lower(account_name) || '%' or lower(account_name) like '%' || lower(a.name) || '%')
  order by similarity_score desc limit 10;
end;
$$;

create or replace function public.find_duplicate_contacts(contact_email text, contact_first_name text default null, contact_last_name text default null)
returns table (id uuid, first_name text, last_name text, email text, account_id uuid, similarity_score float)
language plpgsql stable as $$
begin
  return query
  select c.id, c.first_name, c.last_name, c.email, c.account_id,
    case when c.email is not null and lower(c.email) = lower(contact_email) then 1.0::float
         when lower(c.first_name) = lower(coalesce(contact_first_name,'')) and lower(c.last_name) = lower(coalesce(contact_last_name,'')) then 0.9::float
         else 0.6::float end as similarity_score
  from public.contacts c where c.archived_at is null
    and ((c.email is not null and lower(c.email) = lower(contact_email))
      or (contact_first_name is not null and contact_last_name is not null and lower(c.first_name) = lower(contact_first_name) and lower(c.last_name) = lower(contact_last_name)))
  order by similarity_score desc limit 10;
end;
$$;

create or replace function public.find_duplicate_leads(lead_email text, lead_company text default null)
returns table (id uuid, first_name text, last_name text, email text, company text, similarity_score float)
language plpgsql stable as $$
begin
  return query
  select l.id, l.first_name, l.last_name, l.email, l.company,
    case when l.email is not null and lower(l.email) = lower(lead_email) then 1.0::float
         when l.company is not null and lower(l.company) = lower(lead_company) then 0.8::float
         else 0.5::float end as similarity_score
  from public.leads l where l.archived_at is null and l.status != 'converted'
    and ((l.email is not null and lower(l.email) = lower(lead_email))
      or (l.company is not null and lead_company is not null and lower(l.company) like '%' || lower(lead_company) || '%'))
  order by similarity_score desc limit 10;
end;
$$;
