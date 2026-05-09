-- Re-seed opportunities.contract_year picklist.
--
-- Year 2 went missing on staging (likely deleted via the Picklists
-- Manager UI). The original seed in 20260425000002_picklist_options.sql
-- already had all three values, but `on conflict (field_key, value) do
-- nothing` won't re-create a row that was deleted later. Use a plain
-- upsert here so any of the three can be restored without disturbing
-- other picklist edits.

insert into public.picklist_options (field_key, value, label, sort_order, is_active)
values
  ('opportunities.contract_year', '1', 'Year 1', 10, true),
  ('opportunities.contract_year', '2', 'Year 2', 20, true),
  ('opportunities.contract_year', '3', 'Year 3', 30, true)
on conflict (field_key, value) do update
  set label      = excluded.label,
      sort_order = excluded.sort_order,
      is_active  = true;
