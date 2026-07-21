-- D2 of the lead-type retirement (docs/imports-tab-plan.md): lists become
-- pure CONTACT lists.
--
-- NOTE ON HISTORY: this file was hardened AFTER staging applied the
-- original version (adversarial-review finding #1, 2026-07-20 evening).
-- Staging's run repointed 0 rows (all its members were unpromoted junk),
-- so the two versions produce identical staging state; PROD runs only this
-- hardened version at cutover. The original could abort with a 23505 when
-- two leads on the SAME list share a converted_contact_id (a real state:
-- archive_lead_as_duplicate and convert_lead's email-dedup both link
-- multiple leads to one contact).
--
--  1. Rows carrying BOTH ids keep their valid contact link (lead_id nulled).
--  2. Members pointing at a PROMOTED lead are repointed to its contact —
--     ranked one-per-(list, contact), skipping contacts already on the
--     list and ARCHIVED contacts (an avoided/archived person doesn't
--     belong on a call list).
--  3. Remaining lead members (unpromoted or losers of the rank) drop.
--  4. Accounts of repointed contacts get the additive sales_active mark
--     the INSERT trigger would have applied (trg_list_member_sales_active
--     doesn't fire on UPDATE).
--
-- Idempotent: every step's predicate empties itself.

begin;

update public.lead_list_members
   set lead_id = null
 where lead_id is not null
   and contact_id is not null;

create temp table _repointed on commit drop as
select m.id as member_id,
       l.converted_contact_id as contact_id,
       row_number() over (
         partition by m.list_id, l.converted_contact_id
         order by m.added_at asc, m.id asc
       ) as rn
  from public.lead_list_members m
  join public.leads l on l.id = m.lead_id
  join public.contacts c on c.id = l.converted_contact_id
 where m.contact_id is null
   and l.converted_contact_id is not null
   and c.archived_at is null
   and not exists (
     select 1
       from public.lead_list_members m2
      where m2.list_id = m.list_id
        and m2.contact_id = l.converted_contact_id
   );

update public.lead_list_members m
   set contact_id = r.contact_id,
       lead_id = null
  from _repointed r
 where m.id = r.member_id
   and r.rn = 1;

-- Additive half of the sales-active invariant, scoped to ONLY the
-- contacts repointed above (matches trg_list_member_sales_active's
-- INSERT behavior). Never flips anything OFF, and never touches accounts
-- whose membership predates this migration — a deliberate manual
-- deactivation stays deactivated.
update public.accounts a
   set sales_active = true
 where a.sales_active is distinct from true
   and exists (
     select 1
       from _repointed r
       join public.contacts c on c.id = r.contact_id
      where r.rn = 1
        and c.account_id = a.id
        and c.archived_at is null
   );

delete from public.lead_list_members
 where lead_id is not null;

commit;
