-- Retire the Nexus Metrics WIDGET (Nathan, 2026-08-04).
--
-- Superseded by the Metrics strip (MetricsStrip.tsx), which carries Home's
-- clickable KPI band onto Nexus. Nathan: "remove the metrics widget
-- entirely ... we just clean it out for now to keep things tidy."
--
-- Reversibility: rows are copied to backup tables before deletion. If the
-- widget ever comes back, restore from the backups and re-add 'metrics'
-- to the type CHECKs.

-- 1. Backup (RLS ON with no policies: service-role only — a bare CTAS
--    table in public would be readable through PostgREST otherwise).
create table if not exists public.nexus_widgets_metrics_backup_20260804 as
  select * from public.nexus_widgets where widget_type = 'metrics';
alter table public.nexus_widgets_metrics_backup_20260804 enable row level security;

create table if not exists public.nexus_default_widgets_metrics_backup_20260804 as
  select * from public.nexus_default_widgets where widget_type = 'metrics';
alter table public.nexus_default_widgets_metrics_backup_20260804 enable row level security;

-- 2. Remove every placed metrics widget (user pages + the system default
--    layout new users are seeded from).
delete from public.nexus_widgets where widget_type = 'metrics';
delete from public.nexus_default_widgets where widget_type = 'metrics';

-- 3. Narrow the type CHECKs so nothing can recreate one.
alter table public.nexus_widgets
  drop constraint if exists nexus_widgets_widget_type_check;
alter table public.nexus_widgets
  add constraint nexus_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'pinned_records', 'requests', 'campaign_touches', 'wins', 'recents', 'cold_call'));

alter table public.nexus_default_widgets
  drop constraint if exists nexus_default_widgets_widget_type_check;
alter table public.nexus_default_widgets
  add constraint nexus_default_widgets_widget_type_check
  check (widget_type in
    ('tasks', 'pipeline', 'custom_report', 'pinned_records', 'requests', 'campaign_touches', 'wins', 'recents', 'cold_call'));
