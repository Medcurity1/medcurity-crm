-- ============================================================
-- Campaigns (sequence builder) — Phase 1 data foundation.
--
-- The mixed-channel sequence engine (see docs/campaigns/campaigns-plan.md).
-- Orchestrator model: Smartlead runs EMAIL_AUTO steps; the CRM owns
-- CALL/LINKEDIN/EMAIL_HYBRID steps as tasks in `activities` (Up Next). These
-- are NEW tables — the old `sequences`/`sequence_enrollments` were dropped in
-- 20260613000005 (don't resurrect them; don't build a native email sender).
--
-- Admin-only for now (matches the rest of the Campaigns/Playbook tab). Phase 5
-- opens it to reps with their own RLS. Additive + idempotent; presets seed with
-- fixed UUIDs (ON CONFLICT DO NOTHING) so re-runs don't duplicate or clobber.
-- ============================================================

begin;

-- ── 1. Template library (seedable starting points for the one builder) ──────
create table if not exists public.campaign_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  category      text not null default 'custom'
                  check (category in ('flagship','warming','post_demo','re_engagement','event','custom')),
  is_preset     boolean not null default false,   -- true = shared system preset (owner null)
  owner_user_id uuid references public.user_profiles(id) on delete set null,
  duration_days int,
  step_count    int,
  steps         jsonb not null default '[]'::jsonb,   -- ordered step objects (see plan §4)
  domain_rules  jsonb not null default '{}'::jsonb,   -- e.g. {start_anchor:'nearest_monday', call_days:['TUE','FRI']}
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 2. A launched campaign = a template snapshot + its Smartlead link ────────
-- steps are deep-copied from the template at launch and frozen (Smartlead can't
-- edit a sequence after launch — editing clones a new campaign).
create table if not exists public.campaigns (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  template_id              uuid references public.campaign_templates(id) on delete set null,
  steps                    jsonb not null default '[]'::jsonb,
  owner_user_id            uuid references public.user_profiles(id) on delete set null,
  sending_email_account_id text,                 -- Smartlead inbox id ("send from")
  smartlead_campaign_id     bigint unique,
  status                   text not null default 'draft'
                             check (status in ('draft','active','paused','completed','stopped')),
  leads_per_day            int not null default 20,   -- throttle (mailbox is the real bottleneck)
  anchor_date              date,
  settings                 jsonb not null default '{}'::jsonb,  -- {pause_on_reply, exclude_dnc, ...}
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_campaigns_owner_status on public.campaigns(owner_user_id, status);

-- ── 3. One row per contact enrolled in a campaign ───────────────────────────
-- enroll_position drives the per-lead throttle math: first_send_at is computed
-- as anchor + floor((enroll_position-1)/leads_per_day), then reconciled against
-- Smartlead's actual sends. Every step (incl. manual tasks) anchors off THIS
-- row's first_send_at, never one global campaign date (see plan §5).
create table if not exists public.campaign_enrollments (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.campaigns(id) on delete cascade,
  contact_id     uuid references public.contacts(id) on delete cascade,
  account_id     uuid references public.accounts(id) on delete set null,
  owner_user_id  uuid references public.user_profiles(id) on delete set null,
  enroll_position int not null default 0,
  first_send_at  timestamptz,
  current_step   int not null default 0,
  status         text not null default 'active'
                   check (status in ('active','paused','completed','stopped','replied','bounced')),
  paused_reason  text,
  enrolled_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists uq_enrollment_campaign_contact
  on public.campaign_enrollments(campaign_id, contact_id);  -- no double-enroll in the same campaign
create index if not exists idx_enrollment_owner_status
  on public.campaign_enrollments(owner_user_id, status);
create index if not exists idx_enrollment_contact_status
  on public.campaign_enrollments(contact_id, status);

-- ── 4. Link campaign-spawned tasks back to their enrollment ─────────────────
-- A CALL/LINKEDIN/HYBRID step becomes an `activities` task; these columns let
-- us cancel an enrollment's pending tasks when it pauses/stops, and trace a
-- task to its step.
alter table public.activities
  add column if not exists campaign_enrollment_id uuid references public.campaign_enrollments(id) on delete set null,
  add column if not exists campaign_step_number int,
  add column if not exists is_campaign_generated boolean not null default false;
create index if not exists idx_activities_campaign_enrollment
  on public.activities(campaign_enrollment_id) where campaign_enrollment_id is not null;

-- ── 5. RLS — admin-only for now (Phase 5 opens to reps) ─────────────────────
alter table public.campaign_templates    enable row level security;
alter table public.campaigns             enable row level security;
alter table public.campaign_enrollments  enable row level security;

drop policy if exists campaign_templates_admin on public.campaign_templates;
create policy campaign_templates_admin on public.campaign_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists campaigns_admin on public.campaigns;
create policy campaigns_admin on public.campaigns
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists campaign_enrollments_admin on public.campaign_enrollments;
create policy campaign_enrollments_admin on public.campaign_enrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 6. Seed presets (fixed UUIDs => idempotent) ─────────────────────────────
-- 8-Touch (the flagship spec) + Warming (3 emails, email-only to start).
insert into public.campaign_templates (id, name, description, category, is_preset, duration_days, step_count, steps, domain_rules)
values (
  '11111111-0000-4000-a000-000000000001',
  '8-Touch Sales Sequence',
  '28 days, 8 touches across email, call, and LinkedIn. Auto emails on Days 1 & 5; calls (Tue/Fri), LinkedIn, and rep-reviewed emails fill the rest. Pauses on reply or booked meeting.',
  'flagship', true, 28, 8,
  $steps$[
    {"order":1,"day_offset":1,"channel":"EMAIL_AUTO","weekday_target":"MON","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""},
    {"order":2,"day_offset":5,"channel":"EMAIL_AUTO","weekday_target":"FRI","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""},
    {"order":3,"day_offset":8,"channel":"CALL","weekday_target":"TUE","send_window_start":"10:00","send_window_end":"12:00","automation":"MANUAL","manual_task_title_template":"Call {{first_name}} @ {{company}}","manual_task_priority":"high","task_note_template":"First call attempt. Reference the Day 5 email."},
    {"order":4,"day_offset":12,"channel":"LINKEDIN","weekday_target":"WED","send_window_start":"09:00","send_window_end":"10:00","automation":"MANUAL","manual_task_title_template":"LinkedIn connect: {{first_name}}","manual_task_priority":"normal","task_note_template":"Send a connection request (no pitch)."},
    {"order":5,"day_offset":15,"channel":"EMAIL_HYBRID","weekday_target":"MON","send_window_start":"10:00","send_window_end":"11:00","automation":"HYBRID","content_ai_draft":true,"manual_task_title_template":"Review & send value email to {{first_name}}","manual_task_priority":"high","task_note_template":"Personalize with industry / FTE / a local customer win, then send."},
    {"order":6,"day_offset":19,"channel":"CALL","weekday_target":"FRI","send_window_start":"10:00","send_window_end":"12:00","automation":"MANUAL","manual_task_title_template":"Call {{first_name}} @ {{company}}","manual_task_priority":"high","task_note_template":"Second call attempt. Reference LinkedIn or prior opens."},
    {"order":7,"day_offset":23,"channel":"LINKEDIN","weekday_target":"TUE","send_window_start":"09:00","send_window_end":"10:00","automation":"MANUAL","manual_task_title_template":"LinkedIn message: {{first_name}}","manual_task_priority":"normal","task_note_template":"Short, personal message now that you're connected. No pitch."},
    {"order":8,"day_offset":26,"channel":"EMAIL_HYBRID","weekday_target":"FRI","send_window_start":"10:00","send_window_end":"11:00","automation":"HYBRID","content_ai_draft":true,"manual_task_title_template":"Review & send breakup email to {{first_name}}","manual_task_priority":"normal","task_note_template":"Honest, zero-pressure breakup email. No response -> tag Nurture."}
  ]$steps$::jsonb,
  '{"start_anchor":"nearest_monday","call_days":["TUE","FRI"],"post_sequence_tag":"Nurture","reenroll_after_days":90}'::jsonb
)
on conflict (id) do nothing;

insert into public.campaign_templates (id, name, description, category, is_preset, duration_days, step_count, steps, domain_rules)
values (
  '11111111-0000-4000-a000-000000000002',
  'Warming Sequence',
  'A gentle email-only warm-up — 3 short emails over ~8 days. Launch as-is on a contact, or edit to add calls/LinkedIn.',
  'warming', true, 8, 3,
  $steps$[
    {"order":1,"day_offset":1,"channel":"EMAIL_AUTO","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""},
    {"order":2,"day_offset":4,"channel":"EMAIL_AUTO","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""},
    {"order":3,"day_offset":8,"channel":"EMAIL_AUTO","send_window_start":"10:00","send_window_end":"11:00","automation":"AUTO","content_ai_draft":true,"pause_on_reply":true,"stop_on_unsubscribe":true,"subject_template":"","body_template":""}
  ]$steps$::jsonb,
  '{"start_anchor":"none"}'::jsonb
)
on conflict (id) do nothing;

commit;

notify pgrst, 'reload schema';
