-- ============================================================
-- Rachel (2026-07-15): "Assigned Assessor" should be required when an
-- opportunity has services — and not required when it doesn't.
--
-- Two config rows, both individually toggleable in Admin → Required Fields:
--
--   1. ('opportunities', 'assigned_assessor_id') — the opportunity FORM
--      enforces it on create/edit, but ONLY when the deal includes services
--      (a service-family line item, a service amount, or the "Services
--      Included" flag — the same signals recalc_opportunity_amount uses).
--      The conditional logic lives in OpportunityForm.tsx because
--      required_field_config is a flat per-field flag. Grandfather rule
--      applies: old service deals already missing an assessor stay
--      editable; only clearing a previously-set assessor is blocked.
--
--   2. ('opportunity_close', 'assigned_assessor') — the Closed Won gate
--      (src/lib/closeReadiness.ts): a deal that includes services can't
--      move INTO closed_won without an assessor, from ANY surface (form,
--      pipeline drag, inline list edit, detail page). This is the safety
--      net for services attached after the deal was created.
--
-- Client-side enforcement only, like the rest of the close gate — no DB
-- trigger, so bulk imports and the renewal automation are never blocked.
-- (The renewal generator already copies assigned_assessor_id from the
-- parent deal, so auto-renewals arrive with an assessor.)
--
-- Idempotent: upsert on the (entity, field_key) key.
-- ============================================================

begin;

insert into public.required_field_config (entity, field_key, is_required)
values
  ('opportunities', 'assigned_assessor_id', true),
  ('opportunity_close', 'assigned_assessor', true)
on conflict (entity, field_key) do update set is_required = true;

commit;
