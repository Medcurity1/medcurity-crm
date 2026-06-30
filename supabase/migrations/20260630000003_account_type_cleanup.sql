-- ---------------------------------------------------------------------
-- Account Type cleanup (Summer's request, 2026-06-29).
--
-- Summer: "The other account options are Direct, Referral, and Self Service.
-- These really don't make a lot of sense to me... Referral we should track in
-- the partner tab, and the self service can change from year to year and
-- should really be tracked in opportunities."
--
-- After this change, Account Type is just the "is this a Partner?" marker:
--   - Client / Prospect / Former Client → now the automatic Customer Status
--     (20260630000002), derived from deal history. Not an Account Type anymore.
--   - Referral → tracked in the Partner tab.
--   - Self-Service → varies year to year, tracked on Opportunities.
--
-- Nothing is deleted: existing account_type values are preserved and still
-- display (PicklistSelect shows a retired stored value as "(legacy)" and keeps
-- it on save). We only change what's offered for NEW selection.
-- ---------------------------------------------------------------------

begin;

-- 1. Account Type is no longer required. Summer flagged it as a required field
--    she was filling in just to satisfy ("Since it is a required field, I was
--    looking to streamline it"). With the confusing values retired, requiring
--    it makes no sense. Mirrors the renewal_type un-require (20260625000010);
--    no-op if the row is absent.
update public.required_field_config
   set is_required = false
 where entity = 'accounts'
   and field_key = 'account_type';

-- 2. Standardize the single partner type onto the canonical 'Partner' value that
--    the auto-flag trigger (20260422000005) and the Partners list
--    (v_partner_accounts) already use. 'Partner - Alliance' was the only partner
--    option; folding it into 'Partner' matches how Summer refers to it and lands
--    these accounts in the Partners list correctly. Marketing suppression already
--    checks BOTH values (20260624000008), so the do-not-email list is unaffected.
update public.accounts
   set account_type = 'Partner'
 where account_type = 'Partner - Alliance';

-- 3. Retire the non-partner options from new selection (data preserved).
update public.picklist_options
   set is_active = false
 where field_key = 'accounts.account_type'
   and value in ('Direct', 'Referral', 'Self-Service', 'Partner - Alliance');

-- 4. Ensure one clean, active 'Partner' option.
insert into public.picklist_options (field_key, value, label, sort_order, is_active)
values ('accounts.account_type', 'Partner', 'Partner', 10, true)
on conflict (field_key, value)
  do update set label = excluded.label,
                sort_order = excluded.sort_order,
                is_active = true;

commit;

notify pgrst, 'reload schema';
