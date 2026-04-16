# Gap Analysis — Salesforce vs Staging CRM

Field-by-field, feature-by-feature comparison between Salesforce (`medcurity.my.salesforce.com`) and the new Supabase + React staging CRM (`staging.crm.medcurity.com`), as of 2026-04-15.

Legend:

- ✅ **Already in staging** — no action needed.
- 🟡 **Partial** — exists in both but with naming/structural differences.
- ❌ **Missing in staging** — needs to be added or explicitly dropped.
- 🟢 **Better in staging** — improvement over SF; don't replicate the SF version.
- 🔴 **Drop entirely** — SF has it, but it's a workflow-trigger field or computed value that shouldn't survive migration.

---

## Account fields

SF has 24 bespoke fields on Account. Mapping:

| SF field | Staging field | Status | Notes |
|---|---|---|---|
| `Active_Since__c` | Active Since | ✅ | Auto-set in SF by Set_FTEs flow; should be set by staging's `Closed Won → Active Account` automation |
| `Status__c` | (lifecycle_status?) | 🟡 | SF has Active/Inactive/Pending/Discovery/null; staging has lifecycle status implied by automation. Needs explicit picklist. |
| `Renewal_Type__c` | Renewal Type | ✅ | |
| `Auto_Renewal` | (on Opp side) | 🟡 | SF has on Opp; not clear if Account-level too |
| `FTEs__c` | FTE Count | ✅ | Renamed |
| `FTE_Range__c` | FTE Range | ✅ | Picklist; could be derived |
| `Number_of_Providers__c` | Number of Providers | ✅ | |
| `Locations__c` | Number of Locations | ✅ | Renamed |
| `Every_Other_Year__c` | Every Other Year | ✅ | |
| `ACV__c` | ACV | ✅ | |
| `Lifetime_Value__c` | Lifetime Value | ✅ | |
| `Churn_Amount__c` | Churn Amount | ✅ | |
| `Churn_Date__c` | Churn Date | ✅ | |
| `Contracts__c` | Contracts (from SF) | ✅ | Looks like a rollup |
| `Account_Number__c` | Account Number | ✅ | |
| `Next_Steps__c` | Next Steps | ✅ | |
| `Project__c` | Project | ✅ | |
| `Priority_Account__c` | Priority Account | ✅ | |
| `Time_Zone__c` | Timezone | ✅ | |
| `Partner_Account__c` | Partner Account | ✅ | |
| `Partner_Prospect__c` | Partner Prospect | ✅ | |
| `Partner_Source__c` | (Lead Source / Lead Source Detail?) | 🟡 | Possibly subsumed |
| `Referring_Partner__c` | (via Partners section) | 🟢 | Replaced by first-class Partners entity |
| `Do_Not_Contact__c` | (Contact-level only?) | ❌ | Not seen on Account form. Decide: keep account-level or only contact-level. |
| `Copy_Billing_Address_to_Shipping_Address__c` | (n/a) | 🔴 | SF-workflow trigger field — **drop** |

**Account form coverage: ~22 of 24 → ~92% complete.** Add `Do_Not_Contact` (account-level) if needed.

---

## Contact fields

SF has ~25 bespoke Contact fields. Staging has ~10 visible. Mapping:

| SF field | Staging field | Status | Notes |
|---|---|---|---|
| (FirstName/LastName/Email/Phone/Title) | First Name / Last Name / Email / Phone / Title | ✅ | Standard |
| (Department) | Department | ✅ | Standard |
| `LinkedIn_Profile__c` | LinkedIn URL | ✅ | Renamed |
| `Do_Not_Contact__c` | Do Not Contact | ✅ | |
| `MQL__c` | MQL Date | 🟡 | SF has boolean+date; staging has Date only — confirm |
| `SQL__c` | SQL Date | 🟡 | Same |
| (MailingAddress) | Mailing Address | ✅ | Standard |
| `Archived__c` | (none) | ❌ | Add or use a hidden status |
| `Days_Since_Last_Activity__c` | (none) | 🔴 | Computed value — should be a view, not a stored column |
| `Type__c` | (none) | ❌ | What types? Unknown. Verify with Brayden |
| `Primary_Contact__c` | (none) | ❌ | Add as boolean per account |
| `Business_Relationship_Tag__c` | (none) | ❌ | Likely a categorization picklist; values unknown |
| `Credential__c` | (none) | ❌ | Medical credential (e.g. MD, RN, CHC). Add — relevant in healthcare audience |
| `Phone_Ext__c` | (none) | ❌ | Add as separate field next to Phone |
| `Time_Zone__c` | (none) | ❌ | Add (Account also has it) |
| `Number_of_Locations__c` | (none) | ❌ | Likely redundant w/ Account.Locations — DROP at contact level |
| `Next_Steps__c` | (none) | ❌ | Add (or use Tasks instead) |
| `Sales_Notes__c` | Notes? | 🟡 | Verify |
| `Events__c` | (none) | ❌ | Unclear what this is — verify with Brayden |
| `Do__c` | (none) | ❌ | Cryptic name — likely abandoned. Probably drop |
| `Partner_Source__c` | (via Partners section) | 🟢 | Subsumed by first-class Partners |
| `Opportunity_ContractId__c` | (none) | 🔴 | This is a denormalized join field; let the join table handle it |

**Contact form coverage: ~10 of 25 → ~40% complete.** This is the biggest schema gap.

**Recommended additions to staging Contact form:** Credential, Phone Ext, Time Zone, Type, Primary Contact (boolean), Business Relationship Tag, Archived (or status enum).

**Recommended drops:** Days_Since_Last_Activity (compute), Number_of_Locations (Account-level), Do (cryptic), Opportunity_ContractId (denormalized).

---

## Lead fields

SF has ~19 bespoke Lead fields. Staging has ~10 visible.

| SF field | Staging field | Status | Notes |
|---|---|---|---|
| (FirstName/LastName/Email/Phone/Title) | (same) | ✅ | Standard |
| `Industry` | Industry | ✅ | Standard |
| `Website` | Website | ✅ | Standard |
| `Company` | Company | ✅ | Standard |
| `NumberOfEmployees` | Employees | ✅ | Standard |
| `AnnualRevenue` | Annual Revenue | ✅ | Standard |
| (Address) | Address (Street/City/State/Zip/Country) | ✅ | Standard |
| `Description` | Description | ✅ | |
| `MQL__c` | MQL Date | 🟡 | Confirm |
| `Business_Relationship_Tag__c` | (none) | ❌ | Add (also on Contact) |
| `Credential__c` | (none) | ❌ | Add (also on Contact) |
| `Do_Not_Market_To__c` | (none) | ❌ | Important: this is a GDPR/CAN-SPAM flag. **MUST add.** |
| `Events__c` | (none) | ❌ | Verify |
| `LinkedIn_Profile__c` | (none) | ❌ | Add |
| `Partner_Source__c` | (via Partners?) | 🟡 | Likely covered |
| `Phone_Ext__c` | (none) | ❌ | Add |
| `Priority_Lead__c` | (none) | ❌ | Add |
| `Project__c` | (none) | ❌ | Add (also on Account) |
| `Time_Zone__c` | (none) | ❌ | Add |
| `Type__c` | (none) | ❌ | Verify |
| All `pi__*` Pardot fields (utm, score, grade, etc.) | (none) | 🔴 | Drop with Pardot |

**Lead form coverage: ~10 of 19 → ~50% complete.**

**Critical add: `Do_Not_Market_To`** for compliance.

---

## Opportunity fields

SF has 15 bespoke Opportunity fields. Staging covers them all and adds more.

| SF field | Staging field | Status | Notes |
|---|---|---|---|
| `Auto_Renewal__c` | Auto Renewal | ✅ | |
| `Contract_Length__c` | Contract Length | ✅ | |
| `Contract_Year__c` | Contract Year | ✅ | |
| `Created_by_Automation__c` | Created by Automation | ✅ | |
| `Cycle_Count__c` | Cycle Count | ✅ | |
| `Maturity_Date__c` | Maturity Date | ✅ | |
| `Start_Date__c` | Start Date | ✅ | |
| `One_Time_Project__c` | One Time Project | ✅ | |
| `Discount__c` | Discount | ✅ | |
| `Subtotal__c` | Subtotal | ✅ | |
| `Payment_Frequency__c` | Payment Frequency | ✅ | |
| `Promo_Code__c` | Promo Code | ✅ | |
| `FTE_Range__c` | FTE Range (at time of opp) | ✅ | Snapshot at opp creation — good |
| `FTEs__c` | FTEs (at time of opp) | ✅ | Snapshot |
| `Follow_Up__c` | Follow Up | ✅ | |

**Plus staging has fields SF doesn't:** Service Amount, Product Amount, Services Included, Expected Close Date, Team, Partner (lookup).

**Opportunity coverage: 15 of 15 → 100%. Plus extras.**

**The one structural difference is the Stages picklist:**

| SF stage | Count | Staging stage | Mapping |
|---|---|---|---|
| Closed Won | 1,241 | Closed Won | direct |
| Closed Lost | 799 | Closed Lost | direct |
| Proposal Conversation | 104 | Proposal | direct |
| Details Analysis | 34 | Qualified | direct |
| Proposal and Price Quote | 21 | Proposal | merge into Proposal |
| Demo | 8 | Qualified | merge into Qualified |
| (n/a — staging only) | n/a | Lead | new |
| (n/a — staging only) | n/a | Verbal Commit | new |

**Migration mapping rule:** SF's two intermediate proposal stages collapse to staging's `Proposal`; SF's `Demo` collapses to `Qualified`.

---

## OpportunityLineItem fields

SF has 2 bespoke fields:

| SF field | Staging field | Status |
|---|---|---|
| `Product_Category__c` | (need to verify) | 🟡 |
| `CategorySort__c` | (need to verify) | 🟡 |

Both feed the SF `Opportunity_Update_Name` flow, which auto-renames opps from concatenated categories. **Recommendation:** drop both. Don't replicate the auto-rename behavior.

---

## Product2 fields

SF has 4 bespoke fields:

| SF field | Staging | Status |
|---|---|---|
| `Category__c` | (Per FTE pricing model) | 🟢 |
| `CategorySort__c` | (n/a) | 🔴 |
| `Service_Product__c` | (Per FTE) | 🟢 |
| `Service_Type__c` | (Per FTE) | 🟢 |

Staging has rebuilt products entirely (3 products with FTE-tier pricing). The SF anti-pattern of 155 SKUs across 11 FTE tiers is gone. **No migration of SF Product2 records — just establish a SKU-name → (staging_product, FTE_tier) crosswalk for migrating opportunity line items.**

---

## Case fields

SF has 4 bespoke Case fields:

| SF field | Staging | Status |
|---|---|---|
| `Assigned_NVA__c` | (no Cases section) | ❌ |
| `Definitions__c` | (no Cases section) | ❌ |
| `Next_Steps__c` | (no Cases section) | ❌ |
| `Partner__c` | (no Cases section) | ❌ |

**Cases is missing from staging entirely.** SF has 354 cases over 5+ years (~70/year). Decision needed: are cases handled in another tool now (Zendesk, Intercom, Front)? If yes, drop. If still needed, add a Cases section to staging.

---

## CampaignMember fields

SF has 1 bespoke: `Attended__c`. **Staging has no Campaigns section** — drop unless campaigns are needed.

---

## Other entities

| SF entity | Records | Staging | Action |
|---|---|---|---|
| Knowledge (`Knowledge__kav` + Question/Answer) | unknown (license issue) | (none) | Drop unless Brayden confirms use |
| Email Templates | 21 (only 2 ever used) | Email Templates section | Don't migrate; let staging be the new home |
| Campaigns | 8 (mostly tests) | (none) | Drop |
| EmailMessage | 0 | (Outlook integration available) | Forward-going only — no email history to migrate |
| Tasks | 6,625 | Activities section | **Migrate.** Note 99% have NULL Type — don't carry the type field |
| Events | 129 | Calendar section | Migrate |
| ContentDocument (files) | 160 | (verify staging upload support) | Decide: migrate small set or skip |
| ContentNote (notes) | 1 | (n/a) | Drop |

---

## Integrations comparison

| Integration | SF | Staging | Strategy |
|---|---|---|---|
| HubSpot | ✅ Bidirectional via `HubSpot_Inc` package | ❌ Not present | **BIGGEST OPEN QUESTION.** Either build native HubSpot connector for staging, or rely on HubSpot's outbound webhooks |
| Pardot / MCAE | ✅ `pi` package, fully active | ❌ Not present | Decide: keep Pardot post-cutover (needs Postgres sync), or migrate marketing automation to HubSpot |
| Outlook | ❌ | ✅ Available, not connected | Enable post-cutover for email logging (NEW capability) |
| Gmail | ❌ | 🟡 Coming soon | |
| PandaDoc | ❌ | ✅ Available, not connected | Enable for contract sync (NEW capability) |
| Medcurity Website API | ✅ Bespoke Connected App (since 2020) | ❌ Not present | Need to repoint the website at the new CRM's API. Build inbound endpoint in staging. |
| Sales Insights (OIQ) | ✅ Installed, ❓ used | ❌ | Drop (likely unused in SF anyway) |

---

## People & permissions

| | SF | Staging |
|---|---|---|
| Active human users | 7 (3 admin + 4 standard) | 1 (Brayden) — must invite the other 7 at cutover |
| Profiles | 22 (5 used) | Permissions section in Admin |
| Permission sets | 88 (18 custom) | (verify) |
| Queues | 2 (MCAE, Support) | (n/a unless Cases come back) |
| User roles | 0 (PE limitation) | (n/a — flat is fine) |
| Sharing rules | 0 (PE limitation) | (n/a) |

**Migration is trivial:** 7 humans to invite, 2-role permission model (admin/user).

---

## Reports & dashboards

| | SF | Staging |
|---|---|---|
| Reports | 710 (only 66 run in last 90d) | Reports section |
| Dashboards | 26 (~6 active) | Analytics section |
| List views | 112 | (saved views — verify) |

**Strategy:** Don't try to replicate 710 reports. Reproduce ~20-30 actively-used Brayden reports as built-in views/dashboards. See `reports-and-dashboards.md` for the must-have list.

---

## Summary table

| Area | Coverage | Critical adds |
|---|---|---|
| Account fields | 22/24 (92%) | Do_Not_Contact (account-level) |
| Contact fields | 10/25 (40%) | Credential, Phone_Ext, Time_Zone, Type, Primary_Contact, Business_Relationship_Tag, Archived |
| Lead fields | 10/19 (53%) | **Do_Not_Market_To (compliance!)**, Credential, LinkedIn, Phone_Ext, Priority_Lead, Project, Time_Zone, Type |
| Opportunity fields | 15/15 (100%) | None — staging is more complete than SF |
| OpportunityLineItem | 0/2 | Drop both |
| Product2 | n/a | Already redesigned in staging |
| Cases | 0 | Decision: keep or drop |
| Campaigns | 0 | Drop |
| Knowledge | 0 | Drop unless verified |
| Stages picklist | 6/6 mapped (collapse 2) | Migration mapping rule |
| HubSpot integration | ❌ | **BUILD** |
| Pardot integration | ❌ | DECISION |
| Website API | ❌ | **BUILD** |
| Outlook | 🟢 | Enable post-cutover |
| PandaDoc | 🟢 | Enable post-cutover |
| Renewal automation | 🟢 (designed in) | **WIRE UP** per `renewal-flow-spec.md` |

---

## Total work to bring staging to SF parity

- **~25 fields to add** across Contact (15), Lead (8), Account (1-2)
- **2 integrations to BUILD** (HubSpot, Website API)
- **1 integration decision** (Pardot)
- **1 automation to WIRE UP** (Renewal — see `renewal-flow-spec.md`)
- **2 fields to DROP from migration consideration** (OpportunityLineItem.Product_Category__c, CategorySort__c)
- **1 picklist mapping rule** (Opportunity stages)
- **1 SKU crosswalk** (155 SF SKUs → 3 staging products + FTE tier)
- **1 picklist cleanup** (Industry duplicates: Hospital vs. Hospital & Health Care, etc.)
- **6 humans to invite**
- **20-30 reports to reproduce as views/dashboards**
- **710 reports / 21 email templates / 8 campaigns to NOT migrate**

**Net assessment:** the staging CRM is closer to ready than the SF surface area suggests. Most of the work is on Contact/Lead schema completeness and the HubSpot/Website-API integrations.
