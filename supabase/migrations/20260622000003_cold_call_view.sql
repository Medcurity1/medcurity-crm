-- ============================================================
-- Cold-call candidate view (V3-C)
-- ----------------------------------------------------------------
-- The homepage cold-call widget queries this LIVE (no daily-materialized
-- snapshot) so it stays correct the instant a Cowork bounce flips
-- do_not_call / no_longer_employed or a rep marks do_not_contact.
--
-- It is the candidate POOL: contacts with a phone, not archived, and not
-- excluded by any outreach flag. ICP filtering (org type / state / FTE) is
-- left to the caller so Summer's criteria can be plugged in without a
-- schema change. `last_activity_at` powers warm-first sorting + the
-- "last touch" column.
--
-- security_invoker = true → the view respects the caller's RLS on the
-- underlying contacts / accounts / activities.
-- ============================================================

create or replace view public.v_cold_call_contacts
with (security_invoker = true) as
select
  c.id,
  c.first_name,
  c.last_name,
  c.title,
  c.phone,
  c.owner_user_id,
  coalesce(c.mailing_state, a.billing_state) as state,
  a.id          as account_id,
  a.name        as account_name,
  a.industry,
  a.account_type,
  a.fte_count,
  a.fte_range,
  la.last_activity_at
from public.contacts c
-- Join only non-archived accounts so the account columns (company / industry
-- / state / FTE) are uniform for everyone. Without this, security_invoker
-- RLS hides an archived account from reps but not admins, so the same row
-- would show populated vs blank company/state per viewer and ICP filters
-- would include/exclude it inconsistently. The contact still appears (LEFT
-- join) — it's just shown account-less.
left join public.accounts a
  on a.id = c.account_id and a.archived_at is null
left join lateral (
  select max(coalesce(act.completed_at, act.activity_date, act.created_at)) as last_activity_at
  from public.activities act
  where act.contact_id = c.id
    and act.archived_at is null
) la on true
where c.archived_at is null
  and c.do_not_call = false
  and c.no_longer_employed = false
  and c.do_not_contact = false
  and coalesce(btrim(c.phone), '') <> '';

comment on view public.v_cold_call_contacts is
  'Cold-call candidate pool (V3-C): contacts with a phone, not archived, excluded from the outreach flags (do_not_call / no_longer_employed / do_not_contact). last_activity_at powers warm-first sorting + the last-touch column. ICP filtering (org type / state / FTE) is applied by the caller.';

grant select on public.v_cold_call_contacts to authenticated;

notify pgrst, 'reload schema';
