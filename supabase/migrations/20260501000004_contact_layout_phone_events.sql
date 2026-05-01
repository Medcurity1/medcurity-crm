-- 20260501000004_contact_layout_phone_events.sql
--
-- Surface mobile_phone and events_attended on the Contact detail page.
--
-- The columns already exist on public.contacts (mobile_phone added in
-- 20260424000001_standard_report_views.sql, events_attended added in
-- 20260417000001_phase1_schema_additions.sql) but they aren't placed
-- in the standard contact page_layout, so they don't render on Contact
-- detail. This migration inserts them into the existing "Contact
-- Details" section idempotently:
--
--   - mobile_phone: half-width, sorted right after phone_ext
--   - events_attended: full-width, sorted at the end
--
-- Safe to re-run: every insert is gated on a NOT EXISTS check.

begin;

do $$
declare
  v_layout_id  uuid;
  v_section_id uuid;
  v_max_sort   integer;
begin
  select id into v_layout_id
    from public.page_layouts
   where entity = 'contacts' and name = 'standard';

  if v_layout_id is null then
    raise notice 'No standard contact layout found — skipping (will be picked up by the seed when it runs).';
    return;
  end if;

  -- Find the "Contact Details" section
  select id into v_section_id
    from public.page_layout_sections
   where layout_id = v_layout_id
     and title = 'Contact Details';

  if v_section_id is null then
    raise notice 'No Contact Details section found on contact layout — skipping.';
    return;
  end if;

  -- mobile_phone — slot in right after phone_ext (sort_order 6 in seed)
  if not exists (
    select 1 from public.page_layout_fields
     where section_id = v_section_id and field_key = 'mobile_phone'
  ) then
    -- Bump everything at or above 7 to make room
    update public.page_layout_fields
       set sort_order = sort_order + 1
     where section_id = v_section_id
       and sort_order >= 7;

    insert into public.page_layout_fields (section_id, field_key, sort_order, width)
    values (v_section_id, 'mobile_phone', 7, 'half');
  end if;

  -- events_attended — append to the end of the section as a full-width row
  if not exists (
    select 1 from public.page_layout_fields
     where section_id = v_section_id and field_key = 'events_attended'
  ) then
    select coalesce(max(sort_order), 0) into v_max_sort
      from public.page_layout_fields
     where section_id = v_section_id;

    insert into public.page_layout_fields (section_id, field_key, sort_order, width)
    values (v_section_id, 'events_attended', v_max_sort + 1, 'full');
  end if;
end $$;

commit;
