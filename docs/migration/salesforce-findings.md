# Salesforce Findings — Consolidated Overview

A single-page summary of what's actually inside the Medcurity Salesforce org, derived from a comprehensive read-only exploration of the Tooling and Data APIs. Generated 2026-04-15.

This is the "what's there" snapshot. For "what to do about it," see the other documents in this `handoff/` directory.

---

## The org at a glance

- **Edition:** Professional (no UserRoles, no public groups, no sharing rules)
- **Created:** 2020-04-23 (~6 years old)
- **Active human users:** 7
- **Total record volume:** ~70K records across all objects (manageable migration scope)

| Object | Records |
|---|---|
| Lead | 42,697 |
| Task | 6,625 |
| Account | 5,642 |
| Opportunity | 2,207 |
| OpportunityLineItem | 2,579 |
| Case | 354 |
| Event | 129 |
| ContentDocument | 160 |
| EmailMessage | **0** |
| ContentNote | 1 |

---

## The bespoke surface area

This is everything custom-built in the org that needs migration consideration:

| Asset type | Count | Notes |
|---|---|---|
| **Bespoke Apex classes** | **0** | All 396 Apex classes are managed-package code |
| **Bespoke Apex triggers** | **0** | |
| **Bespoke validation rules** | **0** | |
| **Bespoke workflow rules** | minimal | A handful tied to address-copy field |
| **Bespoke active Flows** | **7** | The actual automation logic — see below |
| **Bespoke custom objects** | **0** | (`Knowledge__kav` is standard SF Knowledge with 2 custom fields) |
| **Bespoke custom fields** | **~96** | Distributed across Account (24), Contact (~25), Lead (~19), Opportunity (15), and a few others |
| **Bespoke Connected Apps** | **2** | Medcurity Website API, OIQ_Integration (plus stock SF dev tools) |
| **Bespoke Remote Sites** | **0** | All 8 are package-owned (HubSpot or Pardot) |
| **Bespoke Email Templates** | minimal | Of 21 active, only 2 have ever been used |
| **Bespoke Reports** | ~50 actively used | Of 710 total |
| **Bespoke Dashboards** | ~6-8 actively used | Of 26 total |
| **Active Campaigns** | 0 | All 8 are tests or auto-tracking placeholders |

**Headline:** the bespoke surface is much smaller than the SF org's apparent size suggests. Zero custom code. Just 7 Flows and ~96 fields to port (plus integrations).

---

## The 7 active Flows (the entire bespoke automation surface)

Full per-flow documentation in `raw/02-flows-metadata-parsed.md`. Summary:

1. **`Renewal_Opportunity_2_No_Products` v4** — Daily scheduled. Auto-creates renewal opps for closed-won deals at exactly 115 days before the anniversary. **Brittle (no catch-up logic, no idempotency).**
2. **`Send_Notification_for_Renewal_Opportunity` v4** — Daily scheduled. Creates a Task on the opp owner exactly 60 days before maturity. **Same brittle exact-day check.**
3. **`Apply_Opportunity_Discount_To_New_Opp_Product` v1** — Record-triggered on OpportunityLineItem create. Propagates opp-level discount to new "Products"-family lines.
4. **`Apply_Opportunity_Discount_to_Products_Not_Services` v2** — Record-triggered on Opportunity update when Discount changes. Propagates to existing lines.
5. **`Set_FTEs_for_Account` v2** — Record-triggered on Account when NumberOfEmployees or Status changes. Buckets FTEs into 11 tiers; sets Active_Since on Active transition; sets Churn fields on Inactive transition. **Has a bug:** "oldest"/"newest" lookups have no `ORDER BY` and use `first only`, returning arbitrary records.
6. **`Opportunity_Update_Name` v1** — Record-triggered on Opportunity update. Auto-renames opps from concatenated unique product categories. **Clobbers user-entered names.**
7. **(One v5 draft of the renewal flow exists — Brayden was iterating to add line-item copying but never finished/activated it.)**

---

## Custom fields by object

Exact list in `raw/04-objects-and-fields.md`. Top-level counts:

- **Account: 24 bespoke fields** — covers lifecycle (Active_Since, Status, Renewal_Type, Auto_Renewal), sizing (FTEs, FTE_Range, Number_of_Providers, Locations, Every_Other_Year), financial (ACV, Lifetime_Value, Churn_Amount, Churn_Date, Contracts), partner attribution (Partner_Account, Partner_Prospect, Partner_Source, Referring_Partner), and various workflow fields.
- **Contact: ~25 bespoke fields** — qualification (MQL, SQL, Credential), identity (LinkedIn, Phone_Ext, Time_Zone), lifecycle (Archived, Days_Since_Last_Activity, Type, Primary_Contact, Business_Relationship_Tag), and several with unclear purposes (Do__c, Events__c).
- **Lead: ~19 bespoke fields** — many overlap with Contact, plus `Do_Not_Market_To` (compliance) and `Priority_Lead`.
- **Opportunity: 15 bespoke fields** — renewal-critical (Auto_Renewal, Contract_Length, Contract_Year, Created_by_Automation, Cycle_Count, Maturity_Date, Start_Date, One_Time_Project), pricing (Discount, Subtotal, Payment_Frequency, Promo_Code), sizing (FTE_Range, FTEs), workflow (Follow_Up).
- **OpportunityLineItem: 2 bespoke fields** — both feed the Opportunity_Update_Name auto-rename flow.
- **Product2: 4 bespoke fields** — Category, CategorySort, Service_Product, Service_Type (used to navigate the 155-SKU matrix).
- **Case: 4 bespoke fields** — Assigned_NVA, Definitions, Next_Steps, Partner.

---

## Pricing & products structure

**This is the messiest part of the SF org** and is being explicitly redesigned in staging.

- **12 Pricebooks**, one per FTE tier (1-20, 21-50, 51-100, 101-250, 251-500, 501-750, 751-1000, 1001-1500, 1501-2000, 2001-5000, 5001-10000) plus the SF default Standard pricebook
- **155 active Products**, but really only ~14 unique product *concepts* duplicated across all 11 FTE tiers (e.g., "1-20 General Employee HIPAA Training", "21-50 General Employee HIPAA Training", ..., "5001-10000 General Employee HIPAA Training")
- 2 product families: **Products** (73) and **Services** (82)

The discount-propagation flows exist mostly to dance around this matrix. Staging's 3-product / Per-FTE-pricing model fixes this entirely.

---

## Data quality issues to clean before migration

1. **Account.Industry picklist drift** — `Hospital` (1176) and `Hospital & Health Care` (384) are duplicates. Lowercase `information technology & services` duplicates `Technology`. `Computer Software` overlaps with `Technology`.
2. **Lead.Status picklist drift** — lowercase `done` (43 records) duplicates other statuses.
3. **Opportunity.Type** — 640 records (29%) have the literal default value `"Opportunity"`. Type is essentially unused.
4. **5,080 of 5,642 Accounts (90%) have NULL Status** — these are prospect/lead-list companies polluting the Accounts list.
5. **30,943 of 42,697 Leads (72%) are Status="New", never worked** — purchased-list leftovers.
6. **6,546 of 6,625 Tasks (99%) have NULL Type** — Task.Type is effectively unused.
7. **Two duplicate Mel Nevala user records** from a name-change incident.
8. **15 SF-orphaned reports** owned by deactivated users (Mel, Sean, Abby, Ari).

---

## Integrations landscape

- **HubSpot** (bidirectional) — `HubSpot_Inc` "Daiquiri" v3.0 package. **Was not on Brayden's known-integration list.**
- **Pardot / Account Engagement** — `pi` v5.9 package, fully active. 390 Apex classes.
- **Sales Insights (OIQ)** — installed, likely never adopted.
- **Medcurity Website API** — bespoke Connected App, created 2020. Likely how the public website pushes leads. **Caller needs to be identified.**
- **Outlook / Gmail / PandaDoc** — NOT in SF; available in staging.

8 Remote Sites (4 HubSpot, 4 Pardot). 0 Named Credentials. 0 External Data Sources. 1 AuthProvider (Pardot package).

---

## People

- **7 active human users:** James Parrish, Rachel Kunkel, Joe Gellatly (admins); Summer Hume, Molly Miller, Jordan Scherich, Margaret Karatzas (standard).
- **27 inactive users** representing significant team turnover (departed 2020-2025).
- **Brayden Frost is NOT in the SF user list** — he uses `braydenf@medcurity.com` for the new CRM but doesn't operate inside SF today. Likely the prospective owner/buyer of the new CRM.
- **22 profiles** (only 5 used by active humans).
- **88 permission sets** (18 custom, most unused).
- **2 queues** (MCAE, Support).

---

## Reporting

- **710 reports total**, but **only 66 (9.3%) run in last 90 days.**
- **26 dashboards**, ~6-8 active.
- **"Brayden Reports" folder** has 43 reports (17 actively used) — owned by some Brayden in SF (not necessarily this Brayden).
- Most-used reports cluster around 4 themes: pipeline / renewals / MQL+SQL / closed-won bookings.
- 100s of reports owned by departed users (Mel, Sean, Abby, Ari) are abandoned.

---

## Volumes by year (the trends)

### Opportunities created (close date)

| Year | Count |
|---|---|
| 2020 | 97 |
| 2021 | 242 |
| 2022 | 388 |
| 2023 | 388 |
| 2024 | 373 |
| 2025 | 418 |
| **2026 YTD (Apr 15)** | **262 — pace of ~785** (highest year ever) |

### Tasks created

| Year | Count |
|---|---|
| 2020 | 87 |
| 2021 | 459 |
| 2022 | 8 (lull) |
| 2023 | 246 |
| 2024 | 223 |
| **2025** | **4,272** (17× jump) |
| 2026 YTD | 1,330 (pace ~4,000) |

The 2025 task explosion is unexplained — needs investigation with Brayden.

### Win rate

1,241 won / 2,040 closed = **60.8% win rate.** Healthy.

---

## What's NOT in SF (i.e., new capabilities the new CRM can offer)

- Email logging (0 EmailMessage records)
- Sequences / outbound cadences
- Built-in renewals queue (it's a saved report today)
- Partners as a first-class entity (not just text fields on Account)
- Custom fields admin UI
- Audit log as a built-in admin tab
- PandaDoc contract sync
- Properly-sorted "oldest"/"newest" opp lookups for lifecycle dates

---

## Cross-references

- **`raw/00-landscape.json`** — top-level metadata snapshot
- **`raw/01-flows-inventory.json`** — flow definitions list
- **`raw/02-flows-metadata-parsed.md`** — full flow documentation
- **`raw/02-flows-metadata-raw.json`** — raw flow XML metadata
- **`raw/03-apex-and-rules.json`** — Apex / triggers / rules inventory
- **`raw/04-objects-and-fields.md`** — bespoke fields by object
- **`raw/05-integrations.md`** — Connected Apps, packages, remote sites
- **`raw/06-people-and-permissions.md`** — users, profiles, permsets, queues
- **`raw/07-reports-and-dashboards.md`** — reports & dashboards inventory
- **`raw/08-data-shape.md`** — picklists, volumes, pricing structure
- **`raw/09-activities-and-content.md`** — tasks, events, email, campaigns, knowledge
- **`raw/10-staging-crm-map.md`** — staging CRM schema map
