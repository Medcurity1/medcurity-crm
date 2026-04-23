-- Add missing email_address column on email_sync_connections.
--
-- Migration 20260404000002 defined this column in its CREATE TABLE, but
-- on this project the table was created before that migration ran, so
-- `create table if not exists` was a no-op and the column never landed.
-- Without it, outlook-oauth/callback's upsert silently fails and no
-- connection row is created after a successful Microsoft OAuth flow.
--
-- sync-emails/index.ts expects `email_address` to exist for the
-- external-address filter logic, so this is load-bearing.

alter table public.email_sync_connections
  add column if not exists email_address text;

comment on column public.email_sync_connections.email_address is
  'The connected mailbox email (from Graph /me.mail or /me.userPrincipalName for Outlook, or Gmail /profile for Gmail). Used to filter out self-originated messages during sync.';
