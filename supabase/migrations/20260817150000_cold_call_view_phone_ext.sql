-- Idle-improvement survey T2 (2026-08-17), Priority 2: the cold-call
-- widget's phone display and tel: link silently drop the extension —
-- v_cold_call_contacts never selected contacts.phone_ext, so there was
-- nothing for the widget to render even after it's fixed client-side.
--
-- Re-emit of 20260720180000's definition (itself a re-emit of
-- 20260622000003) with phone_ext added to the select list. Everything
-- else is byte-equivalent, including the security_invoker = true stance.

begin;

-- DROP + CREATE, not CREATE OR REPLACE: adding phone_ext mid-list is a
-- column-order change, which or-replace rejects (42P16 — it can only
-- APPEND columns). Drop resets grants, so the grant/revoke below are
-- load-bearing, not belt-and-braces.
drop view if exists public.v_cold_call_contacts;
create view public.v_cold_call_contacts
with (security_invoker = true) as
select
  c.id,
  c.first_name,
  c.last_name,
  c.title,
  c.phone,
  c.phone_ext,
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
left join public.accounts a
  on a.id = c.account_id and a.archived_at is null
left join lateral (
  select max(coalesce(act.completed_at, act.activity_date, act.created_at)) as last_activity_at
  from public.activities act
  where act.contact_id = c.id
    and act.archived_at is null
) la on true
where c.archived_at is null
  and c.import_status is null
  and c.do_not_call = false
  and c.no_longer_employed = false
  and c.do_not_contact = false
  and coalesce(btrim(c.phone), '') <> '';

comment on view public.v_cold_call_contacts is
  'Cold-call candidate pool (V3-C): contacts with a phone, not archived, not a pending import, excluded from the outreach flags (do_not_call / no_longer_employed / do_not_contact). last_activity_at powers warm-first sorting + the last-touch column. ICP filtering (org type / state / FTE) is applied by the caller.';

grant select on public.v_cold_call_contacts to authenticated;

-- Belt over braces (matches 20260817103000's stance, which already
-- revoked anon on this exact view once): CREATE OR REPLACE preserves
-- existing grants so this line is a no-op today, but a migration that
-- touches this view's definition without repeating its own revoke is
-- exactly the pattern that has caused every anon-leak incident so far.
-- tests/anonViewGrants.test.ts checks for it explicitly.
revoke all on public.v_cold_call_contacts from anon;

commit;

notify pgrst, 'reload schema';
