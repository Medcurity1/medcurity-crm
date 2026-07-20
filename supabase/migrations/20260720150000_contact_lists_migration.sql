-- D2 of the lead-type retirement (docs/imports-tab-plan.md): lists become
-- pure CONTACT lists.
--
--  1. Members that point at a PROMOTED lead are repointed to the contact
--     that lead became (skipped when that contact is already on the list —
--     the unique(list_id, contact_id) constraint stays authoritative).
--  2. Remaining lead members (unpromoted rows — the archived purchased-list
--     junk) are dropped; their leads are frozen history.
--
-- Idempotent: step 1's predicate empties itself; step 2 is a no-op once
-- lead members are gone. The lead_lists / lead_list_members TABLE NAMES are
-- internal and keep working for the Lists page + Cold Call widget.

update public.lead_list_members m
   set contact_id = l.converted_contact_id,
       lead_id = null
  from public.leads l
 where m.lead_id = l.id
   and m.contact_id is null
   and l.converted_contact_id is not null
   and not exists (
     select 1
       from public.lead_list_members m2
      where m2.list_id = m.list_id
        and m2.contact_id = l.converted_contact_id
   );

delete from public.lead_list_members
 where lead_id is not null;
