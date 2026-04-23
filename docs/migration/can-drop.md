# Can Drop — Salesforce Stuff That Doesn't Need to Survive

These are SF capabilities, records, and fields that are safe to leave behind. Each entry says **why** — so Brayden can sanity-check before cutover.

---

## Apex code (zero bespoke)

There are 396 Apex classes in the org but **all 396 are managed-package code** (390 from the `pi` Pardot package, 6 from `HubSpot_Inc`). Zero bespoke Apex. **Nothing to port.**

There are also zero bespoke Apex triggers, validation rules, or workflow rules outside of the package code. The bespoke automation surface is entirely in the 7 active Flows (covered in `02-flows-metadata-parsed.md` / `must-replicate.md` / `rebuild-differently.md`).

## Email Templates (21 active, only 2 ever used)

| Template | Last Used | Times |
|---|---|---|
| Test 1 | 2021-06-09 | 5 |
| Case Study Email | 2024-03-07 | 4 |

The other 19 are SF package defaults or untested drafts. **Drop all of them.** Sales team writes emails ad-hoc in HubSpot/Outlook today.

## Campaigns (8 total, all dormant or test)

| Campaign | Status |
|---|---|
| Created from Salesforce | Auto-populated catch-all |
| Website Tracking | Pardot auto-tracking |
| Medcurity Webinars | Empty placeholder |
| Medcurity User Group Meeting | One past UG meeting (219 attendee contacts — preserve attendance data only if event attribution matters) |
| Abby Specialty Network Campaign | Departed user's |
| Test Campaign / TEST / JAMISON TEST CAMPAIGN | All test |

**Drop all.** No active marketing campaigns in SF. If campaign attribution becomes needed later, build it as a fresh feature in staging.

## Cases (354 records, ~70/year)

The Case object has been used at low volume across 5+ years, with many "Zipline-Closed" cases from a prior consultancy era. **No Cases section in staging today.**

**Action:** Verify with Brayden — is customer support handled in another tool now (Zendesk/Intercom/Front)? If yes → drop. If no → add a minimal Cases section to staging.

## Knowledge (`Knowledge__kav` + Question/Answer custom fields)

The Knowledge license isn't even granted to API queries, suggesting near-zero use. Likely 0 articles or single-digit. **Drop unless Brayden confirms it's used.**

## Email logging (0 EmailMessage records)

Nothing to migrate — there's no email history in SF. Email lives in HubSpot or sales reps' inboxes today.

## Account hierarchy

Only 45 of 5,642 accounts have a parent. **Don't prioritize complex hierarchy support** — flat is sufficient. If parent/child eventually matters, add a single nullable `parent_account_id` column.

## "Standard Medcurity" profile users (16 inactive)

Old SF user accounts on a profile that's no longer in use. **Don't recreate these in the new CRM.** Just bring forward the 7 active humans.

## Old / dormant reports (~644 of 710)

| Folder | Total | Recently Run |
|---|---|---|
| Public Reports | 547 | 48 |
| MLP Reports | 53 | 0 |
| Sean's Reports | 22 | 0 |
| Abby's Reports | 8 | 0 |
| Ari' Reports | 8 | 0 |

The 91 reports in MLP/Sean/Abby/Ari folders are owned by departed users or a former consultancy and haven't been touched in 90+ days. **Drop entirely.** Bring forward only the ~50 actively-run reports (see `must-replicate.md` for the list).

## Old / dormant dashboards (~20 of 26)

Only ~6-8 dashboards have been touched in the past year. The rest (Product Performance by Product, Sean's Master Dashboard, AVP Activity, Sales Updates, Investor Dashboard, Board Sales Dashboard, etc.) are abandoned. **Drop.**

## Bespoke fields that exist solely to drive workflows

| Field | Why drop |
|---|---|
| `Account.Copy_Billing_Address_to_Shipping_Address__c` | SF workflow trigger — replace with a "copy" button or just default the form |
| `OpportunityLineItem.Product_Category__c` | Feeds the Opportunity_Update_Name auto-rename flow — which we're dropping |
| `OpportunityLineItem.CategorySort__c` | Same |
| `Product2.CategorySort__c` | Display ordering — not needed in staging's 3-product model |

## SF formula/rollup fields that should become computed views

| Field | Replace with |
|---|---|
| `Contact.Days_Since_Last_Activity__c` | Computed at read time from activity table |
| `Account.FTE_Range__c` | Computed from `fte_count` |
| `Opportunity.FTE_Range__c` | Snapshotted at opp creation (already done in staging) |

## SF-only fields with cryptic / unclear meaning

| Field | Status |
|---|---|
| `Contact.Do__c` | Cryptic name; likely abandoned. Check with Brayden, then drop |
| `Contact.Events__c` | Unclear semantics; verify with Brayden |
| `Lead.Events__c` | Same |
| `Contact.Opportunity_ContractId__c` | Looks like a denormalized join — let the join table handle it |

## Connected Apps and packages

| Item | Why drop |
|---|---|
| `CPQ Integration User Connected App` | CPQ package isn't actually installed; vestigial |
| `Sales Insights` (OIQ) package | Likely never adopted — drop |
| `Salesforce Mobile Apps` package | Default — drops with org |
| `Essentials Service Configs` | Vestigial from when org was Essentials edition |
| Stock Salesforce dev/admin apps (Workbench, Dataloader, Force.com IDE, Ant Migration Tool, etc.) | Drop with SF org |

## Permission sets (all but a handful)

Of 88 permission sets, 70 are managed-package boilerplate. The custom ones to evaluate:

- `Account_Transfer` — implement as admin-only "reassign owner" UI in staging
- `cases_Permisssion_Set` (sic, typo) — drop unless Cases is kept
- `Knowledge_LSF_Permission_Set` — drop unless Knowledge is kept
- `HubSpot_Integration_Permissions` — drop with SF
- `Pardot_*` — drop with SF (or with Pardot if retiring)
- `Test_SFDC` — clearly abandoned

The vast majority are package boilerplate; **don't try to recreate the permission-set sprawl in staging.** Two roles (admin/user) is enough.

## Queues

- `MCAE Queue` — Pardot-specific. Drop with Pardot/SF.
- `Support Queue` — Drop unless Cases is kept.

## Picklist values to clean up before migration (don't bring duplicates forward)

- **Account.Industry:** "Hospital" + "Hospital & Health Care" → one value. Drop lowercase "information technology & services" duplicate. Dedupe Computer Software/Technology.
- **Lead.Status:** drop lowercase `done` (43 records).
- **Lead.LeadSource:** archive year-stamped conferences (CHUG19, AuDacity 2019/2021, CHCAMS 2023).
- **Opportunity.Type:** replace 4 messy values with a clean enum and migrate the 640 default-value `"Opportunity"` rows.
- **Account.Status:** decide what NULL means before migrating 5,080 NULL-status accounts.

## Lead records with Status="New" never worked (30,943 records)

These are purchased-list leftovers. **Don't migrate them to `leads`** — they're cold, expired, and would inflate the leads table by 4x. Either:

(a) Archive them to a separate `archived_leads` table (or just don't migrate)
(b) Move them to a "lead lists" feature for re-prospecting
(c) Drop entirely

Recommendation: (a) — preserve for compliance/audit but don't surface in the working leads view.

## All `pi__*` Pardot tracking fields on Lead/Contact

If Pardot is retired, these go away too: utm_*, score, grade, conversion_*, all the per-lead Pardot tracking fields. **Drop with Pardot.**

## Files & Notes

- 160 ContentDocuments — small enough to download/re-upload manually if business-critical, or skip entirely. Verify with Brayden.
- 1 ContentNote — drop.

## In-progress task status

3 tasks have status "In Progress" (out of 6,625). Statistically meaningless. **Don't bother with the In Progress status in the new CRM** — just `not_started`, `completed`, optionally `cancelled`.
