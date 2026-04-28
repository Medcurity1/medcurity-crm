-- Backfill: any opportunity with kind='renewal' but team='sales' should
-- live in the Renewals pipeline bucket. Brayden reported the pipeline
-- showed all opps in Sales — this is the cause: SF-imported renewals
-- and manually-created kind='renewal' opps were stuck on the default
-- team='sales'.
--
-- Conservative: only fix the case where kind is unambiguously 'renewal'.
-- We don't auto-flip team='renewals' → team='sales' because that's
-- where new manual deals start by default.
--
-- Idempotent: subsequent runs are no-ops.

update public.opportunities
   set team = 'renewals',
       updated_at = timezone('utc', now())
 where kind = 'renewal'
   and team = 'sales';
