-- Fix user_profiles SELECT policy: allow all authenticated users to read all profiles
-- Previously restricted to self-or-admin which caused issues with the admin Users tab
-- All profiles (name, role, active status) are non-sensitive and needed across the app
-- for owner dropdowns, user assignments, etc.

drop policy if exists "user_profiles_select_self_or_admin" on public.user_profiles;
create policy "user_profiles_select_authenticated"
on public.user_profiles
for select
to authenticated
using (true);
