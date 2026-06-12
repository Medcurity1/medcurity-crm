-- Meddy: hidden_from_leads flag on conversations.
--
-- Ports Nexus's "Hide Lead" admin control (server.js:5817-5825): deleting
-- a lead from the History tab's Leads panel never deletes data, it only
-- sets hidden_from_leads = 1 so the row drops out of the leads filter.
-- The write goes through meddy-staff-action (admin-gated) like every
-- other conversation mutation.

begin;

alter table public.meddy_conversations
  add column if not exists hidden_from_leads boolean not null default false;

commit;

notify pgrst, 'reload schema';
