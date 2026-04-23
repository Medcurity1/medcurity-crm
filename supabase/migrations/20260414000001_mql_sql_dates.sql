-- Add MQL/SQL qualification date tracking
-- Leads: mql_date only (conversion to contact = SQL event)
-- Contacts: mql_date + sql_date

alter table public.leads add column if not exists mql_date date;
alter table public.contacts add column if not exists mql_date date;
alter table public.contacts add column if not exists sql_date date;
