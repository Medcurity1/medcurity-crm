-- ============================================================
-- Playbook — newsletters (Mailchimp) schema
-- ----------------------------------------------------------------
-- Ports the Nexus newsletter co-pilot:
--   - playbook_newsletters : ingested + AI-drafted newsletters (The
--                            Medcurity Report / Partner Exclusive). Past
--                            sends are pulled from Mailchimp for metrics +
--                            as style/chrome references; drafts are written
--                            by AI, edited, then PUSHED to Mailchimp as a
--                            DRAFT (a human always sends from Mailchimp).
--   - newsletter_styles    : per-type AI-generated style guide, distilled
--                            from past sends.
--
-- Newsletter-specific training reuses the existing public.playbook_training
-- table with source 'newsletter:report' | 'newsletter:partner' |
-- 'newsletter:general' (no new table needed).
--
-- Admin-only via public.is_admin() (same as the rest of Playbook).
-- ============================================================

begin;

-- 1. Newsletters -------------------------------------------------------
create table if not exists public.playbook_newsletters (
  id uuid primary key default gen_random_uuid(),
  mailchimp_campaign_id text,                  -- null for local drafts
  newsletter_type text not null default 'unclassified'
    check (newsletter_type in ('report', 'partner', 'unclassified')),
  subject text,
  preview_text text,
  from_name text,
  send_time timestamptz,                       -- null for drafts
  status text not null default 'draft'
    check (status in ('draft', 'mailchimp_draft', 'sent')),
  html_content text,
  recipients_json jsonb,                       -- mailchimp recipients object
  metrics jsonb,                               -- {sent, openRate, clickRate, bounces}
  source text not null default 'ingested'
    check (source in ('ingested', 'ai_draft', 'manual')),
  created_by uuid references public.user_profiles(id) default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
-- Idempotent re-import key (mirror the campaigns table).
create unique index if not exists ux_playbook_newsletters_mailchimp
  on public.playbook_newsletters (mailchimp_campaign_id)
  where mailchimp_campaign_id is not null;
create index if not exists ix_playbook_newsletters_type
  on public.playbook_newsletters (newsletter_type);
create index if not exists ix_playbook_newsletters_send_time
  on public.playbook_newsletters (send_time desc);

-- 2. Per-type style guide ----------------------------------------------
create table if not exists public.newsletter_styles (
  newsletter_type text primary key
    check (newsletter_type in ('report', 'partner')),
  style_guide text,
  source_newsletter_count integer not null default 0,
  generated_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

-- RLS: admin-only -------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['playbook_newsletters','newsletter_styles'] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin());',
      t || '_admin_all', t);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
