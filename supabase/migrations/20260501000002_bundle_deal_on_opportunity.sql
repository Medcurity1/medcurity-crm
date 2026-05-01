-- Move the bundle-deal flag from opportunity_products to opportunities.
--
-- 20260501000001 added is_bundle_adjustment per line, on the theory that
-- the discount mechanic lives on the line so the tag should too. In
-- practice the flag describes the *deal*, not any one line — reps think
-- "this whole proposal is a bundle" and put the adjustment on a single
-- line by convention. Tagging at the opp level matches that mental
-- model, makes the UX one checkbox instead of N, and simplifies any
-- future "exclude bundle deals from promo discount totals" reporting
-- (single join, no per-line aggregation).
--
-- Default false. The earlier per-line column was deployed for ~minutes
-- before this swap, so any data on it is throwaway-safe to drop.

begin;

alter table public.opportunity_products
  drop column if exists is_bundle_adjustment;

alter table public.opportunities
  add column if not exists is_bundle_deal boolean not null default false;

comment on column public.opportunities.is_bundle_deal is
  'True when this opportunity was sold as a bundle/flat-rate deal — i.e. any per-line discount on it exists to back into a target total, not as a promotional markdown. Reports use this to keep promo-discount totals from being inflated by bundle pricing.';

commit;
