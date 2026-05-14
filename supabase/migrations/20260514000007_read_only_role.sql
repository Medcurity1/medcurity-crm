-- Add a read_only role to public.app_role for service accounts and
-- external integrations that need to query the CRM but must NEVER
-- write to it. No policy changes are required:
--
--   * public.has_crm_write_role() returns true only for
--     ('sales','renewals','admin','super_admin'). read_only is not in
--     that list, so every INSERT / UPDATE / DELETE policy that calls
--     has_crm_write_role() automatically rejects read_only users.
--   * public.is_admin() returns true only for ('admin','super_admin'),
--     so read_only is also locked out of admin-gated tables.
--   * SELECT policies are uniformly `to authenticated using (true)`,
--     so read_only can still SELECT everything that any logged-in user
--     can SELECT.
--
-- Net effect: read_only = "logged-in user with no write power anywhere".
-- This is exactly what an external integration (e.g. the cowork skill)
-- needs.

begin;
alter type public.app_role add value if not exists 'read_only';
commit;

-- Convenience predicate so application code (e.g. UI gating) can ask
-- "is the current session a read-only one?" without enumerating roles.
create or replace function public.is_read_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role = 'read_only'
     from public.user_profiles
     where id = auth.uid()
       and is_active = true),
    false
  );
$$;

grant execute on function public.is_read_only() to authenticated;
