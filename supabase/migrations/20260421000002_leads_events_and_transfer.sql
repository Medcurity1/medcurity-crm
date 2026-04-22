-- ============================================================
-- Lead SF-parity fields: events_attended + last_transfer_date
-- ----------------------------------------------------------------
-- Already on contacts (20260417000001); the SF Lead.csv carries
-- the same Events__c multi-picklist so leads need it too. SF also
-- exposes LastTransferDate (when ownership last changed) which we
-- want to preserve verbatim on imported leads.
-- ============================================================

alter table public.leads
  add column if not exists events_attended text[],
  add column if not exists last_transfer_date timestamptz;

comment on column public.leads.events_attended is
  'List of Medcurity events/webinars this lead attended. From SF Events__c multi-picklist.';
comment on column public.leads.last_transfer_date is
  'Timestamp the lead was last transferred to a new owner in Salesforce.';
