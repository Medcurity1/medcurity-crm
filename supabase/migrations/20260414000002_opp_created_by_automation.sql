-- Track which opportunities were created by automation
alter table public.opportunities add column if not exists created_by_automation boolean not null default false;
