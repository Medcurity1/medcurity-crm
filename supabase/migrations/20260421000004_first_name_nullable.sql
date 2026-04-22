-- ============================================================
-- leads + contacts: first_name nullable
-- ----------------------------------------------------------------
-- Salesforce only requires LastName on a Lead — FirstName is
-- optional. Our schema had both NOT NULL, which blocked 927 real
-- leads in the SF migration: receptionists, cold-list contacts,
-- single-name records ("Rebecca"), and rows where SF stored
-- "[not provided]" as the last name and left first blank.
--
-- last_name stays NOT NULL — it's required in SF and present in
-- 100% of the rows we've seen.
-- ============================================================

alter table public.leads
  alter column first_name drop not null;

alter table public.contacts
  alter column first_name drop not null;

comment on column public.leads.first_name is
  'Optional — SF only requires LastName on Lead, and cold lists / receptionist records often have no first name.';
comment on column public.contacts.first_name is
  'Optional — SF only requires LastName on Contact.';
