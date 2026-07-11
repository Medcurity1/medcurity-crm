-- ---------------------------------------------------------------------
-- One-time cleanup: clear the Deal Merger play-test runs from the ledger
-- so the all-time top 5 starts clean for the team (Nathan OK'd wiping the
-- verification scores, 2026-07-11). On prod this is a no-op: the table is
-- created empty by 20260711000000 in the same deploy.
-- ---------------------------------------------------------------------

begin;

delete from public.deal_merger_scores;

commit;
