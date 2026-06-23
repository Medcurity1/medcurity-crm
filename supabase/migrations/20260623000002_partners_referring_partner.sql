-- ============================================================
-- Partners audit fixes (SQL, part 2)
-- ----------------------------------------------------------------
--   - accounts.referring_partner: the SF importer mapped BOTH
--     "Partner Account" and "Referring Partner" to partner_account,
--     so whichever column appeared later in the file silently
--     overwrote the other. Give Referring Partner its own home.
--   - Correct the stale account_partners.role comment (it claims the
--     Role field was dropped from the UI, but it's live on the
--     account Partners tab).
-- ============================================================

begin;

alter table public.accounts add column if not exists referring_partner text;
comment on column public.accounts.referring_partner is
  'Legacy SF Referring_Partner text. Distinct from partner_account so the SF importer no longer collapses the two into one column.';

comment on column public.account_partners.role is
  'Optional free-text role for the relationship (Reseller, Co-marketing, etc.). Shown + editable on the account Partners tab.';

commit;

notify pgrst, 'reload schema';
