-- ============================================================
-- Partners feature — audit fixes (SQL foundation)
-- ----------------------------------------------------------------
-- From the Partners audit. This migration covers the data-layer half:
--   1. Block REVERSE-direction duplicate partnerships (A->B and B->A).
--   2. Add the partner_source column the SF importer was silently
--      dropping on contacts + leads (data-loss bug, same class as the
--      977-phone-numbers incident).
--   3. Make the account "Last Contact" reflect real interactions
--      (calls/emails/meetings + completed tasks), not completed tasks
--      only — logged calls/emails set activity_date, not completed_at.
--   4. Add the missing activities(account_id) index that the last-
--      contact lookup needs.
--   5. Add v_partner_accounts so the /partners page paginates server-
--      side instead of pulling the whole partnership table into the
--      browser on every load/sort/filter (perf + long-URL fix).
-- ============================================================

begin;

-- 1. Reverse-direction duplicate guard ---------------------------------
-- account_partners already has UNIQUE(partner_account_id, member_account_id)
-- (exact direction) + CHECK(partner <> member) (no self-partnership). But
-- "A is partner of B" and "B is partner of A" are contradictory and both
-- currently insert. Treat the pair as unordered so only ONE relationship
-- between two accounts can exist, in whichever direction was entered first.
create unique index if not exists ux_account_partners_unordered_pair
  on public.account_partners (
    least(partner_account_id, member_account_id),
    greatest(partner_account_id, member_account_id)
  );

-- 2. partner_source on contacts + leads --------------------------------
-- The SF importer maps "Partner Source" to this column; it never existed,
-- so every value was dropped into the unmapped bucket. Add it so the
-- attribution actually lands and is reportable.
alter table public.contacts add column if not exists partner_source text;
alter table public.leads    add column if not exists partner_source text;
comment on column public.contacts.partner_source is
  'Partner/channel this contact was sourced through (from SF Partner_Source). Preserved on import.';
comment on column public.leads.partner_source is
  'Partner/channel this lead was sourced through (from SF Partner_Source). Preserved on import.';

-- 3. Corrected "last contact" rule -------------------------------------
-- OLD: max(completed_at) filter (completed_at is not null) — only counted
-- completed TASKS, so a partner worked entirely via logged calls/emails/
-- meetings showed "—". Logged interactions carry activity_date (not
-- completed_at), so count those plus completed tasks, by when they
-- actually happened. SECURITY INVOKER (default) keeps activities RLS.
create or replace view public.v_account_last_activity as
select
  a.account_id,
  max(coalesce(a.completed_at, a.activity_date, a.created_at)) as last_activity_at
from public.activities a
where a.account_id is not null
  and a.archived_at is null
  and (
    a.activity_type in ('call', 'email', 'meeting')  -- real interactions
    or a.completed_at is not null                      -- completed tasks
  )
group by a.account_id;

comment on view public.v_account_last_activity is
  'Per-account most-recent real interaction (calls/emails/meetings by activity_date + completed tasks by completed_at). Powers the Partners list "Last Contact" column.';

-- 4. Supporting index for the per-account activity lookup --------------
create index if not exists idx_activities_account_id
  on public.activities (account_id)
  where account_id is not null;

-- 5. Server-side partner-accounts view ---------------------------------
-- The /partners page used to fetch the ENTIRE account_partners table into
-- the browser on every render to compute member counts + umbrella/member
-- flags, then OR a list of ids into the request URL. This view computes
-- all of that in Postgres so the page can paginate normally. Last-contact
-- is intentionally NOT joined here (it would force a full activities
-- aggregate per page request); the page looks it up for the visible page
-- only. SECURITY INVOKER (default) so accounts RLS still applies.
create or replace view public.v_partner_accounts as
with member_counts as (
  select partner_account_id as account_id, count(*)::int as member_count
  from public.account_partners
  group by partner_account_id
),
members as (
  select distinct member_account_id as account_id
  from public.account_partners
)
select
  a.*,
  coalesce(mc.member_count, 0)        as member_count,
  (mc.account_id is not null)         as is_umbrella,
  (mem.account_id is not null)        as is_member,
  -- top-level = an umbrella that isn't itself a member of anyone
  (mc.account_id is not null and mem.account_id is null) as is_top_level,
  up.full_name                        as owner_full_name
from public.accounts a
left join member_counts mc on mc.account_id = a.id
left join members mem       on mem.account_id = a.id
left join public.user_profiles up on up.id = a.owner_user_id
where a.archived_at is null
  and (
    a.account_type = 'Partner'
    or a.partner_account is not null
    or a.partner_prospect = true
    or mc.account_id is not null   -- has at least one member relationship
  );

comment on view public.v_partner_accounts is
  'Partner-flagged accounts (account_type=Partner, legacy partner_account text, partner_prospect, or any account_partners umbrella) with member_count + umbrella/member/top_level flags precomputed. Powers the /partners page so it paginates server-side instead of scanning the whole partnership table client-side.';

grant select on public.v_partner_accounts to authenticated;

commit;

notify pgrst, 'reload schema';
