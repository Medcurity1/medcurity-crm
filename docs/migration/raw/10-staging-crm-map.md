# Staging CRM Schema Map

Source: https://staging.crm.medcurity.com (admin: Brayden Frost, `braydenf@medcurity.com`)
Backend: Supabase (project id `baekcgdyjedgxmejbytc`, derived from in-page localStorage auth token)
Generated 2026-04-15.

## Top-level navigation

The staging CRM exposes the following top-level sections (left nav):

`Home`, `Accounts`, `Contacts`, `Partners`, `Leads`, `Lead Lists`, `Sequences`, `Email Templates`, `Opportunities`, `Pipeline`, `Calendar`, `Activities`, `Products`, `Renewals`, `Reports`, `Forecasting`, `Analytics`, `Archive`, `Admin`.

This is already a more sales-focused IA than the SF default (Pardot-heavy with side-objects bolted on). Notable differences from SF:

- **`Partners` is a first-class section** (not a sub-tag on Account). SF models partners only via `Account.Partner_Account__c` / `Partner_Source__c` / `Referring_Partner__c` boolean+text fields.
- **`Lead Lists`** is its own section — staging treats lead-list management (the SF "lead-source" reality of 4 big purchased lists) as an explicit feature.
- **`Sequences`** exists as a feature — SF has nothing comparable (no Outreach/SalesLoft-style sequencing today).
- **`Renewals`** is its own queue ("Contracts expiring within 120 days") — first-class in staging vs. a derived Brayden-only report in SF.
- **`Forecasting`** is a section — SF uses ad-hoc reports for this.

## Schema by entity

### Account

Fields visible in the staging CRM Create/Edit form, grouped:

- **Identity:** Account Name, Account Type, Account Number, Customer Type, Industry, Website, Parent Account
- **Contact:** Phone, Phone Extension, Billing Address, Shipping Address (separate)
- **Sizing:** FTE Count, FTE Range (likely derived/picklist), Number of Employees, Number of Providers, Number of Locations, Annual Revenue, Timezone
- **Lifecycle:** Active Since, Renewal Type, Every Other Year
- **Contracts (mirrored from SF for now):** Contracts (rollup), Contract Start, Contract End, Contract Length, ACV, Lifetime Value, Churn Amount, Churn Date
- **Partner attribution:** Partner Account, Partner Prospect, Lead Source, Lead Source Detail
- **Workflow:** Priority Account, Project, Description, Notes, Next Steps

**Coverage vs SF Account bespoke fields (24):** the staging Account form already covers virtually all of SF's bespoke Account fields. The only SF-side fields that don't have an obvious staging analog are:

- `Copy_Billing_Address_to_Shipping_Address__c` — this was an SF workflow trigger field, **correctly omitted** in staging (the form should just offer a "copy" button or default).
- `Do_Not_Contact__c` (Account-level) — not surfaced. SF has Do_Not_Contact at both Account and Contact levels; staging may only do it at Contact.
- `Partner_Source__c` and `Referring_Partner__c` — partly subsumed by the dedicated `Partners` section + `Partner Account` reference.

### Contact

Fields visible: First Name, Last Name, Email, Phone, Title, Department, LinkedIn URL, Do Not Contact, MQL Date, SQL Date, Mailing Address.

**Gap vs SF Contact bespoke fields (~25):** staging covers the qualification (`MQL_Date`, `SQL_Date`, `Do_Not_Contact`) and identity bits, but the SF form has many more fields that aren't in the staging Contact UI yet:

- `Archived__c`, `Days_Since_Last_Activity__c` (derived), `Type__c`, `Primary_Contact__c`, `Business_Relationship_Tag__c`
- `Credential__c` (medical credential — relevant given the healthcare audience)
- `Phone_Ext__c`, `Time_Zone__c`, `Number_of_Locations__c`
- `Next_Steps__c`, `Sales_Notes__c`, `Events__c`, `Do__c`, `Partner_Source__c`, `Opportunity_ContractId__c`

**Decision needed for each:** keep, drop, or replace with a different staging primitive (e.g., `Days_Since_Last_Activity__c` should be a computed/view, not a stored column).

### Opportunity

Fields visible: Opportunity Owner, Opportunity Name, Account Name, Type/Kind, Stage, Probability (%), Start Date, Maturity Date, Contract Length, Contract Year, Cycle Count, Auto Renewal, Close Date, Promo Code, Subtotal, Discount, Amount, FTE Range (at time of opp), FTEs (at time of opp), Partner, Team, One Time Project, Created by Automation, Lead Source, Lead Source Detail, Payment Frequency, Follow Up, Next Step, Service Amount, Product Amount, Services Included, Expected Close Date, Description, Notes.

**`Created by Automation` is already a field in staging** — direct analog of `Opportunity.Created_by_Automation__c` in SF. Good.

**STAGES MISMATCH** (critical for migration):

| SF stage | Staging stage | Notes |
|---|---|---|
| (n/a) | Lead | Earlier than SF's funnel start |
| Details Analysis | Qualified | Roughly equivalent |
| Demo | (none) | Drop or fold into Qualified |
| Proposal Conversation | Proposal | Roughly equivalent |
| Proposal and Price Quote | (folded into Proposal?) | Need a mapping rule |
| (n/a) | Verbal Commit | New late-funnel stage |
| Closed Won | Closed Won | Same |
| Closed Lost | Closed Lost | Same |

The renewal flow currently sets `StageName = "Proposal Conversation"` — in staging this should map to `"Proposal"`.

### Lead

Fields visible: First Name, Last Name, Email, Phone, Title, Industry, Website, MQL Date, Description, Company, Employees, Annual Revenue, Address (Street, City, State, Zip, Country).

**Gap vs SF Lead bespoke fields (~19):** staging covers basic + MQL_Date but misses:

- `Business_Relationship_Tag__c`, `Credential__c`, `Do_Not_Market_To__c`
- `Events__c`, `LinkedIn_Profile__c`, `Partner_Source__c`, `Phone_Ext__c`
- `Priority_Lead__c`, `Project__c`, `Time_Zone__c`, `Type__c`
- All `pi__` Pardot tracking fields (utm, score, grade) — these go away with Pardot anyway

### Partner (first-class entity)

Currently 2 partners modeled in staging: `athenahealth`, `Cascade Behavioral Health`.

**This is a structural improvement over SF**, where partners were just text/lookup fields on Account. Suggest the new CRM has:

- `partners` table (master partner directory)
- `account_partners` join (one-to-many) for "this account was sourced through partner X"
- Migrate SF's `Account.Partner_Account__c` and `Referring_Partner__c` into this join

### Product

Currently 3 products modeled: `Assessment Services`, `Policy Management`, `Vendor Risk Program`. All use a "Per FTE" pricing model.

**Drastic simplification vs SF's 155 SKUs across 11 FTE tiers.** Staging has already adopted the right pattern (one product × FTE-tier pricing function), avoiding the SF anti-pattern of duplicating each product 11 times.

**Migration implication:** the SF→staging product mapping is many-to-few. Need a SKU-name → (staging_product, FTE_tier) crosswalk before migrating opportunity line items.

### Renewals

Renewals is a built-in queue: "Contracts expiring within 120 days." This is the staging analog of SF's `"Open Renewal Opportunities"` report (Brayden's most-used report).

### Sequences, Email Templates

Staging has scaffolding for outbound sequences and email templates. SF has 21 email templates, only 2 ever used. **Don't migrate the SF templates** — let staging be the new home.

## Admin features

Visible Admin tabs: `Custom Fields`, `Users`, `Permissions`, `Required Fields`, `Integrations`, `Automations`, `Data Import`, `Audit Log`, `Data Health`, `System`.

### Admin → Custom Fields

Currently 0 custom fields defined. Staging supports custom fields but Brayden hasn't added any. **The 96 bespoke SF fields are the seed list for this UI** — many can be skipped (workflow-only or computed), but ~60 need to land here.

### Admin → Automations

**Renewal Automation (built-in, configurable):**

> "Automatically generates renewal opportunities for closed-won deals whose contract end date is approaching. Runs daily at 09:00 UTC and can be triggered manually. Accounts with renewal type 'no auto renew' are skipped."

- Configurable lookahead window
- Last run: **Never** (not yet enabled)

**Process Automations (1 active):**

- `Closed Won → Active Account` — updates `accounts.lifecycle_status` when an opp closes won. SF has no exact analog; this replaces Brayden's manual `Set_FTEs_for_Account` "set Active Since" logic with a clean post-close trigger.

**Quick-Start Templates (4 available, not all enabled):**

1. Closed Won → Active Account
2. Closed Won → Follow-up Task
3. Qualified Lead → Schedule Demo
4. Contract Expiring → Renewal Reminder  ← staging analog of `Send_Notification_for_Renewal_Opportunity` in SF

### Admin → Integrations

Integrations available in staging (none connected as of 2026-04-15):

- **Outlook** (email logging) — Not Connected. Staging would log inbound/outbound emails to contact/account/opportunity. SF has 0 EmailMessage records, so this would be a NEW capability post-migration.
- **Gmail** — coming soon.
- **PandaDoc** — contract sync via webhook (not connected). Not present in SF.

**Notably absent:** HubSpot integration. This is the biggest open question — SF currently has bidirectional HubSpot sync via the `HubSpot_Inc` managed package; staging has no HubSpot integration listed. **Brayden needs a strategy.**

### Admin → Users / Permissions

Brayden Frost is admin. SF has 7 active humans (3 admins + 4 standard users) — these need to be invited as staging users at cutover.

### Admin → Data Import / Data Health / Audit Log

Standard admin tooling. The Data Import surface is where the SF migration lands.

## What staging already does BETTER than SF

1. **Products** — 3 products × tier pricing instead of 155 SKUs.
2. **Partners** — first-class entity with its own page, not a text field on Account.
3. **Renewals** — built-in queue instead of a saved report.
4. **Renewal Automation** — designed in (configurable, with skip-if-no-auto-renew), instead of a brittle 115-day exact-match flow.
5. **Sequences** — staging primitive for outbound cadences; SF has nothing.
6. **Email logging via Outlook** — built-in; SF has 0 EmailMessage records (no email-to-SF capture today).
7. **Custom Fields admin UI** — staging exposes a UI for adding custom fields; in SF this required Setup access.
8. **Audit Log** — first-class admin tab; SF requires Setup → Setup Audit Trail.

## What staging is MISSING vs SF (as of today)

1. **HubSpot integration** — biggest gap. SF currently bidirectional with HubSpot via `HubSpot_Inc` package.
2. **Pardot/MCAE integration** — SF has Account Engagement; staging doesn't model marketing automation. Open Brayden question.
3. **Knowledge / FAQ** — staging has no Knowledge section. SF has `Knowledge__kav` (likely zero use, so this is fine).
4. **Cases / Support** — no Cases section in staging nav. SF has 354 cases (mostly closed/old). Verify if support is now in another tool.
5. **Discount propagation logic** — SF has `Apply_Opportunity_Discount_*` flows that propagate Discount__c across line items. Staging needs equivalent or a simpler model (apply discount at opp level, compute line totals on read).
6. **Auto-name from product categories** — SF's `Opportunity_Update_Name` flow auto-names opps from concatenated product categories. Decide whether to port (probably not — it overwrites user names).
7. **Send notification 60-days-before-maturity** — covered by Quick-Start Template #4 if enabled.
8. **Many Contact fields** (~12 not in staging UI yet — see Contact section above).
9. **Several Lead fields** (~10 not in staging UI yet — see Lead section above).
10. **Several Account fields** (Partner_Source, Do_Not_Contact at account-level).

## Implications

The staging CRM is structurally well-modeled but **schema-incomplete** vs SF. Of the 96 bespoke SF fields, roughly:

- **~50 are already in staging** (Account, Opportunity coverage is strong)
- **~25 need to be added** (Contact and Lead are the gaps)
- **~10 are workflow-trigger fields that should be DROPPED** (Copy_Billing_Address_to_Shipping_Address, etc.)
- **~10 should be REPLACED with computed/view columns** (Days_Since_Last_Activity, FTE_Range, Active_Since, churn fields)

Detailed field-by-field gap is in `gap-analysis.md`.
