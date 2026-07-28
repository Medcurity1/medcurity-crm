-- Campaigns outside-review fix batch (2026-07-28) — fixes 1 + 2 of 4,
-- amended same-day by the batch's own adversarial review.
--
-- FIX 1 (CRITICAL — normalization hole): v_marketing_suppression emitted
-- emails exactly as stored (space-only btrim, never lowercased), but both
-- callers (fetchSuppressionForEmails in playbook-smartlead/index.ts and its
-- client twin in src/features/playbook/api.ts) normalize their query side
-- with JS .trim().toLowerCase() and match with exact equality via
-- `.in("email", batch)`. A contact stored as Jane.Doe@Clinic.org — or as
-- "jane@x.com " (a non-breaking space, routine when an address is
-- pasted out of Word/Outlook) — therefore never matched and was emailed
-- despite being on the Do-Not-Email list. The view now emits
-- marketing_email_normalize() (lowercase + wide-whitespace trim, covering
-- the characters JS .trim() strips that btrim's default does not).
--
-- FIX 2 (HIGH — opt-outs that stick): a campaign unsubscribe's only durable
-- side effect was contacts.do_not_contact = true, which (a) never fired for
-- CSV/paste recipients (their enrollments carry contact_id NULL by design)
-- and (b) never fired at all when the enrollment had already reached a
-- terminal status before the unsubscribe arrived — the common ordering,
-- since "take me off your list" lands as a reply first. marketing_optouts
-- is the central, email-keyed record: written by the webhook and the daily
-- sweep (stopEnrollmentForUnsubscribe / stopEnrollmentForBounce in
-- _shared/campaign-enrollment-actions.ts), and read by a new
-- v_marketing_suppression branch so every existing suppression consumer
-- (client recipient screen, server launch re-check, Do-Not-Email report)
-- picks it up with no further query changes.
--
-- ESCAPE HATCH (adversarial review): optout_unsubscribed/optout_manual are
-- non-overridable at launch, so a row with no removal path would let one
-- mistaken or forged unsubscribe block an address forever. revoked_at +
-- an admin-only column-scoped UPDATE grant back the Do-Not-Email report's
-- "Re-allow" action; revoked rows stay as history but leave the view.
--
-- SELF-VERIFYING (same invariant style as 20260720155000): counts distinct
-- normalized emails through the view before and after the swap and aborts
-- the whole migration on any difference. Both counts use the SAME
-- marketing_email_normalize(), so the sets are directly comparable even
-- where the wider trim merges two previously-distinct raw values.
-- Known (inherited) narrow race: the two counts run under READ COMMITTED
-- snapshots, so a concurrent suppression-set change mid-migration can trip
-- the check spuriously — the abort is loud, nothing partially applies, and
-- a re-run succeeds. SET TRANSACTION ISOLATION was considered and rejected:
-- it errors outright if the CLI's wrapping transaction has already issued a
-- query (e.g. an advisory lock), which would fail every deploy.
--
-- Idempotent: table create is IF NOT EXISTS, the function/view recreates
-- and policy drops re-run cleanly, and a re-run's invariant compares equal.

begin;

-- ── 0. One normalization, defined once, used by the CHECK, the invariant,
--       and every email the view emits ────────────────────────────────────
-- The btrim character set = space, tab, LF, VT, FF, CR, NBSP (U+00A0),
-- BOM (U+FEFF), narrow NBSP (U+202F) — the whitespace JS .trim() strips
-- that shows up in real pasted/imported addresses. JS normalization strips
-- a superset, so a JS-normalized value is always a fixed point of this.
-- Every character in the trim set is an explicit escape - no invisible
-- literals. (U+000B vertical tab is written as a unicode escape: Postgres
-- E-strings have no backslash-v, and a literal v in this set would strip
-- the letter v from real addresses.)
create or replace function public.marketing_email_normalize(raw text)
returns text
language sql
immutable
as $$
  select lower(btrim(raw, E' \t\n\r\f\u000B\u00A0\uFEFF\u202F'))
$$;

comment on function public.marketing_email_normalize(text) is
  'Canonical email normalization for the Do-Not-Email machinery (2026-07-28): lowercase + wide-whitespace trim, matching the JS .trim().toLowerCase() every suppression caller applies to its query side. Used by v_marketing_suppression''s emitted emails and marketing_optouts'' CHECK.';

-- ── 1. The central opt-out table ────────────────────────────────────────────
create table if not exists public.marketing_optouts (
  id            uuid primary key default gen_random_uuid(),
  -- Stored pre-normalized (writers JS-normalize; the CHECK makes it a hard
  -- guarantee) so the view branch below needs no per-row function call.
  email         text not null check (email = public.marketing_email_normalize(email) and email <> ''),
  reason        text not null check (reason in ('unsubscribed','bounced','manual')),
  source        text not null default 'webhook',   -- webhook | daily-sweep | manual
  campaign_id   uuid references public.campaigns(id) on delete set null,
  enrollment_id uuid references public.campaign_enrollments(id) on delete set null,
  first_name    text,
  last_name     text,
  company       text,
  created_at    timestamptz not null default timezone('utc', now()),
  -- Set by an admin via the Do-Not-Email report's "Re-allow" action; a
  -- revoked row stays as history but leaves the suppression view.
  revoked_at    timestamptz,
  unique (email, reason)
);

comment on table public.marketing_optouts is
  'Central email-keyed opt-out/bounce record for Campaigns (outside-review fix 2, 2026-07-28). Written service-role-only by the campaign webhook + daily sweep; feeds the optout_* branch of v_marketing_suppression (revoked_at null only) so every send path checks it. reason=unsubscribed/manual are non-overridable at launch ("Include anyway" is refused — see NON_OVERRIDABLE_SUPPRESSION_REASONS in playbook-smartlead/index.ts and src/features/playbook/suppression.ts); reason=bounced stays overridable. Admins can revoke a row (Re-allow) via the column-scoped revoked_at UPDATE grant.';

alter table public.marketing_optouts enable row level security;

-- Read for signed-in users (the security_invoker view below runs as the
-- caller). Inserts/deletes stay service-role only. The ONE client write
-- allowed is an admin flipping revoked_at (the "Re-allow" escape hatch):
-- RLS gates the row to admins, and the column-level UPDATE grant means
-- even an admin can't rewrite email/reason through PostgREST.
drop policy if exists marketing_optouts_read on public.marketing_optouts;
create policy marketing_optouts_read on public.marketing_optouts
  for select to authenticated using (true);

drop policy if exists marketing_optouts_admin_revoke on public.marketing_optouts;
create policy marketing_optouts_admin_revoke on public.marketing_optouts
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.marketing_optouts to authenticated;
grant update (revoked_at) on public.marketing_optouts to authenticated;
revoke all on public.marketing_optouts from anon;

-- ── 2. Invariant setup: distinct suppressed emails through the OLD view ─────
create temp table _supp_invariant_case_fix on commit drop as
select count(distinct public.marketing_email_normalize(email))::bigint as n
  from public.v_marketing_suppression;

-- ── 3. Rebuild the view: 20260720155000's definition with every emitted
--       email normalized, plus the marketing_optouts branch ─────────────────
create or replace view public.v_marketing_suppression
with (security_invoker = on) as
with won as (
  select o.account_id,
         bool_or(
           (o.contract_end_date is not null and o.contract_end_date >= current_date)
           or (o.contract_end_date is null and o.close_date is not null
               and o.close_date >= current_date - 365)
         ) as active_won
    from public.opportunities o
   where o.stage = 'closed_won'
     and o.archived_at is null
     and o.account_id is not null
   group by o.account_id
),
c as (
  select c.id, c.first_name, c.last_name, em.email, c.account_id, c.owner_user_id,
         c.do_not_contact, c.no_longer_employed, c.archived_at,
         a.name as account_name, a.account_type,
         (case a.customer_status
            when 'client'        then 'customer'
            when 'former_client' then 'former_customer'
            else                      'prospect'
          end)::public.account_lifecycle as lifecycle_status,
         a.customer_status,
         a.do_not_contact as account_dnc, a.archived_at as account_archived,
         (w.account_id is not null)       as ever_won,
         coalesce(w.active_won, false)     as active_won
    from public.contacts c
    left join public.accounts a on a.id = c.account_id
    left join won w on w.account_id = c.account_id
    cross join lateral (
      -- FIX 1: normalized here, matching the JS normalization every caller
      -- applies to its query side before `.in("email", ...)`.
      select e as email
        from unnest(array[
          nullif(public.marketing_email_normalize(c.email), ''),
          nullif(public.marketing_email_normalize(c.email2), ''),
          nullif(public.marketing_email_normalize(c.email3), '')
        ]) as e
       where e is not null
    ) em
)
select 'contact'::text as source_kind, c.id as source_id, 'customer_account'::text as reason,
       c.first_name, c.last_name, c.email, c.account_name as company,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where (c.active_won or c.customer_status = 'client')
union all
select 'contact', c.id, 'former_customer_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where not (c.active_won or c.customer_status = 'client')
   and (c.ever_won or c.customer_status = 'former_client')
union all
select 'contact', c.id, 'partner_account',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c
 where c.account_id is not null
   and (
        exists (select 1 from public.v_partner_accounts vpa where vpa.id = c.account_id)
        or c.account_type ilike 'Partner%'
       )
union all
select 'contact', c.id, 'contact_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.do_not_contact = true
union all
select 'contact', c.id, 'account_do_not_contact',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.account_dnc = true
union all
select 'contact', c.id, 'contact_no_longer_employed',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.no_longer_employed = true
union all
select 'contact', c.id, 'contact_archived',
       c.first_name, c.last_name, c.email, c.account_name,
       c.account_id, c.account_type, c.lifecycle_status, c.owner_user_id
  from c where c.archived_at is not null
union all
select f.source_kind, f.source_id, f.reason,
       f.first_name, f.last_name, public.marketing_email_normalize(f.email), f.company,
       null::uuid, null::text, null::public.account_lifecycle, f.owner_user_id
  from public.marketing_suppression_frozen f
union all
-- FIX 2: recorded campaign opt-outs/bounces — covers CSV/paste recipients
-- with no contact row. email is stored pre-normalized (CHECK above);
-- revoked rows (admin Re-allow) drop out of suppression but stay as history.
select 'optout'::text, o.id, ('optout_' || o.reason)::text,
       o.first_name, o.last_name, o.email, o.company,
       null::uuid, null::text, null::public.account_lifecycle, null::uuid
  from public.marketing_optouts o
 where o.revoked_at is null;

grant select on public.v_marketing_suppression to authenticated;
revoke all on public.v_marketing_suppression from anon;

-- ── 4. Invariant check: the swap must not change the unique email set ───────
do $$
declare
  v_before bigint;
  v_after bigint;
begin
  select n into v_before from _supp_invariant_case_fix;
  select count(distinct public.marketing_email_normalize(email)) into v_after
    from public.v_marketing_suppression;
  if v_after <> v_before then
    raise exception
      'suppression invariant broken: % unique emails before, % after — aborting',
      v_before, v_after;
  end if;
end;
$$;

commit;

notify pgrst, 'reload schema';
