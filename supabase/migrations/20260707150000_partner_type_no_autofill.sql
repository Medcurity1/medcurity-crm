-- ---------------------------------------------------------------------
-- Partner Type: remove the auto-backfill (Rachel's decision, 2026-07-07).
--
-- The original 20260707140000 pre-tagged the 36 former 'Partner - Alliance'
-- accounts as 'Technology' (recovered from audit_logs). Rachel confirmed
-- those 36 aren't all the same partner type, so nobody should be auto-set —
-- every partner starts untyped and a human picks the type (the account form
-- requires it whenever a partner is edited or created).
--
-- 20260707140000 has been edited to drop the backfill, so PROD (which runs
-- the edited version) never tags anyone and this is a no-op there. STAGING
-- already ran the original, so this clears its 36 backfilled rows. Safe to
-- match on value: the backfill was the only writer of 'Technology' — the
-- field shipped hours ago and no human has set 'Technology' manually
-- (staging's single manual test set 'Referral').
-- ---------------------------------------------------------------------

begin;

update public.accounts
   set partner_type = null
 where partner_type = 'Technology';

commit;

notify pgrst, 'reload schema';
