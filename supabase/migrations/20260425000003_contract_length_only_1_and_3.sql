-- ---------------------------------------------------------------------
-- Contract Length: drop 2 Year, relabel to "1 Year Contract" / "3 Year Contract"
-- ---------------------------------------------------------------------
-- Medcurity only sells 1-year or 3-year contracts. Hide the seeded
-- 2-year option (delete entirely — no historical data uses it yet)
-- and rename the remaining ones so the dropdown is unambiguous.
--
-- Idempotent. Safe to re-run.

begin;

delete from public.picklist_options
 where field_key = 'opportunities.contract_length_months'
   and value = '24';

update public.picklist_options
   set label = '1 Year Contract'
 where field_key = 'opportunities.contract_length_months'
   and value = '12';

update public.picklist_options
   set label = '3 Year Contract'
 where field_key = 'opportunities.contract_length_months'
   and value = '36';

commit;
