-- Tighten RLS on five auxiliary tables that shipped with permissive
-- `to authenticated using(true) with check(true)` policies. Those let ANY
-- authenticated session read AND write — including read_only users and
-- deactivated users whose JWT is still valid. The core CRM tables are already
-- safe (their policies go through current_app_role()/is_admin()/
-- has_crm_write_role(), all of which require is_active), but these five were
-- never brought in line:
--
--   * dashboard_goals
--   * team_dashboard_widgets
--   * dashboard_milestones
--   * contact_account_links
--   * contact_opportunity_links
--
-- New rule (matches the rest of the app):
--   READ  -> any ACTIVE CRM user (current_app_role() is not null). This keeps
--            read_only users able to see dashboards + contact links, but
--            blocks anon and deactivated accounts.
--   WRITE -> has_crm_write_role() (sales / renewals / admin / super_admin,
--            active only). Excludes read_only and deactivated.

begin;

-- dashboard_goals -----------------------------------------------------------
drop policy if exists "dashboard_goals_read" on public.dashboard_goals;
create policy "dashboard_goals_read"
  on public.dashboard_goals
  for select
  to authenticated
  using (public.current_app_role() is not null);

drop policy if exists "dashboard_goals_write" on public.dashboard_goals;
create policy "dashboard_goals_write"
  on public.dashboard_goals
  for all
  to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- team_dashboard_widgets ----------------------------------------------------
drop policy if exists "team_dashboard_widgets_read" on public.team_dashboard_widgets;
create policy "team_dashboard_widgets_read"
  on public.team_dashboard_widgets
  for select
  to authenticated
  using (public.current_app_role() is not null);

drop policy if exists "team_dashboard_widgets_write" on public.team_dashboard_widgets;
create policy "team_dashboard_widgets_write"
  on public.team_dashboard_widgets
  for all
  to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- dashboard_milestones ------------------------------------------------------
drop policy if exists "dashboard_milestones_read" on public.dashboard_milestones;
create policy "dashboard_milestones_read"
  on public.dashboard_milestones
  for select
  to authenticated
  using (public.current_app_role() is not null);

drop policy if exists "dashboard_milestones_write" on public.dashboard_milestones;
create policy "dashboard_milestones_write"
  on public.dashboard_milestones
  for all
  to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- contact_account_links -----------------------------------------------------
drop policy if exists "contact_account_links_read" on public.contact_account_links;
create policy "contact_account_links_read"
  on public.contact_account_links
  for select
  to authenticated
  using (public.current_app_role() is not null);

drop policy if exists "contact_account_links_write" on public.contact_account_links;
create policy "contact_account_links_write"
  on public.contact_account_links
  for all
  to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

-- contact_opportunity_links -------------------------------------------------
drop policy if exists "contact_opportunity_links_read" on public.contact_opportunity_links;
create policy "contact_opportunity_links_read"
  on public.contact_opportunity_links
  for select
  to authenticated
  using (public.current_app_role() is not null);

drop policy if exists "contact_opportunity_links_write" on public.contact_opportunity_links;
create policy "contact_opportunity_links_write"
  on public.contact_opportunity_links
  for all
  to authenticated
  using (public.has_crm_write_role())
  with check (public.has_crm_write_role());

commit;

notify pgrst, 'reload schema';
