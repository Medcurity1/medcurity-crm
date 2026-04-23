# Reports & Dashboards

Generated 2026-04-15.

## Headline findings

- **710 total reports, but only 66 (9.3%) have been run in the last 90 days.** The other 644 are abandoned/legacy.
- **26 dashboards, but only ~6 have been touched in the past year.** Most are dormant.
- **The actually-used reporting surface is small (~50 reports + ~6 dashboards) and almost entirely about: opportunity pipeline, renewal tracking, MQL/SQL counts, closed-won by quarter/owner, ARR.** 
- **"Brayden Reports" folder exists with 43 reports, 17 of which are recently run.** So Brayden DOES have a SF user account (probably under a different email — likely a person named "Brayden" elsewhere, since `braydenf@medcurity.com` doesn't appear in the user list). **Need to confirm Brayden's actual SF identity.**
- **Two named users (Mel + Sean) have folders full of dormant reports.** Mel (deactivated user) still has reports in "Public Reports". Sean's folder has 22 reports, none run recently.
- **710 reports is way more than the new CRM needs to replicate.** Re-implement the ~20 most-run reports as dashboards/views; archive the rest.

## Reports by folder

| Folder | Total | Recently Run (90d) | Owner inference |
|---|---|---|---|
| Public Reports | 547 | 48 | Shared org-wide; the canonical reporting surface |
| **Brayden Reports** | **43** | **17** | Personal folder for Brayden — heavy use |
| Private Reports | 29 | 1 | Various individual private reports |
| MLP Reports | 53 | 0 | "MLP" — likely Minlopro (a SF consultancy that worked on the org); abandoned |
| Sean | 22 | 0 | Sean Mercer's folder; abandoned |
| Abby's Reports | 8 | 0 | Abby Jones (departed); abandoned |
| Ari' Reports | 8 | 0 | Ari Van Peursem (departed); abandoned |

## The actually-used reports (top 50, last 90 days)

These are the reports that need to be replicated (or replaced with views/dashboards) in the new CRM. Grouped by topic:

### Pipeline / opportunity (most-used)
- "Open Renewal Opportunities" (Public Reports) — **the canonical renewal pipeline view, run 2026-04-16**
- "Opportunity Pipeline - Open" (Public Reports) — Matrix
- "HomePage - All Pipeline - Current Year" (Public Reports)
- "HomePage - Potential Revenue Source" (Public Reports)
- "Sales Open Opportunities for Quarter" (Public Reports)
- "Jordan's Open Opportunities" (Public Reports) — owner-specific

### Closed-won / revenue
- "Closed Won New Opportunities for Quarter"
- "Closed Won Existing Business for Quarter"
- "Closed Won New Vs Renewal For Dashboard"
- "Closed (Won) Opportunities Last Quarter"
- "Current Quarter Closed Won by Owner" / per-owner variants (MM, SH, AVP)
- "Current Month Closed Won by Owner"
- "Last Month Closed Won by Owner"
- "2024 New Closed Won Report"
- "Avg Deal Size - Current FY"
- "Avg. Deal Length"
- "ARR - Chad" — annual recurring revenue, owner Chad
- "Running Total Closed Won New Vs Renewal"
- "Products Growth Count YoY 4A"

### Marketing qualification
- "Marketing Qualified Leads" / "Marketing Qualified Contacts" (run daily)
- "SQLs for Quarter"
- "SQL Monthly Report"
- "Mel's MQL Contacts/Leads/SQL Report" — Mel is deactivated but reports still active
- "Marketing Qualified Leads (Totals)"

### Customer / churn / renewal context
- "Inactive Clients per quarter" (Public Reports, run 2026-04-16)
- "Closed Lost"
- "1-20 FTE Closed Lost" (Brayden's)
- "Closed Lost Accounts & Opps 092525" (Brayden's)
- "Closed/Lost 2025" (Brayden's)
- "Active Customers 030326" / "Active Customers by Opportunity 030426" (Brayden's working reports)
- "Active accounts - updating"
- "Active Cx - No Training 031726"
- "Old Accts to Check as of 031026"
- "Q4 Open Renewal Opportunities 100925"
- "Open Renewal Opportunities by Quarter"
- "Open Renewal Opportunities 2025"
- "Q4 24 & Q1 25 of Accounts for Renewals"

### Industry / segmentation
- "Accounts w Opps by Industry" (Brayden's)
- "Account Count by Industry" (Brayden's)

### Activity
- "Activities - Last Week"

### Partner / referral
- "Active Partner List"
- "PCA Contacts & Accounts (NWRPCA)"
- "PCA/Associated Lead Source Leads"
- "Partners - All Opportunities"
- "Accounts with Partners Report"

### Compliance / GDPR
- '"Do Not Market To" Report'

### Audit
- "SF User Audit Report" (Brayden's, run 2025-03-21)

### Workflow tracking
- "Created by Automation" (Brayden's, 2x recent runs) — tracks opps created by the renewal flow
- "Inactive Clients per quarter"
- "New Customers/Quarter (not 100%accurate)" — note the "not 100%accurate" caveat in the name

## Active dashboards

| Dashboard | Folder | Last Modified | Likely usage |
|---|---|---|---|
| **Bullpen Dashboard** | Public | 2026-02-24 | Sales activity overview — most recently updated |
| **Growth/Sales Dashboard** | Public | 2025-12-22 | Top-line metrics |
| **Molly's Dashboard** | Public | 2025-07-16 | Per-rep dashboard |
| **2025 Medcurity Dashboard** | Private | 2025-03-01 | Annual rollup |
| **Lead Source Dashboard** | Private | 2025-02-27 | Marketing attribution |
| **SH - Sales Pipeline** | Public | 2025-02-12 | Summer Hume's pipeline |
| **Product Growth YoY $ & %** | Public | 2025-01-22 | Product performance |
| **Partner Dashboard** | Public | 2024-09-13 | Partner channel |

Older / dormant (likely abandoned, but verify): Product Performance by Product, Sean's Master Dashboard, AVP - Activity, Sales - Updates, Previous Quarter Dashboard - Sales, Product Performance by FTE, Executive Dashboard, MLP Sample, Investor Dashboard - Sales KPIs, SM - Activity, Board Sales Dashboard, RM - Activity, Growth Snapshot Dashboard, Support Performance Dashboard, 1:1, Medcurity Quarterly Sales Dashboard, Sales Pipeline, Sales Results.

## List Views

112 list views total. Top objects:
- 26 on (one redacted object name — likely Pardot pi__ object)
- 12 PricebookEntry
- 10 Opportunity
- 9 Task
- 8 Lead
- 7 Contract
- 6 Case, 6 Event
- 5 each: Activity, ContentDocument, Report, Contact, CollaborationGroup
- 4 each: Solution, Knowledge__kav, FlowRecord
- 3 each: Dashboard, DelegatedAccount

## Implications for migration

1. **Don't try to replicate 710 reports.** Replicate the ~20-30 actively-used ones as either:
   - Built-in dashboards in the new CRM
   - Saved filters / views over standard tables
   - SQL views for ad-hoc analysis
2. **The reporting "must-haves" cluster around 4 themes:**
   - **Pipeline** (open opps by stage, by owner, by quarter)
   - **Renewals** (open renewal opps, renewals by quarter, churn tracking)
   - **MQL/SQL funnel** (marketing-qualified counts, conversion to SQL)
   - **Closed-won bookings** (current quarter / month / year, by owner, new vs. renewal split)
3. **All reports use the same underlying data** that's being modeled in the new CRM (Opportunity, Account, Contact, Lead, OpportunityLineItem). No bespoke reporting joins needed.
4. **Bring forward "Brayden Reports" as a starter set** for the new CRM's saved-views functionality. He's the most active user and his reports show the actual day-to-day analytical needs.
5. **The "Created by Automation" report needs an equivalent** in the new CRM — this is how Brayden monitors the renewal automation's output. Map: SF `Created_by_Automation__c=true` → new CRM `is_auto_renewal_generated=true`.
6. **Decommission cleanup before SF cutover:**
   - Reassign or delete reports owned by deactivated users (Mel, Sean, Abby, Ari)
   - Archive 600+ unused reports
