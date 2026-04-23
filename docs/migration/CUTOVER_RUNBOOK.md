# Production Cutover Runbook — Friday Go-Live

Everything needed to reproduce the staging migration against the **production**
Supabase project and the **`main`** Azure Static Web App deploy (`white-flower`).

**Prereqs — collect before starting:**
- [ ] Production Supabase **URL** (different from staging)
- [ ] Production Supabase **service_role key** (Dashboard → Project Settings → API → `service_role`, NOT `anon`)
- [ ] Production Supabase **project ref** (from the dashboard URL)
- [ ] `SUPABASE_ACCESS_TOKEN` for the CLI (same one works across projects)
- [ ] Fresh SF exports (see Phase 0 below)
- [ ] 1–2 hour uninterrupted window — the data load itself is ~15 min but verification takes real time

**Environment:**
- Staging SWA = `ambitious-grass-0ad59c510.2.azurestaticapps.net` = branch `Staging`
- **Prod SWA** = `white-flower-0f9685910.azurestaticapps.net` = branch `main`
- Staging Supabase and Prod Supabase are separate projects.

---

## Phase 0 — Fresh SF exports (do this morning of)

Re-export from SF so you capture any records created since the last staging import.

From Workbench (`workbench.developerforce.com`):

| CSV | SOQL | Notes |
|---|---|---|
| `Account.csv` | `SELECT * FROM Account` | Use Data Loader for this one, Workbench struggles with wide queries |
| `Contact.csv` | `SELECT * FROM Contact` | |
| `Lead.csv` | `SELECT * FROM Lead` | 42k+ rows — use Bulk API |
| `Opportunity.csv` | `SELECT * FROM Opportunity` | |
| `OpportunityLineItem.csv` | `SELECT * FROM OpportunityLineItem` | |
| `Product2.csv` | `SELECT * FROM Product2` | Raw 155-row file |
| `Pricebook2.csv` | `SELECT * FROM Pricebook2` | |
| `PricebookEntry.csv` | `SELECT * FROM PricebookEntry` | |
| `Task.csv` | `SELECT Id, WhoId, WhatId, AccountId, OwnerId, Subject, Description, ActivityDate, CompletedDateTime, Type, Status, Priority, IsClosed, IsDeleted, IsArchived, EmailMessageId, ActivityOriginType, CallType, CallDisposition, CallObject, CallDurationInSeconds, IsRecurrence, RecurrenceType, RecurrenceInterval, RecurrenceStartDateOnly, RecurrenceEndDateOnly, RecurrenceTimeZoneSidKey, RecurrenceDayOfWeekMask, RecurrenceDayOfMonth, RecurrenceMonthOfYear, RecurrenceInstance, RecurrenceActivityId, ReminderDateTime, IsReminderSet, CreatedDate, CreatedById, LastModifiedDate, LastModifiedById FROM Task` | Bulk API |
| `Event.csv` | `SELECT * FROM Event` | |
| `Partner.csv` | `SELECT Id, AccountFromId, AccountToId, Role, IsPrimary, ReversePartnerId, IsDeleted FROM Partner WHERE IsDeleted = false` | |
| `User.csv` | `SELECT Id, Name, Email, IsActive FROM User` | Used by import scripts to resolve ownership |

Save into a folder, e.g. `~/Downloads/sf-prod-export/`.

---

## Phase 1 — Freeze Salesforce

1. Announce the cutover window to the 7 SF users (3 admins + 4 standard).
2. No new SF edits from now until verify passes (Phase 7). If anything is logged in SF during the window, it's a manual carryover after.

---

## Phase 2 — Point the code at prod

These happen in the GitHub Staging workflow vs Prod workflow already — when you merge `Staging → main`, the Prod workflow runs automatically. But verify the secrets are set:

1. GitHub → Medcurity1/medcurity-crm → Settings → Secrets and variables → Actions
2. Confirm these exist (values will differ from Staging):
   - `PROD_VITE_SUPABASE_URL`
   - `PROD_VITE_SUPABASE_ANON_KEY`
   - `PROD_SUPABASE_PROJECT_REF`
   - `SUPABASE_ACCESS_TOKEN` (shared)
   - `AZURE_STATIC_WEB_APPS_API_TOKEN_WHITE_FLOWER_0F9685910`

3. Check `.github/workflows/azure-static-web-apps-white-flower-0f9685910.yml` references those same `PROD_*` names for its build step. If it still says `VITE_SUPABASE_URL` (shared), update it to `PROD_VITE_SUPABASE_URL` so prod builds against the prod project.

---

## Phase 3 — Merge Staging → main

```bash
cd "/path/to/medcurity-crm"

git checkout main
git pull origin main
git merge origin/Staging --no-ff -m "Production cutover 2026-04-25"
git push origin main
```

GH Actions runs the Prod workflow:
1. `npm ci`
2. `npm run build` (with `PROD_VITE_*` env)
3. `supabase db push` against prod project (applies every migration)
4. Deploy to `white-flower.2.azurestaticapps.net`

Watch https://github.com/Medcurity1/medcurity-crm/actions — the run typically takes 3–5 min. **Do not proceed until it goes green.**

If it fails, DO NOT run the data scripts — fix the deploy first.

---

## Phase 4 — Verify the schema deployed clean

From the Supabase SQL Editor on the **production** project:

```sql
-- Expected tables
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'accounts','contacts','leads','opportunities','opportunity_products',
    'activities','products','price_books','price_book_entries',
    'account_partners'
  )
order by table_name;

-- Critical columns that blocked previous runs
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'activities'
  and column_name in ('duration_minutes','event_type','is_all_day_event','sf_id')
order by column_name;

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'accounts'
  and column_name in ('imported_at','sf_created_date','partner_account');

-- Partners table shape
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'account_partners'
order by column_name;
-- Expected: created_at, created_by, id, member_account_id, notes,
-- partner_account_id, role, updated_at
```

All expected rows must be present. If anything's missing, the migration `commit;/begin;` race from 20260422000001 bit us again — re-run the migration SQL manually from the SQL Editor.

Known fixable hiccups:
- If `duration_minutes` is missing: paste the SQL from `supabase/migrations/20260422000004_activities_event_fields.sql`
- If `account_partners` has the WRONG columns (`account_id` + `partner_id` instead of `partner_account_id` + `member_account_id`): paste the big drop-and-recreate from `supabase/migrations/20260422000005_account_partnerships.sql`

End every SQL batch with:
```sql
notify pgrst, 'reload schema';
```

---

## Phase 5 — Import data (prod)

### 5.1 — UI imports (browser)

Log into `white-flower.2.azurestaticapps.net` with your admin account.

Go to Admin → Salesforce Import. Run **in this order**:

| # | Entity | CSV | Dup action |
|---|---|---|---|
| 1 | Accounts | `Account.csv` | Skip |
| 2 | Contacts | `Contact.csv` | Skip |
| 3 | Products | `Product2_canonical.csv` (17 rows, NOT the raw 155) | Skip |
| 4 | Price Books | `Pricebook2.csv` | Skip |
| 5 | Price Book Entries | `PricebookEntry.csv` | Skip |
| 6 | Opportunities | `Opportunity.csv` | Skip |
| 7 | Opportunity Line Items | `OpportunityLineItem.csv` | Skip |
| 8 | Leads | `Lead.csv` | Skip |
| 9 | Tasks | `Task.csv` | Skip — leave both filter checkboxes ON (skip open + skip email) |
| 10 | Events | `Event.csv` | Skip |

**For the Price Book Entries step (#5), also load Product2.csv via the Step 2.5 side-load BEFORE uploading PricebookEntry.csv** — this is how PBE rows resolve SF Product2Id → canonical CRM product.

### 5.2 — Terminal scripts

From the worktree root:

```bash
cd "/path/to/medcurity-crm"

# Prod env vars — export them once, reuse across scripts.
export PROD_SUPABASE_URL="https://YOUR-PROD-REF.supabase.co"
export PROD_SERVICE_KEY="eyJhbG...your-prod-service-role-key"

# A. Backfill SF audit fields on all tables (1–2 min for 100k rows).
# This populates sf_created_date / sf_created_by / sf_last_modified_* on
# every row where the CSV carried them. Next SQL phase reads these.
SUPABASE_URL="$PROD_SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$PROD_SERVICE_KEY" \
  node scripts/migration/backfill-sf-audit-fields.mjs \
  ~/Downloads/sf-prod-export

# B. Bulk task importer (faster than UI path for 60k+ rows, handles
# enum normalization + lead WhoIds correctly). SKIP if #9 in the UI
# import already succeeded — this script is a fallback for if the
# browser import hung.
# SUPABASE_URL="$PROD_SUPABASE_URL" \
#   SUPABASE_SERVICE_ROLE_KEY="$PROD_SERVICE_KEY" \
#   USER_CSV="$HOME/Downloads/sf-prod-export/User.csv" \
#   node scripts/migration/import-tasks.mjs \
#   ~/Downloads/sf-prod-export/Task.csv

# C. Partner relationships (SF Partner.csv → account_partners).
SUPABASE_URL="$PROD_SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$PROD_SERVICE_KEY" \
  node scripts/migration/import-partner-relationships.mjs \
  ~/Downloads/sf-prod-export/Partner.csv
```

### 5.3 — SQL fix-up block (one pass)

Paste into **prod** Supabase SQL Editor:

```sql
begin;

-- imported_at columns (defensive — should exist from migration)
alter table public.accounts              add column if not exists imported_at timestamptz;
alter table public.contacts              add column if not exists imported_at timestamptz;
alter table public.leads                 add column if not exists imported_at timestamptz;
alter table public.opportunities         add column if not exists imported_at timestamptz;
alter table public.opportunity_products  add column if not exists imported_at timestamptz;
alter table public.activities            add column if not exists imported_at timestamptz;
alter table public.products              add column if not exists imported_at timestamptz;
alter table public.price_books           add column if not exists imported_at timestamptz;
alter table public.price_book_entries    add column if not exists imported_at timestamptz;

-- Opportunity stages → SF values (in case any legacy rows slipped through)
update public.opportunities set stage = 'details_analysis'      where stage = 'qualified';
update public.opportunities set stage = 'proposal_conversation' where stage = 'proposal';
update public.opportunities set stage = 'proposal_conversation' where stage = 'verbal_commit';
update public.opportunities set stage = 'details_analysis'      where stage = 'lead';

update public.opportunity_stage_history set from_stage = 'details_analysis'      where from_stage = 'qualified';
update public.opportunity_stage_history set from_stage = 'proposal_conversation' where from_stage in ('proposal', 'verbal_commit');
update public.opportunity_stage_history set from_stage = 'details_analysis'      where from_stage = 'lead';
update public.opportunity_stage_history set to_stage   = 'details_analysis'      where to_stage   = 'qualified';
update public.opportunity_stage_history set to_stage   = 'proposal_conversation' where to_stage   in ('proposal', 'verbal_commit');
update public.opportunity_stage_history set to_stage   = 'details_analysis'      where to_stage   = 'lead';

-- Probability function (SF percentages)
create or replace function public.default_probability_for_stage(s public.opportunity_stage)
returns integer language sql immutable as $$
  select case s
    when 'details_analysis' then 40
    when 'demo' then 60
    when 'proposal_and_price_quote' then 75
    when 'proposal_conversation' then 90
    when 'closed_won' then 100
    when 'closed_lost' then 0
    when 'qualified' then 40
    when 'proposal' then 90
    when 'verbal_commit' then 90
    when 'lead' then 40
  end;
$$;

update public.opportunities set probability = public.default_probability_for_stage(stage);
alter table public.opportunities alter column stage set default 'details_analysis';

-- Copy sf_created_date → created_at (preserve SF history timestamps)
-- and stash the import-time value as imported_at
update public.accounts              set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;
update public.contacts              set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;
update public.leads                 set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;
update public.opportunities         set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;
update public.activities            set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;
update public.opportunity_products  set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;
update public.products              set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;
update public.price_books           set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;
update public.price_book_entries    set imported_at = created_at, created_at = sf_created_date, updated_at = coalesce(sf_last_modified_date, sf_created_date) where sf_created_date is not null and created_at > sf_created_date;

-- Lead qualification: any lead with MQL date but no qualification → mark as MQL
update public.leads
set qualification = 'mql',
    qualification_date = coalesce(qualification_date, mql_date)
where mql_date is not null
  and (qualification is null or qualification = 'unqualified');

commit;

-- Force PostgREST to reload its schema cache
notify pgrst, 'reload schema';
```

---

## Phase 6 — Invite users

From Admin → Users:

```
James Parrish           james@medcurity.com    admin
Rachel Kunkel           rachelk@medcurity.com  admin
Joe Gellatly            joeg@medcurity.com     admin
Summer Hume             summerh@medcurity.com  user
Molly Miller            mollym@medcurity.com   user
Jordan Scherich         jordans@medcurity.com  user
Margaret Karatzas       margaretk@medcurity.com user
Brayden Frost           braydenf@medcurity.com admin
```

(Update this list if your actual invitees differ — pull from the staging user list as the canonical source.)

---

## Phase 7 — Verify

Run in prod Supabase SQL Editor:

```sql
-- Row counts per entity — compare against what SF reports
select 'accounts' as t, count(*) from public.accounts
union all select 'contacts', count(*) from public.contacts
union all select 'leads', count(*) from public.leads
union all select 'opportunities', count(*) from public.opportunities
union all select 'opportunity_products', count(*) from public.opportunity_products
union all select 'activities', count(*) from public.activities
union all select 'products', count(*) from public.products
union all select 'price_books', count(*) from public.price_books
union all select 'price_book_entries', count(*) from public.price_book_entries
union all select 'account_partners', count(*) from public.account_partners;

-- Opportunity stage distribution — should match your SF report
select stage, count(*) from public.opportunities group by stage order by count(*) desc;

-- ARR — total value of closed_won in last 365d
select coalesce(sum(amount), 0) as arr_last_365d
from public.opportunities
where stage = 'closed_won'
  and close_date >= current_date - interval '365 days';

-- Partners — UTN should show as top umbrella
select p.name, count(*) as members
from public.account_partners ap
join public.accounts p on p.id = ap.partner_account_id
group by p.name order by count(*) desc limit 10;

-- created_at sanity (should see dates across 2020-2026, NOT all today)
select date_trunc('year', created_at) as year, count(*)
from public.opportunities
group by 1 order by 1;
```

Manual spot-checks in the UI:
- [ ] Open UTN → Partner tab shows 6+ member hospitals
- [ ] Open any account → activity timeline renders with Apr/Mar/Feb 2026 month headers
- [ ] Opportunity list filter: pick "Demo" → should return some opps (5 in last staging count)
- [ ] Lead list: filter "MQL" → count > 0
- [ ] Pipeline view renders with the 6 SF-matching stages

---

## Phase 8 — Unfreeze SF as read-only

1. Tell the team the new CRM is live.
2. Leave SF up read-only for at least 7 days in case you need to double-check something against it.
3. Do NOT let anyone add new records in SF after cutover — anything added there will be lost when you cancel the subscription.

---

## Phase 9 — Push to personal GitHub (for skeleton reuse)

Separate from the prod deploy — this is your portable CRM starting point.

```bash
cd "/path/to/medcurity-crm"

# Add your personal remote if it's not already there
git remote -v | grep personal || git remote add personal https://github.com/Jackfrost830/frost-crm.git

# Push main (the production-ready code, not staging's in-flight work)
git push personal main
```

**Before pushing**, sanity-check the repo for Medcurity-specific data:
- [ ] No `.env.local` committed (check `git ls-files | grep env`)
- [ ] No SF exports committed (`git ls-files | grep -i "sf-\|salesforce" | head`)
- [ ] `docs/migration/` contains Medcurity-specific details — consider adding `/docs/` to `.gitignore` for the personal repo, or just don't push `docs/` at all:

```bash
# Push just the app code, skip docs
git push personal main
# If you want to strip docs on personal, do it via a filter-branch or
# maintain a separate "skeleton" branch. Easier: push main as-is, then
# manually delete docs/migration/ on GitHub via web UI in the personal repo.
```

Mark personal repo **private** under its Settings → General → Danger Zone.

---

## Rollback

If verification in Phase 7 reveals a problem you can't fix in <30 min:

1. **Production data corrupt**: use Supabase's Point-in-Time-Recovery (PITR) to roll back to before the migration. Settings → Database → Backups. Only works if PITR was enabled pre-cutover — if not, this option is gone.
2. **Code broken but data fine**: `git revert` the merge commit on `main`, push, Azure re-deploys the previous good version. Data stays.
3. **Everything**: tell the team to keep using SF until Monday. Debug in peace.

---

## Post-cutover (within a week)

- [ ] Rotate the `ghp_*` GitHub PAT currently embedded in your `origin` remote URL (`git remote -v` — it's visible in plaintext)
- [ ] Export the last 30 days of SF data one more time for archive
- [ ] Cancel SF subscription once the team confirms they're off
- [ ] Enable Supabase PITR on prod ($100/mo but worth it for sleep)

---

## Quick-reference command cheat sheet

```bash
# Find service_role key
# → Supabase Dashboard → Project Settings → API → service_role → Reveal

# Find prod URL
# → Supabase Dashboard → Project URL

# Re-run one migration
# → Supabase SQL Editor → paste the file contents from supabase/migrations/ → run

# Force PostgREST cache refresh
# → Supabase SQL Editor → notify pgrst, 'reload schema';

# Watch GH Actions deploy
# → https://github.com/Medcurity1/medcurity-crm/actions

# Deployed prod URL
# → https://white-flower-0f9685910.2.azurestaticapps.net
```
