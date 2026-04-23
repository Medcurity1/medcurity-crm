-- FK ON DELETE hardening.
--
-- Policy:
--   * Core hierarchy (account → contact → opportunity) uses RESTRICT so you
--     cannot orphan children via hard-delete. Soft-delete (archived_at) is the
--     normal path.
--   * Reference pointers (primary_contact_id, source_opportunity_id, renewal_from_*)
--     SET NULL so deleting one record doesn't block another.
--   * Side records (activities, leads.converted_*, contacts.original_lead_id,
--     pandadoc_documents, sequence_enrollments) SET NULL so history survives.
--   * Aggregates / pure child rows (opportunity_products, opportunity_stage_history,
--     stakeholders, lead_list_members) CASCADE with the parent because they have
--     no meaning without it.
--
-- Idempotent: drop-if-exists then add with an explicit ON DELETE clause.

begin;

-- --------------- contacts ---------------
alter table public.contacts
  drop constraint if exists contacts_account_id_fkey,
  add constraint contacts_account_id_fkey
    foreign key (account_id) references public.accounts(id) on delete restrict;

alter table public.contacts
  drop constraint if exists contacts_original_lead_id_fkey,
  add constraint contacts_original_lead_id_fkey
    foreign key (original_lead_id) references public.leads(id) on delete set null;

-- --------------- opportunities ---------------
alter table public.opportunities
  drop constraint if exists opportunities_account_id_fkey,
  add constraint opportunities_account_id_fkey
    foreign key (account_id) references public.accounts(id) on delete restrict;

alter table public.opportunities
  drop constraint if exists opportunities_primary_contact_id_fkey,
  add constraint opportunities_primary_contact_id_fkey
    foreign key (primary_contact_id) references public.contacts(id) on delete set null;

alter table public.opportunities
  drop constraint if exists opportunities_source_opportunity_id_fkey,
  add constraint opportunities_source_opportunity_id_fkey
    foreign key (source_opportunity_id) references public.opportunities(id) on delete set null;

alter table public.opportunities
  drop constraint if exists opportunities_renewal_from_opportunity_id_fkey,
  add constraint opportunities_renewal_from_opportunity_id_fkey
    foreign key (renewal_from_opportunity_id) references public.opportunities(id) on delete set null;

-- --------------- opportunity_products ---------------
-- Already CASCADE on opportunity_id from initial schema; reaffirm + set product FK.
alter table public.opportunity_products
  drop constraint if exists opportunity_products_opportunity_id_fkey,
  add constraint opportunity_products_opportunity_id_fkey
    foreign key (opportunity_id) references public.opportunities(id) on delete cascade;

alter table public.opportunity_products
  drop constraint if exists opportunity_products_product_id_fkey,
  add constraint opportunity_products_product_id_fkey
    foreign key (product_id) references public.products(id) on delete restrict;

-- --------------- opportunity_stage_history ---------------
alter table public.opportunity_stage_history
  drop constraint if exists opportunity_stage_history_opportunity_id_fkey,
  add constraint opportunity_stage_history_opportunity_id_fkey
    foreign key (opportunity_id) references public.opportunities(id) on delete cascade;

-- --------------- activities ---------------
alter table public.activities
  drop constraint if exists activities_account_id_fkey,
  add constraint activities_account_id_fkey
    foreign key (account_id) references public.accounts(id) on delete set null;

alter table public.activities
  drop constraint if exists activities_contact_id_fkey,
  add constraint activities_contact_id_fkey
    foreign key (contact_id) references public.contacts(id) on delete set null;

alter table public.activities
  drop constraint if exists activities_opportunity_id_fkey,
  add constraint activities_opportunity_id_fkey
    foreign key (opportunity_id) references public.opportunities(id) on delete set null;

-- --------------- leads ---------------
alter table public.leads
  drop constraint if exists leads_converted_account_id_fkey,
  add constraint leads_converted_account_id_fkey
    foreign key (converted_account_id) references public.accounts(id) on delete set null;

alter table public.leads
  drop constraint if exists leads_converted_contact_id_fkey,
  add constraint leads_converted_contact_id_fkey
    foreign key (converted_contact_id) references public.contacts(id) on delete set null;

alter table public.leads
  drop constraint if exists leads_converted_opportunity_id_fkey,
  add constraint leads_converted_opportunity_id_fkey
    foreign key (converted_opportunity_id) references public.opportunities(id) on delete set null;

-- --------------- pandadoc_documents (if present) ---------------
do $$
begin
  if to_regclass('public.pandadoc_documents') is not null then
    execute 'alter table public.pandadoc_documents
             drop constraint if exists pandadoc_documents_account_id_fkey,
             add constraint pandadoc_documents_account_id_fkey
               foreign key (account_id) references public.accounts(id) on delete set null';

    execute 'alter table public.pandadoc_documents
             drop constraint if exists pandadoc_documents_opportunity_id_fkey,
             add constraint pandadoc_documents_opportunity_id_fkey
               foreign key (opportunity_id) references public.opportunities(id) on delete set null';

    execute 'alter table public.pandadoc_documents
             drop constraint if exists pandadoc_documents_contact_id_fkey,
             add constraint pandadoc_documents_contact_id_fkey
               foreign key (contact_id) references public.contacts(id) on delete set null';
  end if;
end $$;

-- --------------- sequence_enrollments (if present) ---------------
do $$
begin
  if to_regclass('public.sequence_enrollments') is not null then
    execute 'alter table public.sequence_enrollments
             drop constraint if exists sequence_enrollments_lead_id_fkey,
             add constraint sequence_enrollments_lead_id_fkey
               foreign key (lead_id) references public.leads(id) on delete set null';

    execute 'alter table public.sequence_enrollments
             drop constraint if exists sequence_enrollments_contact_id_fkey,
             add constraint sequence_enrollments_contact_id_fkey
               foreign key (contact_id) references public.contacts(id) on delete set null';

    execute 'alter table public.sequence_enrollments
             drop constraint if exists sequence_enrollments_account_id_fkey,
             add constraint sequence_enrollments_account_id_fkey
               foreign key (account_id) references public.accounts(id) on delete set null';
  end if;
end $$;

-- --------------- lead_list_members (if present) ---------------
do $$
begin
  if to_regclass('public.lead_list_members') is not null then
    execute 'alter table public.lead_list_members
             drop constraint if exists lead_list_members_lead_id_fkey,
             add constraint lead_list_members_lead_id_fkey
               foreign key (lead_id) references public.leads(id) on delete cascade';

    execute 'alter table public.lead_list_members
             drop constraint if exists lead_list_members_contact_id_fkey,
             add constraint lead_list_members_contact_id_fkey
               foreign key (contact_id) references public.contacts(id) on delete cascade';
  end if;
end $$;

-- --------------- accounts.parent_account_id (if present) ---------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'accounts'
      and column_name = 'parent_account_id'
  ) then
    execute 'alter table public.accounts
             drop constraint if exists accounts_parent_account_id_fkey,
             add constraint accounts_parent_account_id_fkey
               foreign key (parent_account_id) references public.accounts(id) on delete set null';
  end if;
end $$;

commit;
