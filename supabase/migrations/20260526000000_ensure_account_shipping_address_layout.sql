-- Ensure the standard Account layout has the shipping address block.
-- The original seed (20260426000008) included `__shipping_address`,
-- but at least one staging DB is missing the row — the detail page
-- renders billing only and the rep can no longer see shipping without
-- opening the edit form. Idempotent: do nothing if it already exists.

begin;

do $$
declare
  v_section_id uuid;
  v_next_sort  integer;
begin
  -- Find the Address Information section of the standard Account layout
  select s.id
    into v_section_id
  from public.page_layout_sections s
  join public.page_layouts l on l.id = s.layout_id
  where l.entity = 'accounts'
    and l.name = 'standard'
    and s.title = 'Address Information'
  limit 1;

  if v_section_id is null then
    raise notice 'Address Information section not found for accounts/standard — skipping';
    return;
  end if;

  -- Already there?
  if exists (
    select 1 from public.page_layout_fields
    where section_id = v_section_id
      and field_key = '__shipping_address'
  ) then
    return;
  end if;

  -- Place it right after the billing block (or at the end if billing
  -- isn't there for some reason).
  select coalesce(max(sort_order), 0) + 1
    into v_next_sort
  from public.page_layout_fields
  where section_id = v_section_id;

  insert into public.page_layout_fields
    (section_id, field_key, sort_order, width)
  values
    (v_section_id, '__shipping_address', v_next_sort, 'full');
end;
$$;

commit;
