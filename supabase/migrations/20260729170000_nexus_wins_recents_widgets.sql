-- ---------------------------------------------------------------------
-- Nexus: Wins + Recents widget types (docket C2, Phase 2)
-- ---------------------------------------------------------------------
-- Home's two remaining pieces without a Nexus twin get theirs: 'wins'
-- (team-wide closed-won feed, the coworker favorite) and 'recents' (the
-- user's recently visited records, client-side data). Same additive
-- CHECK-constraint pattern as 20260722220000 (campaign_touches): drop and
-- recreate both allow-lists with the new values, existing rows untouched.
-- See src/features/nexus/widgets/WinsWidget.tsx / RecentsWidget.tsx.
-- ---------------------------------------------------------------------

begin;

alter table public.nexus_widgets
  drop constraint if exists nexus_widgets_widget_type_check;
alter table public.nexus_widgets
  add constraint nexus_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'metrics', 'pinned_records', 'requests', 'campaign_touches', 'wins', 'recents'));

alter table public.nexus_default_widgets
  drop constraint if exists nexus_default_widgets_widget_type_check;
alter table public.nexus_default_widgets
  add constraint nexus_default_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'metrics', 'pinned_records', 'requests', 'campaign_touches', 'wins', 'recents'));

commit;

notify pgrst, 'reload schema';
