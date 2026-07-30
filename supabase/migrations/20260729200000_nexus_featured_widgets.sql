-- Nexus: featured widget pins (docket C2 round 4, Nathan's idea).
--
-- Via Customize, a user can pin up to two widgets ABOVE the "Your widgets"
-- divider into the briefing area (pin Metrics and Home's KPI band is back,
-- with your chosen numbers). Plain boolean; ordering among featured widgets
-- follows the existing position column. The two-pin cap is enforced in the
-- client (a third pin unpins the oldest), not as a constraint: a cap here
-- would make concurrent admin edits fail ugly for no real safety gain.

begin;

alter table public.nexus_widgets
  add column if not exists featured boolean not null default false;

comment on column public.nexus_widgets.featured is
  'Pinned above the Your-widgets divider into the briefing area (docket C2 featured pins). Max 2 per user, client-enforced.';

alter table public.nexus_default_widgets
  add column if not exists featured boolean not null default false;

comment on column public.nexus_default_widgets.featured is
  'Default-layout rows can ship pinned (e.g. Metrics featured for the renewals role).';

commit;

notify pgrst, 'reload schema';
