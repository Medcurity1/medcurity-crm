-- Track whether a user has completed (or skipped) the welcome wizard so it
-- only shows on true first login, per-user, across devices. Previously the
-- wizard used localStorage which meant it re-appeared any time the user
-- switched browsers or cleared storage.

begin;

alter table public.user_profiles
  add column if not exists onboarded_at timestamptz;

comment on column public.user_profiles.onboarded_at is
  'Set when the user completes or skips the welcome wizard. When null, the wizard shows on next login.';

commit;
