-- ---------------------------------------------------------------------
-- MEDDY PORT: holding account for contacts created from chat.
--
-- contacts.account_id is NOT NULL, and auto-creating accounts from a
-- visitor-typed company name would mass-produce duplicate accounts (the
-- known "Smith & Sons" problem). New Meddy contacts therefore land under
-- this one reviewable account; staff move them to a real account when
-- they work the lead. Existing contacts (matched by email) are linked
-- in place and just get a "Meddy chat" note.
-- ---------------------------------------------------------------------

begin;

insert into public.accounts (name, industry)
select 'Meddy Website Inquiries', null
where not exists (
  select 1 from public.accounts where name = 'Meddy Website Inquiries'
);

commit;
