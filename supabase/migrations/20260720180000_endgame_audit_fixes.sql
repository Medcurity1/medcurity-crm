-- Adversarial-review fixes for the retirement endgame (2026-07-20 evening
-- review, findings #2 #3 #7 #11 #15 — docs/imports-tab-plan.md).

begin;

-- ---------------------------------------------------------------------
-- #2: Avoids made AFTER the suppression snapshot must still suppress.
-- The legacy tools (mark_import_avoid, bulk_archive_leads_by_list, the
-- straggler sweep, archive_record) keep writing avoid/archive signal to
-- the frozen leads table — this trigger mirrors every such write into
-- marketing_suppression_frozen, which the view and the import guard read.
-- Runs with definer privileges (the writers are SECURITY DEFINER RPCs),
-- so RLS on the snapshot table is not in the way.
-- ---------------------------------------------------------------------

create or replace function public.sync_lead_suppression_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or btrim(new.email) = '' then
    return new;
  end if;
  insert into public.marketing_suppression_frozen
    (source_kind, source_id, reason, first_name, last_name, email, company, owner_user_id)
  select 'lead', new.id, r.reason, new.first_name, new.last_name,
         new.email, new.company, new.owner_user_id
    from (values
      ('lead_do_not_market',  new.do_not_market_to = true),
      ('lead_do_not_contact', new.do_not_contact = true),
      ('lead_avoid',          new.avoid_reason is not null),
      ('lead_archived',       new.archived_at is not null)
    ) as r(reason, matches)
   where r.matches
  on conflict (source_id, reason) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_leads_suppression_sync on public.leads;
create trigger trg_leads_suppression_sync
  after insert or update on public.leads
  for each row
  execute function public.sync_lead_suppression_frozen();

-- ---------------------------------------------------------------------
-- #3: index the import guard's probes — the archived-contact check can't
-- use the live-side partial email indexes (they're WHERE archived_at IS
-- NULL), and the frozen snapshot (~38k rows on staging) had no email
-- index. Without these, a 500-row preview chunk = up to ~1000 sequential
-- scans in one statement — the exact 2026-07-17 timeout pattern.
-- The tiny partial index bounds the contact probe to avoided rows only;
-- the expression index makes the frozen probe a straight lookup.
-- ---------------------------------------------------------------------

create index if not exists idx_suppression_frozen_email
  on public.marketing_suppression_frozen (lower(btrim(email)));

create index if not exists idx_contacts_archived_dnc
  on public.contacts (id)
  where archived_at is not null and do_not_contact;

-- ---------------------------------------------------------------------
-- #7: pen rows out of the cold-call pool (the one pen-leak surface the
-- sweep missed). Re-emit of 20260622000003 with the import_status filter;
-- everything else verbatim.
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- #11: smart lists are fully static now (their lead-based filter_config
-- is inert). Clearing the flag makes AddToListDialog offer them again —
-- half-retired was inconsistent.
-- ---------------------------------------------------------------------

update public.lead_lists set is_dynamic = false where is_dynamic;

-- ---------------------------------------------------------------------
-- #15: keep the pre-freeze access semantics — lead-sourced suppression
-- rows were admin-only (leads RLS) through the invoker view; the snapshot
-- table's read-for-everyone policy quietly widened that. Back to admins.
-- (The import guard reads it via SECURITY DEFINER — unaffected.)
-- ---------------------------------------------------------------------

drop policy if exists suppression_frozen_read on public.marketing_suppression_frozen;
create policy suppression_frozen_read on public.marketing_suppression_frozen
  for select to authenticated
  using (public.is_admin());

commit;

notify pgrst, 'reload schema';
