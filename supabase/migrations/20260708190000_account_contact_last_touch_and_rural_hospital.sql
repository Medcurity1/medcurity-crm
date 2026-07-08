-- ---------------------------------------------------------------------
-- Contact-level "last touch" + "caller" views, and the 'Rural Hospital'
-- industry_category enum value (Jordan's Accounts list request).
--
-- 1. v_account_last_activity — ALREADY EXISTS. Created in
--    20260623000001_partners_audit_fixes.sql, security_invoker turned on
--    in 20260623000006_today_review_fixes.sql, and updated in
--    20260707000001_last_activity_views_include_events.sql to include
--    webinar/conference. Its current definition already matches this
--    spec exactly: max(coalesce(completed_at, activity_date,
--    created_at)) over call/email/meeting/webinar/conference + completed
--    tasks, excluding archived rows, grouped by account_id, security
--    invoker on. Nothing to change — left untouched. (It currently powers
--    the Partners "Last Contact" column and v_accounts_with_activity; the
--    Accounts list "Last Touch" column added alongside this migration
--    reads it directly via per-page hydration in useAccounts, the same
--    way useOpportunities reads v_opportunity_last_activity.)
--
-- 2. v_contact_last_activity — NEW. Same interaction semantics as
--    v_account_last_activity / v_opportunity_last_activity, grouped per
--    contact instead. EXACT name/columns per spec — a parallel agent is
--    building Nexus widget columns against this view.
--
-- 3. v_contact_callers — NEW. Distinct (contact_id, caller_user_id)
--    pairs: which users have logged a call activity against a contact.
--    "Caller" = activities.owner_user_id, the same column every other
--    view in this schema uses for "who this activity belongs to" (there
--    is no separate created_by on activities). EXACT name/columns per
--    spec — same parallel consumer as #2.
--
-- 4. 'Rural Hospital' — ALREADY EXISTS on the Postgres enum. Added by
--    20260506000002_industry_category_expand.sql ('rural_hospital'),
--    already valid in accounts/schema.ts's Zod mirror (same migration's
--    era, see its "Added May 6" comment), and already an option in
--    AccountForm.tsx's Industry dropdown (line ~625). The actual gap was
--    front-end-only: src/types/crm.ts's IndustryCategory union and
--    src/lib/formatters.ts's INDUSTRY_CATEGORY_LABELS map never picked up
--    the May 6 expansion, so the value rendered via the title-case
--    fallback and never appeared as an Industry FILTER option. Both are
--    fixed in this PR outside this migration. The ADD VALUE below is a
--    documented no-op (IF NOT EXISTS) kept per spec / as a safety net for
--    any environment seeded from a pre-May-6 snapshot.
-- ---------------------------------------------------------------------

begin;

create or replace view public.v_contact_last_activity
with (security_invoker = on) as
select
  a.contact_id,
  max(coalesce(a.completed_at, a.activity_date, a.created_at)) as last_activity_at
from public.activities a
where a.contact_id is not null
  and a.archived_at is null
  and (
    a.activity_type in ('call', 'email', 'meeting', 'webinar', 'conference')  -- real interactions
    or a.completed_at is not null                                              -- completed tasks
  )
group by a.contact_id;

comment on view public.v_contact_last_activity is
  'Per-contact most-recent real interaction (calls/emails/meetings/webinars/conferences by activity_date + completed tasks by completed_at), excluding archived. Mirrors v_account_last_activity / v_opportunity_last_activity.';

grant select on public.v_contact_last_activity to authenticated;

-- No new index: idx_activities_contact_id (20260706000000, partial on
-- contact_id is not null) already covers this view's + v_contact_callers'
-- lookup, matching the sibling views (they don't index archived_at either).

create or replace view public.v_contact_callers
with (security_invoker = on) as
select distinct
  a.contact_id,
  a.owner_user_id as caller_user_id
from public.activities a
where a.contact_id is not null
  and a.owner_user_id is not null
  and a.activity_type = 'call'
  and a.archived_at is null;

comment on view public.v_contact_callers is
  'Distinct (contact_id, caller_user_id) pairs: users who have logged a call activity (activity_type=call, not archived) against the contact. caller_user_id = activities.owner_user_id.';

grant select on public.v_contact_callers to authenticated;

commit;

-- Separate transaction: ALTER TYPE ... ADD VALUE cannot run in the same
-- transaction block as a statement that USES the new value (Postgres 15
-- rule; see 20260506000002 and 20260707000000 for repo precedent). Nothing
-- above uses 'rural_hospital', but this is split out anyway to keep the
-- enum change trivially safe to reason about on its own.
begin;

alter type public.industry_category add value if not exists 'rural_hospital';

commit;

notify pgrst, 'reload schema';
