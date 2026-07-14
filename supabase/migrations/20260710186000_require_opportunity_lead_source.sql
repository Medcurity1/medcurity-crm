-- ============================================================
-- Joe (2026-07-10, high priority): Lead Source must be required when an
-- opportunity is created.
--
-- The OpportunityForm already reads required_field_config for entity
-- 'opportunities' (useRequiredFields) and enforces it via
-- getMissingRequiredFields, with the RequiredIndicator on the Lead
-- Source label already wired (OpportunityForm.tsx:1397). So this is a
-- pure config flip — no code change.
--
-- Grandfather rule (src/lib/requiredFields.ts): CREATE enforces it;
-- EDIT only blocks if a previously-set Lead Source is being cleared. So
-- existing opportunities with no Lead Source stay editable — only NEW
-- opps must have one. (The form also auto-fills Lead Source from the
-- account when the account has one, OpportunityForm.tsx:370, so most
-- creates satisfy it automatically.)
--
-- Idempotent: upsert to is_required=true on the (entity, field_key) key.
-- ============================================================

begin;

insert into public.required_field_config (entity, field_key, is_required)
values ('opportunities', 'lead_source', true)
on conflict (entity, field_key) do update set is_required = true;

commit;
