-- Tighten RLS on auxiliary tables that shipped with permissive
-- `to authenticated using(true) with check(true)` policies. Those let ANY
-- authenticated session read AND write — including read_only users and
-- deactivated users whose JWT is still valid. The core CRM tables are already
-- safe (their policies go through current_app_role()/is_admin()/
-- has_crm_write_role(), all of which require is_active), but these were never
-- brought in line.
--
-- Tables in scope (whichever actually exist in this environment):
--   * dashboard_goals
--   * team_dashboard_widgets
--   * dashboard_milestones
--   * contact_opportunity_links
--
-- NOTE: contact_account_links was in the original audit list but it was
-- dropped in 20260514000002 (only contact_opportunity_links was kept), so it
-- is intentionally absent here. We guard every table with to_regclass() so a
-- table that doesn't exist in a given environment is skipped, never fatal.
--
-- New rule (matches the rest of the app):
--   READ  -> any ACTIVE CRM user (current_app_role() is not null). Keeps
--            read_only able to see dashboards + links, blocks anon/deactivated.
--   WRITE -> has_crm_write_role() (sales / renewals / admin / super_admin,
--            active only). Excludes read_only and deactivated.

begin;

do $$
declare
  t text;
begin
  foreach t in array array[
    'dashboard_goals',
    'team_dashboard_widgets',
    'dashboard_milestones',
    'contact_opportunity_links'
  ]
  loop
    -- Skip tables that don't exist in this environment.
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);

    execute format(
      'create policy %I on public.%I for select to authenticated '
      || 'using (public.current_app_role() is not null)',
      t || '_read', t);

    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (public.has_crm_write_role()) with check (public.has_crm_write_role())',
      t || '_write', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
