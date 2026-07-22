-- ---------------------------------------------------------------------
-- Nexus: Campaign Touches widget (Campaigns overhaul, Phase 2 slice S7)
-- ----------------------------------------------------------------
-- Adds 'campaign_touches' as a seventh nexus widget_type — a Tasks-shaped
-- system widget (no config, scoped to the widget owner) listing the
-- owner's upcoming campaign-generated tasks (activities.is_campaign_generated
-- = true, spawned by spawnCampaignTasks in playbook-smartlead/index.ts).
-- See src/features/nexus/widgets/CampaignTouchesWidget.tsx.
--
-- Both nexus_widgets and nexus_default_widgets got their widget_type CHECK
-- constraint at creation (20260703000000) — Postgres named them via the
-- default <table>_<column>_check convention, so they're dropped and
-- recreated here with the new value added. Purely additive: existing rows
-- are untouched, nothing is removed from either allowed set.
-- ---------------------------------------------------------------------

begin;

alter table public.nexus_widgets
  drop constraint if exists nexus_widgets_widget_type_check;
alter table public.nexus_widgets
  add constraint nexus_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'metrics', 'pinned_records', 'requests', 'campaign_touches'));

alter table public.nexus_default_widgets
  drop constraint if exists nexus_default_widgets_widget_type_check;
alter table public.nexus_default_widgets
  add constraint nexus_default_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'metrics', 'pinned_records', 'requests', 'campaign_touches'));

commit;

notify pgrst, 'reload schema';
