-- Offboarding completeness: when a user is deactivated, also turn off their
-- email sync connections.
--
-- Background: deactivating a user (is_active = false) locks them out of the
-- app and RLS, but the cron edge functions select email_sync_connections by
-- the CONNECTION's is_active flag, never the OWNER's. So a departed user's
-- mailbox kept getting polled by sync-emails, and task-reminders / task-digest
-- kept finding an active connection and emailing their old address. Brayden
-- Frost (deactivated in 20260616000002) is the live example.
--
-- Fix in two parts:
--   1. A trigger so EVERY future deactivation cascades to email sync (central,
--      so we don't have to remember this in each ad-hoc deactivation).
--   2. A one-time backfill for anyone already deactivated (Brayden).

begin;

-- 1. Trigger: cascade user deactivation -> email sync off ------------------
create or replace function public.deactivate_user_email_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_sync_connections
     set is_active = false,
         updated_at = timezone('utc', now())
   where user_id = new.id
     and is_active = true;
  return new;
end;
$$;

drop trigger if exists trg_user_deactivate_email_sync on public.user_profiles;
create trigger trg_user_deactivate_email_sync
  after update of is_active on public.user_profiles
  for each row
  when (new.is_active = false and old.is_active is distinct from false)
  execute function public.deactivate_user_email_sync();

-- 2. Backfill: anyone already deactivated keeps no active connection -------
-- (Brayden was deactivated before this trigger existed, so the trigger never
--  fired for him. Catch every already-inactive user, not just him by name.)
update public.email_sync_connections c
   set is_active = false,
       updated_at = timezone('utc', now())
  from public.user_profiles u
 where c.user_id = u.id
   and u.is_active = false
   and c.is_active = true;

commit;

notify pgrst, 'reload schema';
