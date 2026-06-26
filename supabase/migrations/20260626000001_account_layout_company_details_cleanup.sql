-- ---------------------------------------------------------------------
-- Account detail layout: dissolve the "Company Details" section (Summer).
--
-- Mirrors the AccountForm change so the detail page matches the edit form:
--   - move Number of Employees + FTE Range into Basic Information
--   - move Timezone into Address Information
--   - drop FTE Count / Number of Providers / Number of Locations / Annual
--     Revenue from the layout (the COLUMNS and their data are untouched —
--     they're just no longer displayed or editable on the page)
--   - remove the now-empty Company Details section
--
-- Operates by field_key within the accounts 'standard' layout, so it's robust
-- to where each field currently sits, and idempotent: the moves are guarded to
-- skip fields already in the target section, and the deletes no-op once gone.
-- Other (admin-created) layouts are left untouched.
-- ---------------------------------------------------------------------

begin;

do $$
declare
  v_layout_id   uuid;
  v_basic_id    uuid;
  v_address_id  uuid;
  v_company_id  uuid;
  v_base_basic  int;
begin
  select id into v_layout_id
    from public.page_layouts
    where entity = 'accounts' and name = 'standard';
  if v_layout_id is null then
    return; -- no standard accounts layout; nothing to do
  end if;

  select id into v_basic_id   from public.page_layout_sections where layout_id = v_layout_id and title = 'Basic Information';
  select id into v_address_id from public.page_layout_sections where layout_id = v_layout_id and title = 'Address Information';
  select id into v_company_id from public.page_layout_sections where layout_id = v_layout_id and title = 'Company Details';

  -- Move Number of Employees + FTE Range into Basic Information (appended after
  -- whatever is already there). Guarded so a re-run doesn't keep shifting them.
  if v_basic_id is not null then
    select coalesce(max(sort_order), 0) into v_base_basic
      from public.page_layout_fields where section_id = v_basic_id;

    update public.page_layout_fields f
      set section_id = v_basic_id, sort_order = v_base_basic + 1, width = 'half'
      where f.field_key = 'employees'
        and f.section_id in (select id from public.page_layout_sections where layout_id = v_layout_id)
        and f.section_id <> v_basic_id;

    update public.page_layout_fields f
      set section_id = v_basic_id, sort_order = v_base_basic + 2, width = 'half'
      where f.field_key = 'fte_range'
        and f.section_id in (select id from public.page_layout_sections where layout_id = v_layout_id)
        and f.section_id <> v_basic_id;
  end if;

  -- Move Timezone into Address Information (after the address blocks).
  if v_address_id is not null then
    update public.page_layout_fields f
      set section_id = v_address_id,
          sort_order = coalesce((select max(sort_order) from public.page_layout_fields where section_id = v_address_id), 0) + 1,
          width = 'half'
      where f.field_key = 'timezone'
        and f.section_id in (select id from public.page_layout_sections where layout_id = v_layout_id)
        and f.section_id <> v_address_id;
  end if;

  -- Drop the four fields Summer doesn't want shown (columns/data untouched).
  delete from public.page_layout_fields
    where field_key in ('fte_count', 'number_of_providers', 'locations', 'annual_revenue')
      and section_id in (select id from public.page_layout_sections where layout_id = v_layout_id);

  -- Remove the Company Details section once it has no fields left.
  if v_company_id is not null then
    delete from public.page_layout_sections s
      where s.id = v_company_id
        and not exists (select 1 from public.page_layout_fields f where f.section_id = s.id);
  end if;
end $$;

commit;
