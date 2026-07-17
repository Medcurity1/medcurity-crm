-- ---------------------------------------------------------------------
-- Summer (2026-07-16): show contact Notes just below the key-info tiles
-- instead of buried at the bottom. The card itself is code
-- (ContactDetail.tsx); this migration removes the now-duplicate `notes`
-- row from the contacts layout's collapsed "Notes & Next Steps" section
-- and retitles it "Next Steps" (its one remaining field). Idempotent:
-- re-running deletes nothing new and the title update is a no-op.
-- ---------------------------------------------------------------------

begin;

delete from public.page_layout_fields f
using public.page_layout_sections s, public.page_layouts l
where f.section_id = s.id
  and s.layout_id = l.id
  and l.entity = 'contacts'
  and s.title in ('Notes & Next Steps', 'Next Steps')
  and f.field_key = 'notes';

update public.page_layout_sections s
set title = 'Next Steps'
from public.page_layouts l
where s.layout_id = l.id
  and l.entity = 'contacts'
  and s.title = 'Notes & Next Steps';

commit;
