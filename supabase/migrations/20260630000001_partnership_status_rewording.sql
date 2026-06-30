-- ---------------------------------------------------------------------
-- Partner relationship stages → the team's agreed wording (Summer + Molly,
-- 2026-06-29): Active / Prospective / Lost.
--
-- Maps the old values: in_conversation + on_hold → prospective (still in
-- progress / paused, not dead); inactive → lost. Self-contained: this is the
-- separate `partnership_status` field, NOT account_type, so it doesn't touch the
-- Partners list or the ARR report.
-- ---------------------------------------------------------------------

begin;

-- 1. Migrate existing account data to the new values (so no row is left holding
--    a value that's no longer in the picklist).
update public.accounts
   set partnership_status = 'prospective'
 where partnership_status in ('in_conversation', 'on_hold');

update public.accounts
   set partnership_status = 'lost'
 where partnership_status = 'inactive';

-- 2. Replace the picklist options. partnership_status is a free-text field in the
--    Zod schema (not an enum), so no frontend change is needed; PicklistSelect
--    reads these options dynamically.
delete from public.picklist_options
 where field_key = 'accounts.partnership_status';

insert into public.picklist_options (field_key, value, label, sort_order) values
  ('accounts.partnership_status', 'active',      'Active',      10),
  ('accounts.partnership_status', 'prospective', 'Prospective', 20),
  ('accounts.partnership_status', 'lost',        'Lost',        30);

commit;

notify pgrst, 'reload schema';
