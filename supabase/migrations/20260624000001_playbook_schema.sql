-- ============================================================
-- Playbook — schema (port of the Nexus marketing co-pilot)
-- ----------------------------------------------------------------
-- Admin-only feature ported from the legacy Nexus app:
--   - playbook_ideas      : weekly AI-generated marketing ideas
--   - playbook_campaigns  : cold-email campaigns (Smartlead) + the
--                           sales-workflow tracker that replaces Nexus's
--                           "Waypoint" calendar
--   - playbook_training   : team feedback notes that steer every AI gen
--   - playbook_reports    : the weekly ideas report snapshot (idempotent)
--   - campaign_drafts     : in-progress wizard state (per user)
--   - campaign_adaptations: AI-proposed edits to not-yet-sent emails
--
-- Every table is admin-only via the existing public.is_admin() helper
-- (super_admin included — see 20260416000003). Status spellings use
-- underscores everywhere (in_progress), enforced by CHECK constraints.
-- ============================================================

begin;

-- 1. Campaigns (linchpin — also the Waypoint-replacement tracker) -------
create table if not exists public.playbook_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  platform text not null default 'smartlead' check (platform in ('smartlead', 'mailchimp')),
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'complete')),
  smartlead_campaign_id bigint,
  mailchimp_campaign_id text,
  notes text,                                  -- sequence / content
  metrics jsonb,                               -- {sent, openRate, clickRate, replies, bounces}
  analyzed_at timestamptz,
  analysis_json jsonb,
  adaptive_enabled boolean not null default false,
  adaptation_history jsonb,
  -- Sales-workflow tracker (the Waypoint replacement):
  workflow_steps jsonb,                        -- [{type:'email'|'call', label, status}]
  current_step integer not null default 0,
  owner_id uuid references public.user_profiles(id),  -- whose inbox / who to nudge
  created_by uuid references public.user_profiles(id) default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
-- Partial unique indexes: idempotent re-import keys (mirror Nexus).
create unique index if not exists ux_playbook_campaigns_smartlead
  on public.playbook_campaigns (smartlead_campaign_id) where smartlead_campaign_id is not null;
create unique index if not exists ux_playbook_campaigns_mailchimp
  on public.playbook_campaigns (mailchimp_campaign_id) where mailchimp_campaign_id is not null;

-- 2. Ideas -------------------------------------------------------------
create table if not exists public.playbook_ideas (
  id uuid primary key default gen_random_uuid(),
  week_date date not null,
  title text not null,
  description text,
  reasoning text,
  action_type text not null default 'strategy' check (action_type in ('campaign', 'content', 'strategy', 'outreach')),
  effort text not null default 'medium' check (effort in ('quick', 'medium', 'big')),
  status text not null default 'new' check (status in ('new', 'good', 'bad', 'booked', 'executed')),
  feedback_note text,
  campaign_prefill jsonb,
  executed_campaign_id uuid references public.playbook_campaigns(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_playbook_ideas_week on public.playbook_ideas (week_date desc);

-- 3. Training notes (the feedback loop) --------------------------------
create table if not exists public.playbook_training (
  id uuid primary key default gen_random_uuid(),
  note text not null,
  source text not null default 'manual',  -- manual|system|thumbs_down|campaign_result|adaptation_feedback|newsletter:*
  related_idea_id uuid references public.playbook_ideas(id) on delete set null,
  created_by uuid references public.user_profiles(id) default auth.uid(),
  created_at timestamptz not null default timezone('utc', now())
);

-- 4. Weekly report snapshot (idempotent per week) ----------------------
create table if not exists public.playbook_reports (
  id uuid primary key default gen_random_uuid(),
  week_date date not null unique,
  ideas_json jsonb,
  context_json jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

-- 5. Wizard drafts (per user) ------------------------------------------
create table if not exists public.campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) default auth.uid(),
  title text not null default '',
  state_json jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- 6. Adaptations (AI-proposed edits to unsent emails) ------------------
create table if not exists public.campaign_adaptations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.playbook_campaigns(id) on delete cascade,
  seq_number integer,
  original_subject text,
  original_body text,
  adapted_subject text,
  adapted_body text,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  metrics_at_time jsonb,
  created_at timestamptz not null default timezone('utc', now())
);
create index if not exists idx_campaign_adaptations_campaign on public.campaign_adaptations (campaign_id);

-- updated_at triggers ---------------------------------------------------
drop trigger if exists trg_playbook_campaigns_updated_at on public.playbook_campaigns;
create trigger trg_playbook_campaigns_updated_at before update on public.playbook_campaigns
  for each row execute function public.set_updated_at();
drop trigger if exists trg_campaign_drafts_updated_at on public.campaign_drafts;
create trigger trg_campaign_drafts_updated_at before update on public.campaign_drafts
  for each row execute function public.set_updated_at();

-- RLS: admin-only across the board -------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'playbook_campaigns','playbook_ideas','playbook_training',
    'playbook_reports','campaign_drafts','campaign_adaptations'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());',
      t || '_admin_all', t);
  end loop;
end $$;

-- Seed the one system training note Nexus ships (verbatim) -------------
insert into public.playbook_training (note, source)
select
  'ADAPTIVE CAMPAIGNS: Never fabricate statistics, customer names, product features, pricing, or claims in adapted emails. Only adjust subject line angle, tone, CTA phrasing, email length, and personalization approach. Keep all factual content identical to the original.',
  'system'
where not exists (
  select 1 from public.playbook_training where source = 'system'
    and note like 'ADAPTIVE CAMPAIGNS:%'
);

commit;

notify pgrst, 'reload schema';
