-- Add assigned_assessor_id and original_sales_rep_id to opportunities.
--
-- assigned_assessor_id: Who is performing the assessment (SRA/NVA services).
--   Only relevant when services are included. Defaults to null.
--
-- original_sales_rep_id: Preserves the sales rep who originally sold/owned
--   the opportunity before it was handed off to the renewals team.
--   When the renewal automation creates a new opp, it stores the parent's
--   owner as original_sales_rep_id and assigns owner_user_id to the
--   renewals team member.

alter table public.opportunities
  add column if not exists assigned_assessor_id uuid references public.user_profiles(id) on delete set null,
  add column if not exists original_sales_rep_id uuid references public.user_profiles(id) on delete set null;

comment on column public.opportunities.assigned_assessor_id is
  'User performing the SRA/NVA assessment. Only relevant for service opportunities.';

comment on column public.opportunities.original_sales_rep_id is
  'The sales rep who originally owned this opportunity before handoff to renewals. Preserved for attribution.';

-- Backfill: for existing renewal opps that were auto-generated,
-- store the current owner as original_sales_rep_id (best guess)
update public.opportunities
set original_sales_rep_id = owner_user_id
where kind = 'renewal'
  and original_sales_rep_id is null
  and renewal_from_opportunity_id is not null;
