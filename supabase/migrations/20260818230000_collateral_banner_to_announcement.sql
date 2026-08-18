-- Collateral v1.2 follow-up (Nathan, 2026-08-18, same session): the
-- launch announcement moved from a Collateral-page banner to the
-- app-wide AnnouncementBanner, whose dismissal is the established
-- per-device localStorage pattern ("announcement-dismissed:<id>"). The
-- per-user dismissal column from 20260818210000 is therefore unused —
-- drop it before it carries any real data. Density stays: the condensed
-- toggle still persists per user in this table.
alter table public.collateral_user_prefs
  drop column if exists launch_banner_dismissed_at;
