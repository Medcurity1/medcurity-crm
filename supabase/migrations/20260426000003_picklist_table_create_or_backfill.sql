-- ---------------------------------------------------------------------
-- NO-OP: superseded by 20260426000004_picklist_seeds_only.sql
-- ---------------------------------------------------------------------
-- Same enum-vs-empty-string bug as 20260426000001. Cleared so the
-- migration system can mark it applied and move past it. The CREATE
-- TABLE that was here is also in 20260426000004 as CREATE TABLE IF
-- NOT EXISTS, so nothing is lost.
select 1;
