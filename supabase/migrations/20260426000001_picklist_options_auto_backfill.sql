-- ---------------------------------------------------------------------
-- NO-OP: superseded by 20260426000004_picklist_seeds_only.sql
-- ---------------------------------------------------------------------
-- The original auto-backfill CTE here failed on enum columns when
-- comparing to an empty string ('rating <> '''). Cleared so the
-- migration system can mark it applied and move past it. The
-- canonical seed values now come from 20260426000004.
select 1;
