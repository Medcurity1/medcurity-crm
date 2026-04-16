-- Add do_not_market_to compliance flag to leads table
-- This is a CAN-SPAM / GDPR requirement carried over from Salesforce
alter table public.leads
  add column if not exists do_not_market_to boolean not null default false;

comment on column public.leads.do_not_market_to is
  'CAN-SPAM / GDPR compliance flag. When true, this lead must not receive marketing communications.';
