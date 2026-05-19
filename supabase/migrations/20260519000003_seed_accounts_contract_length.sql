-- Seed picklist for accounts.current_contract_length_months.
--
-- The opportunities-side equivalent
-- (opportunities.contract_length_months) was already converted to a
-- picklist with two options: "1 Year Contract" (value 12) and "3 Year
-- Contract" (value 36). The Account-level field that mirrors the
-- currently-held contract length was still a free-form number input,
-- which let sales reps type any value (e.g. 24, 18) that doesn't map
-- to a real Medcurity contract term and forced them to think in
-- months.
--
-- This migration seeds the same two canonical options on the
-- account-level field so the AccountForm can render a PicklistSelect
-- instead of a numeric input.
--
-- Idempotent: uses upsert-style logic via ON CONFLICT against the
-- (field_key, value) unique key.
--
-- Data-preservation: existing numeric values on accounts
-- (current_contract_length_months) are NOT modified. The new
-- PicklistSelect renders any non-canonical value as "(legacy)" so the
-- user can see what's stored and pick a canonical replacement when
-- they're ready.

begin;

insert into public.picklist_options (field_key, value, label, sort_order, is_active)
values
  ('accounts.current_contract_length_months', '12', '1 Year Contract', 10, true),
  ('accounts.current_contract_length_months', '36', '3 Year Contract', 20, true)
on conflict (field_key, value) do update
  set label = excluded.label,
      sort_order = excluded.sort_order,
      is_active = excluded.is_active;

commit;
