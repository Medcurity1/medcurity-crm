-- ---------------------------------------------------------------------
-- Summer (2026-07-16): retire the account detail page's bottom
-- "Partner Information" layout section. 80% of accounts aren't partners,
-- so it was pure noise. Where things went:
--   * partnership_status / partner_type / relationship_notes → shown in
--     the Partner tab for partner-typed accounts (code,
--     AccountDetail.tsx) and edited under the Partner checkbox in the
--     account form (code, AccountForm.tsx).
--   * lead_source / lead_source_detail → moved into the "Additional
--     Information" layout section (attribution is account-general).
--   * partner_account / partner_prospect → no longer displayed anywhere;
--     COLUMNS AND DATA ARE UNTOUCHED (legacy SF values remain queryable
--     and the SF importer still writes them).
-- Idempotent: safe to re-run; skips anything already moved/removed.
-- ---------------------------------------------------------------------

begin;

-- 1. Move lead_source + lead_source_detail into Additional Information.
do $$
declare
  v_layout_id uuid;
  v_addl_section_id uuid;
begin
  select id into v_layout_id from public.page_layouts
    where entity = 'accounts' and name = 'standard';
  if v_layout_id is null then return; end if;

  select id into v_addl_section_id from public.page_layout_sections
    where layout_id = v_layout_id and title = 'Additional Information'
    order by sort_order limit 1;
  if v_addl_section_id is null then return; end if;

  insert into public.page_layout_fields (section_id, field_key, sort_order, width)
  select v_addl_section_id, f.key, f.sort, 'half'
  from (values ('lead_source', 6), ('lead_source_detail', 7)) as f(key, sort)
  where not exists (
    select 1 from public.page_layout_fields pf
    where pf.section_id = v_addl_section_id and pf.field_key = f.key
  );
end $$;

-- 2. Remove the Partner Information section and all its field rows.
delete from public.page_layout_fields f
using public.page_layout_sections s, public.page_layouts l
where f.section_id = s.id
  and s.layout_id = l.id
  and l.entity = 'accounts'
  and s.title = 'Partner Information';

delete from public.page_layout_sections s
using public.page_layouts l
where s.layout_id = l.id
  and l.entity = 'accounts'
  and s.title = 'Partner Information';

commit;
