# Morning status — 2026-04-24

Quick read for Brayden when you wake up.

## Branch

`reports-and-renewal-qa` off `Staging`. Push will land via Azure to
`staging.crm.medcurity.com`. PR back into `Staging` when you're happy.
Once Staging is verified, merge to `main` for prod.

## What I changed tonight

Three focused, low-risk fixes:

1. **Dashboard "My Open Opportunities" → View All** now routes to
   `/opportunities?owner=mine` instead of the unfiltered list. The list
   page already supported the `owner=mine` URL param — this just wires
   the link.
   - File: `src/features/dashboard/HomePage.tsx:348`

2. **Renewals Queue CSV export** now matches the SF "Open Renewal
   Opportunities" report shape, so existing pivot tables / Excel
   templates downstream keep working. New columns:
   `Close Month, Opportunity Owner, Account Name, Opportunity Name,
   Close Date, Maturity Date, Amount, Renewal Type, Next Step`.
   Also added `next_step` to the underlying query so it's available.
   - File: `src/features/reports/standard/RenewalsQueue.tsx`

3. **Active Pipeline widened to "open" definition.** The previous
   `ACTIVE_STAGES` list only covered the 4 mid-stage probability
   buckets (Details Analysis → Proposal Conversation). Now includes
   `lead`, `qualified`, `proposal`, `verbal_commit` so the report
   matches the SF "Open Opportunities" definition: any opp not Closed
   Won and not Closed Lost.

   Also rewrote the CSV export to be **per-opportunity rows** instead
   of by-stage summary — the SF report is row-level, and your
   downstream consumers expect that shape.
   - File: `src/features/reports/standard/ActivePipeline.tsx`

## What I diagnosed but did NOT change (with reasons)

### Custom report builder — multi-entity support

**It already exists.** `src/features/reports/ReportBuilder.tsx` is
1876 lines, with full column/filter/sort/save infrastructure. xlsx
export is wired (`import * as XLSX from "xlsx"`). 6 entities are
defined in `src/features/reports/report-config.ts`: accounts,
contacts, opportunities, activities, opportunity_products, leads.
Each with ~25-40 columns and matching filterable fields.

**What it doesn't do:** true cross-entity reports like "Accounts WITH
their opps as flat rows" (one row per opp, with parent account fields
denormalized) or "Accounts grouped by metric across opps"
(aggregation: count of opps per account, sum of ARR per account,
latest contract end per account).

**Why I didn't build it tonight:** this is genuinely a multi-day
design task. Adding a "join entity" picker + flatten/aggregate mode
toggle + new query compilation path (the current `runReportQuery` in
`report-api.ts:269` assumes single-entity) would mean either:
- Extending `ReportConfig` with `joins[]` (additive, safer) and
  building a flatten/agg compiler. This is ~500-800 LOC of careful
  work.
- OR introducing a separate "joined report" code path that runs two
  queries and stitches client-side. Simpler but still 200-300 LOC.

I wasn't going to fake-ship this overnight. Worth a real design pass
when you're awake. **My recommendation:** start with a "linked entity
columns" feature on the existing builder — let users add columns from
a related entity and the builder embeds them as joins. That covers
80% of the use case and matches what most SF users actually do.

### Renewal automation — `contract_year` / `contract_length` blanks

**Not a code bug.** The generator
(`supabase/migrations/20260416000002_renewal_automation_enhancements.sql:131-201`)
correctly copies `contract_length_months`, `contract_year`, and
increments `cycle_count` from the parent. Verified at lines 184-186.

**The blanks are upstream data quality.** When the SF importer pulled
the parent opps, those columns were either not mapped or the SF
source field was empty. The generator copies blank → blank.
`cycle_count` shows up because it's COMPUTED at generation time,
not copied.

**To fix:** during tomorrow's prod re-import, make sure the SF columns
`Contract_Length__c` and `Contract_Year__c` are mapped in the in-app
importer. After the import, a backfill SQL can fix existing renewals
generated from incomplete parents:

```sql
-- Run after the import on prod to backfill auto-generated renewals
-- whose parent opp had contract_length_months / contract_year populated
-- AFTER the renewal was generated.
update public.opportunities child
set
  contract_length_months = parent.contract_length_months,
  contract_year = parent.contract_year
from public.opportunities parent
where child.renewal_from_opportunity_id = parent.id
  and child.kind = 'renewal'
  and (child.contract_length_months is null or child.contract_year is null)
  and (parent.contract_length_months is not null or parent.contract_year is not null);
```

### James → Brayden owner remap — already handled

`SalesforceImport.tsx:1959` maps SF user ID `0055w00000BmnpKAAR`
(James in SF) to Brayden's CRM profile. All opps owned by James in
SF land with `owner_user_id = Brayden's UUID` in the new CRM. So
existing reports already show "Brayden Frost" as the owner.

The only place "James Parrish" still appears is in `sf_created_by` /
`sf_last_modified_by` audit fields — that's intentional
(`SalesforceImport.tsx:3160-3162`) so audit history stays accurate.

**Verification step for tomorrow:** after prod import, run on prod SQL:
```sql
select owner_user_id, count(*)
from public.opportunities
where archived_at is null
group by owner_user_id
order by count(*) desc;
```
Every owner_user_id should map to a valid `user_profiles.id`. None
should be null on Won/active opps.

### Standard reports — tables already render

I checked all four standard reports
(`RenewalsQueue`, `ActivePipeline`, `ArrRolling365`, `MqlSqlCounts`).
All four render data tables alongside the charts, all four have
working CSV export buttons. If you're seeing "graphs only" — hard-
refresh the browser; might be a cached bundle.

## Things I explicitly did NOT touch tonight

- **Multi-entity custom report builder** — see notes above
- **Comprehensive SF field QA** — multi-day audit, see
  `docs/migration/gap-analysis.md` (already exists)
- **Comprehensive feature QA / clickability sweep** — write a
  checklist with you tomorrow
- **Outlook on prod** — explicitly held for tomorrow morning together

## What you should do in the morning

1. **Verify the View All filter** loads correctly on staging
   (`staging.crm.medcurity.com/opportunities?owner=mine` should show
   only your opps with the filter chip set)
2. **Verify the new CSV exports** by clicking Export on Renewals Queue
   and Active Pipeline reports — confirm columns match what your
   downstream Excel templates expect
3. **Verify Active Pipeline** now includes Lead and Qualified stages
   (it should now show MORE rows than it did)
4. **Approve PR** from `reports-and-renewal-qa` → `Staging` if happy
5. **Decide P0 priorities** for what gets built next:
   - Multi-entity report builder (real design pass needed)
   - Custom field admin UI
   - Outlook prod sync
   - Anything else from your overnight list

## Re: tomorrow's SF re-export + import

Same path that worked on staging. From the in-app `SalesforceImport`
admin tab, run order:

1. Users (already done by you in the CRM admin UI tonight)
2. Accounts → Contacts → Leads → Products → Price Books →
   Opportunities → Opportunity Line Items → Partners
3. After all entities are in:
   - `node scripts/migration/import-tasks.mjs <Task.csv>` (with prod
     `SUPABASE_SERVICE_ROLE_KEY`)
   - `node scripts/migration/backfill-sf-audit-fields.mjs` to populate
     created_at / updated_at properly
   - `node scripts/migration/import-partner-relationships.mjs` if the
     Partner CSV has the join data
4. Run the renewal contract_length backfill SQL above
5. Manually trigger the renewal automation:
   ```sql
   select * from public.run_renewal_automation_now();
   ```
6. Verify generated renewals have `contract_length_months`,
   `contract_year`, `cycle_count` populated

## Files changed tonight

```
src/features/dashboard/HomePage.tsx                       (1 line)
src/features/reports/standard/RenewalsQueue.tsx           (~25 lines)
src/features/reports/standard/ActivePipeline.tsx          (~30 lines)
docs/migration/MORNING_STATUS_2026-04-24.md               (this file)
```

Total: ~60 lines of focused change. Nothing structural, nothing risky.
