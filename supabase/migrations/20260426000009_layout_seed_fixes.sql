-- ---------------------------------------------------------------------
-- Layout seed fixes
--   1. Remove "System Information" + "Salesforce History" sections from
--      every entity's layout seed. The Detail pages render their own
--      versions of these (with audit-log links the layout-driven view
--      can't reproduce), so the seeded copies were duplicating.
--   2. Flip opportunities.amount + subtotal `read_only_on_form` to false.
--      User wants amount editable on the form even though it auto-calcs
--      from line items — for manual corrections / no-line-item opps.
--
-- Idempotent: only runs deletions/updates if rows exist.
-- ---------------------------------------------------------------------

begin;

-- 1. Drop duplicate "System Information" + "Salesforce History" sections
delete from public.page_layout_sections
 where title in ('System Information', 'Salesforce History');

-- 2. Make amount + subtotal editable on opportunity form
update public.page_layout_fields
   set read_only_on_form = false,
       help_text = case
         when field_key = 'amount'
           then 'Auto-calculated from product line items minus discount; editable for manual corrections.'
         when field_key = 'subtotal'
           then 'Auto-calculated sum of product line items; editable for manual corrections.'
         else help_text
       end
 where field_key in ('amount', 'subtotal')
   and section_id in (
     select s.id from public.page_layout_sections s
     join public.page_layouts l on l.id = s.layout_id
     where l.entity = 'opportunities'
   );

commit;
