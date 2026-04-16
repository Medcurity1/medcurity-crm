-- Add email-specific metadata columns to activities so the timeline can
-- show From / To / Cc and a reply compose UI.
--
-- Before: sync-emails wrote only subject + body. The UI couldn't tell the
-- user who was on the thread, which made it impossible to reply in-context.
--
-- After: the sync function also records direction, from, to[], cc[],
-- html_body (for fidelity when expanded), and a thread ID for future
-- conversation grouping. These are optional — non-email activities just
-- leave them null.

begin;

alter table public.activities
  add column if not exists email_direction text check (email_direction in ('sent', 'received')),
  add column if not exists email_from text,
  add column if not exists email_to text[],
  add column if not exists email_cc text[],
  add column if not exists email_html_body text,
  add column if not exists email_thread_id text;

comment on column public.activities.email_direction is
  'sent or received. Null for non-email activities.';
comment on column public.activities.email_from is
  'Sender email address (for received) or the connected user''s address (for sent).';
comment on column public.activities.email_to is
  'All direct recipients on the email, regardless of whether they match a CRM contact.';
comment on column public.activities.email_cc is
  'All CC recipients.';
comment on column public.activities.email_html_body is
  'Original HTML body for fidelity when the activity is expanded. The plain-text body is kept in activities.body for preview/search.';
comment on column public.activities.email_thread_id is
  'Provider-level conversation/thread id (Gmail threadId or Outlook conversationId). Lets us group a thread in future UI work.';

-- Search by thread for future conversation-view features.
create index if not exists idx_activities_email_thread
  on public.activities (email_thread_id)
  where email_thread_id is not null;

commit;
