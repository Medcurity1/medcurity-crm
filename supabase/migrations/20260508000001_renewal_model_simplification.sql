-- Phase: Renewal-model simplification.
--
-- Problem context (post-SF-cutover):
--   * The SF org used a 5-value renewal_type picklist
--     (full_auto_renew, auto_renew, platform_only_auto_renew, manual_renew,
--     no_auto_renew). The middle ground ("platform-only auto-renews but not
--     services") muddied every downstream calculation — the renewal
--     automation just hard-skipped no_auto_renew accounts, which left them
--     out of the pipeline entirely instead of flagging them for early
--     reach-out, and the platform-only variants were treated like full
--     auto-renew (wrong — they still need a fresh signature for the
--     services portion).
--   * Decision: collapse to a yes/no `auto_renew` boolean. Mid-ground
--     accounts (platform_only_auto_renew and manual_renew) become
--     auto_renew=false; sales should add full auto-renew verbiage at the
--     next contract cycle. We keep `renewal_type` populated for backward
--     compat with reports/UI that still reference it, but the new
--     automation reads `auto_renew`.
--
-- New behavior of the renewal automation (implemented in a follow-up
-- migration):
--   * 30-day pull-back if auto_renew = true OR if we're inside a 3-year
--     cycle (Year 1→2 or Year 2→3) — the customer is committed and a
--     new signature isn't required for the internal billing event.
--   * 60-day pull-back if auto_renew = false AND a fresh signature is
--     needed (1-year contract, OR the wrap year of a 3-year cycle).
--   * In either case the renewal is generated; we don't silently skip
--     no-auto-renew accounts anymore.
--
-- Data preservation guarantees:
--   * No DROP COLUMN. `renewal_type` stays.
--   * No DELETE / TRUNCATE. We only INSERT/UPDATE additive data.
--   * Backfill of `auto_renew` only fills NULL rows. Anyone who manually
--     set auto_renew before this migration runs is left untouched.
--   * Existing cycle_count values are not modified. Going forward the
--     renewal automation only writes cycle_count for 36-month contracts;
--     1-year contracts get cycle_count = NULL. Historical 1-year cycle
--     counts stay as-is (deliberate; reports filtering on cycle_count
--     should also filter on contract_length_months = 36).

begin;

-- -------------------------------------------------------------------
-- 1. accounts.auto_renew (yes/no replacement for renewal_type)
--    accounts.auto_renew_term_months (optional override for 3yr→? wrap)
-- -------------------------------------------------------------------
alter table public.accounts
  add column if not exists auto_renew boolean,
  add column if not exists auto_renew_term_months integer
    check (auto_renew_term_months is null or auto_renew_term_months > 0);

comment on column public.accounts.auto_renew is
  'Yes/no flag replacing the multi-value renewal_type. Drives the renewal automation pull-back: 30d when true, 60d when a new signature is required. Mid-ground renewal_type values (platform_only_auto_renew, manual_renew) map to false. NULL = unknown — appears in admin "needs review" list.';

comment on column public.accounts.auto_renew_term_months is
  'Optional term length applied when a 3-year contract auto-renews and wraps from Year 3 → Year 1. NULL (default) = use the parent opps original contract_length_months (36 stays 36). Set to 12 for accounts whose contract auto-renews into successive 1-year terms after the initial 3-year period.';

-- Backfill auto_renew from existing renewal_type values, but ONLY for
-- rows where auto_renew is still NULL (so we never clobber a manually
-- set value).
update public.accounts
set auto_renew = case
  when renewal_type::text in ('full_auto_renew', 'auto_renew') then true
  when renewal_type::text in ('platform_only_auto_renew', 'manual_renew', 'no_auto_renew') then false
  else null
end
where auto_renew is null
  and renewal_type is not null;

-- -------------------------------------------------------------------
-- 2. opportunities.requires_new_signature
--    Auto-set by the renewal automation when generating a child renewal
--    that needs a fresh signature. Editable so sales can clear it once
--    the signature is in hand. Default false so existing rows aren't
--    misrepresented retroactively.
-- -------------------------------------------------------------------
alter table public.opportunities
  add column if not exists requires_new_signature boolean not null default false;

comment on column public.opportunities.requires_new_signature is
  'TRUE when this renewal opportunity needs a fresh customer signature: account.auto_renew = false AND either (a) contract_length_months = 12, or (b) this is the Year 3 → Year 1 wrap of a 3-year cycle. Triggers the 60-day pull-back instead of 30-day. Set automatically by generate_upcoming_renewals; sales can clear it once the signature is secured.';

create index if not exists idx_opportunities_requires_new_signature
  on public.opportunities (requires_new_signature)
  where requires_new_signature = true;

-- -------------------------------------------------------------------
-- 3. renewal_automation_config: split pull-back into two values
--    so admins can tune them independently.
-- -------------------------------------------------------------------
alter table public.renewal_automation_config
  add column if not exists pullback_days_auto_renew integer not null default 30
    check (pullback_days_auto_renew between 0 and 180),
  add column if not exists pullback_days_signature_required integer not null default 60
    check (pullback_days_signature_required between 0 and 180);

comment on column public.renewal_automation_config.pullback_days_auto_renew is
  'Days before parent.contract_end_date that the new renewals expected_close_date is set to, when the account auto-renews (no new signature needed). Default 30.';

comment on column public.renewal_automation_config.pullback_days_signature_required is
  'Days before parent.contract_end_date that the new renewals expected_close_date is set to, when a new signature is required (auto_renew=false on a 1-year contract, OR the wrap year of a 3-year cycle). Default 60 — gives sales 2 months runway to resign.';

commit;
