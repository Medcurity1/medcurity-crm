-- Campaigns outside-review fix batch (2026-07-28) — fix 4 of 4: preset
-- templates can no longer be overwritten or deleted from any client path.
--
-- The old campaign_templates_admin policy was FOR ALL, so any admin session
-- could UPDATE/DELETE the shared 8-Touch / Warming presets through
-- PostgREST. The UI never offers that (presets get "Customize a copy"
-- instead of Edit/Delete — TemplatesSection.tsx), but the AI Insights Apply
-- path reached it by accident: a campaign launched from a preset stamps the
-- PRESET's id onto campaign_suggestions (playbook-ai stamps
-- campaign.template_id), so applying one AI suggestion ran useSaveTemplate's
-- UPDATE against the shared preset and permanently overwrote its steps.
--
-- InsightsPanel.tsx now applies preset-targeted suggestions to a fresh copy
-- (same outcome as "Customize a copy"); this migration is the backstop that
-- makes the direct overwrite impossible from any client, current or future.
-- Preset content changes remain possible via migrations / service role —
-- which is how preset copy edits have always landed (20260625000002,
-- 20260722150000) and how Jordan's real 8-Touch/Warming copy will land too.
--
-- The rep-access SELECT policy (campaign_templates_read_own, 20260723040000)
-- is untouched; policies are OR'd, so admins keep full read via the split
-- select policy below.
--
-- Idempotent: every statement is drop-if-exists + create.

begin;

drop policy if exists campaign_templates_admin on public.campaign_templates;

drop policy if exists campaign_templates_select_admin on public.campaign_templates;
create policy campaign_templates_select_admin on public.campaign_templates
  for select to authenticated
  using (public.is_admin());

-- Clients can never create a preset (is_preset must be false on insert)…
drop policy if exists campaign_templates_insert_admin on public.campaign_templates;
create policy campaign_templates_insert_admin on public.campaign_templates
  for insert to authenticated
  with check (public.is_admin() and is_preset = false);

-- …never edit one (and never flip a custom template INTO a preset)…
drop policy if exists campaign_templates_update_admin on public.campaign_templates;
create policy campaign_templates_update_admin on public.campaign_templates
  for update to authenticated
  using (public.is_admin() and is_preset = false)
  with check (public.is_admin() and is_preset = false);

-- …and never delete one.
drop policy if exists campaign_templates_delete_admin on public.campaign_templates;
create policy campaign_templates_delete_admin on public.campaign_templates
  for delete to authenticated
  using (public.is_admin() and is_preset = false);

commit;

notify pgrst, 'reload schema';
