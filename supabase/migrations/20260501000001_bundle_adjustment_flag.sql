-- Tag line-item discounts that exist purely to back into a flat-rate
-- bundle price (e.g. SRA module + SRA services sold as a single
-- "$X for SRA done" deal where the rep can't touch unit price, so the
-- adjustment lands as a flat-$ discount on the product line).
--
-- This is NOT a promo/markdown discount. Conflating the two would skew
-- any future "total discount given this quarter" metric. By tagging at
-- save time, future reports can split bundle adjustments out cleanly
-- without needing to back-classify history with a heuristic.
--
-- Default false so all existing rows are treated as regular discounts;
-- users mark new bundle deals via a checkbox in the line editor.

begin;

alter table public.opportunity_products
  add column if not exists is_bundle_adjustment boolean not null default false;

comment on column public.opportunity_products.is_bundle_adjustment is
  'True when this line''s discount is a bundle/flat-rate adjustment rather than a promotional discount. Set by the rep at save time. Used by reporting to keep promo-discount totals from being inflated by bundle pricing.';

commit;
