# Must Replicate — Salesforce Behavior That Has to Survive Migration

These are the SF capabilities that real users depend on day-to-day and that the new CRM **cannot ship without**. Each item lists what it is, why it matters, and what specifically needs to land in the new CRM.

---

## 1. Renewal opportunity generation

- **What:** Daily automated creation of renewal opportunities for closed-won deals approaching their anniversary.
- **Why critical:** Existing Business (renewals) is 977 of 2,207 opportunities (~44%). The flow ran on auto-pilot for years; if it stops, the renewal pipeline silently disappears.
- **What to build:** See `renewal-flow-spec.md` for full spec.
- **Acceptance:** Backfill produces a renewal opp for every recent eligible closed-won opp; daily job is idempotent; honors `every_other_year` and `renewal_type='no auto renew'`.

## 2. Renewal reminder task (60 days before maturity)

- **What:** Auto-create a Task on the opp owner 60 days before the maturity date, unless an open opp already exists.
- **Why critical:** Sales reps rely on this nudge. Without it, owners forget about upcoming renewals until they've expired.
- **What to build:** See `renewal-flow-spec.md` section 3b.

## 3. The 7 active human users with their roles

| User | SF Profile | New CRM role |
|---|---|---|
| James Parrish | System Administrator | admin |
| Rachel Kunkel | System Administrator | admin |
| Joe Gellatly | System Administrator | admin |
| Summer Hume | Standard User | user |
| Molly Miller | Standard User | user |
| Jordan Scherich | Standard User | user |
| Margaret Karatzas | Standard User | user |

Plus **Brayden Frost** (admin in staging; not currently in SF).

## 4. Account → Contact → Opportunity core data

The bread-and-butter of the CRM. Specifically:

- **5,642 Accounts** (315 Active + 170 Inactive + 39 Pending + 38 Discovery + 5,080 Prospect/null)
- **Contacts:** all (record count not separately captured but should be in 00-landscape.json)
- **2,207 Opportunities** with the 15 bespoke fields
- **2,579 OpportunityLineItems** across 1,253 opps

Migration mapping rules:

- Account.Status NULL → `lifecycle_status = 'prospect'` (or move to a separate `companies` table)
- Opportunity.Stage: collapse SF's 6 stages to staging's 6 (see `gap-analysis.md` stages mapping)
- Opportunity.Type: normalize the 640 default-value `"Opportunity"` rows to `"Renewal"` if matching an existing-business pattern, else `"New"`
- OpportunityLineItem: re-map SKU name → (staging product, FTE tier) via crosswalk
- Account.Industry: collapse `Hospital` + `Hospital & Health Care`, drop lowercase `information technology & services`, dedupe Computer Software/Technology

## 5. Opportunity.Created_by_Automation flag + reporting

- Brayden monitors the renewal flow's output via the "Created by Automation" report (run 2x recently, in his folder).
- The new CRM must (a) set this flag on auto-generated renewals and (b) provide an equivalent report/view.

## 6. The 6-stage opportunity funnel (mapped to staging's 6 stages)

| SF | → | Staging |
|---|---|---|
| Closed Won | → | Closed Won |
| Closed Lost | → | Closed Lost |
| Proposal Conversation | → | Proposal |
| Proposal and Price Quote | → | Proposal |
| Details Analysis | → | Qualified |
| Demo | → | Qualified |

Don't redesign the sales process during migration. Replicate, then iterate.

## 7. The ~20-30 active reports / dashboards

These are the actively-used reporting surfaces. Reproduce them as built-in views/dashboards:

**Pipeline:**
- Open Renewal Opportunities (the canonical renewal pipeline)
- Opportunity Pipeline - Open
- HomePage - All Pipeline - Current Year
- Sales Open Opportunities for Quarter

**Closed-Won / Revenue:**
- Closed Won New Opportunities for Quarter
- Closed Won Existing Business for Quarter
- Closed Won New Vs Renewal For Dashboard
- Current Quarter Closed Won by Owner (per-owner variants)
- ARR
- Avg Deal Size, Avg Deal Length

**Marketing qualification:**
- Marketing Qualified Leads / Contacts
- SQLs for Quarter
- SQL Monthly Report

**Customer / churn:**
- Inactive Clients per quarter
- Closed Lost
- Active Customers (by various dimensions)
- Q4 Open Renewal Opportunities
- Open Renewal Opportunities by Quarter

**Audit:**
- Created by Automation (Brayden's monitor)
- "Do Not Market To" Report (compliance)

**Active dashboards to reproduce:**
- Bullpen Dashboard (most recent)
- Growth/Sales Dashboard
- Lead Source Dashboard
- Product Growth YoY $ & %

## 8. The Discount → Line Item propagation behavior

SF has two flows that ensure every "Products" family line item reflects the opp-level Discount__c:

- `Apply_Opportunity_Discount_To_New_Opp_Product` (when adding a new product line)
- `Apply_Opportunity_Discount_to_Products_Not_Services` (when changing the opp-level discount)

**Replication strategy:** make this a property of the read model, not a write trigger. Compute line discount at read time (`COALESCE(line.discount_override, opp.discount)` for "Products" family). Don't store denormalized values that need maintenance.

## 9. FTE tier → pricing relationship

The FTE tier on an Account/Opportunity determines pricing. Today the SF `Set_FTEs_for_Account` flow auto-buckets `NumberOfEmployees` into one of 11 tiers (1-20, 21-50, ..., 5001-10000). The new CRM has 3 products with "Per FTE" pricing, so the bucketing is implicit.

**Must replicate:** the auto-bucketing trigger on Account when `NumberOfEmployees` changes, so opps inherit the right tier.

## 10. Account.Status lifecycle — DERIVED, not manually set

**Critical rule (confirmed with Brayden 2026-04-16):** lifecycle_status must be derived automatically from deal + product history. No user ever sets it manually (except override). See `account-status-derivation-spec.md` for full spec.

Summary:

- **Active** if any currently-held product subscription is active (most recent deal on that product is Closed Won, not expired, not superseded by a Closed Lost on the same product).
- **Inactive** only when every product bought has expired unrenewed OR been lost without replacement.
- A Closed Lost pitching a NEW product on top of an existing active subscription does NOT demote the account.
- Also derives `Active_Since` (oldest Closed Won) and `Churn_Date` / `Churn_Amount` (most recent Closed Won when transitioning to Inactive) — use `ORDER BY close_date` with proper direction, unlike the SF Set_FTEs flow which has a bug (no ORDER BY at all).

This is BOTH a one-time import backfill (the 5,080 NULL SF accounts + the 485 with potentially-stale Status values) AND an ongoing automation (triggered by opp/line-item changes + daily sweep for maturity_date rolling past today).

Staging's `Closed Won → Active Account` automation covers a partial form of this today but doesn't handle the product-level reasoning or Inactive transitions. Replace with the full derivation.

## 11. Tasks (6,625 records)

**Migrate all tasks.** They represent significant historical activity (especially the 4,272 from 2025).

Schema needed: id, owner_id, related_account_id, related_contact_id, related_opportunity_id, subject, description, due_date, status, priority, created_at.

Drop: `Type` (99% null) and SF-specific fields.

## 12. Activities feed / timeline per record

Every Account / Contact / Opportunity should show a chronological feed of related Tasks, Events, and (when integrations come online) Emails. SF doesn't have this as a single view; staging has an Activities section. **Verify this works against migrated data.**

## 13. The Medcurity Website API

- A bespoke Connected App created 2020-06-23 that the public website uses to push leads/contacts into SF.
- The new CRM must expose an equivalent inbound API endpoint and the website needs to be repointed before SF cutover.
- **Action item: identify what the website calls it as today** (OAuth client ID grep in the website repo).

## 14. Compliance fields

- `Account.Do_Not_Contact__c` and/or `Contact.Do_Not_Contact__c`
- `Lead.Do_Not_Market_To__c` (for CAN-SPAM / GDPR)

These cannot be lost in migration. The "Do Not Market To" Report exists in SF — it must continue to function.

## 15. Pricing / discount / promo code inputs on opportunities

- Subtotal, Discount, Amount (already in staging)
- Promo Code (already in staging)
- Payment Frequency (already in staging)
- Service Amount / Product Amount split (staging has; SF doesn't)

All present and accounted for.

## 16. Partner attribution

- The 2 partners modeled in staging (athenahealth, Cascade Behavioral Health) are real
- SF has Partner_Account__c, Partner_Source__c, Referring_Partner__c, Partner_Prospect__c on Account
- SF has Partner_Source__c on Lead and Contact

Migrate these into the staging Partners entity (one-to-many `account_partners` join).

## 17. The 5 actively-used reports owned by Brayden

These are Brayden's personal working reports — bring them forward as a "Brayden's saved views" starter set:

- Active Customers 030326
- Active Customers by Opportunity 030426
- Active Cx - No Training 031726
- Old Accts to Check as of 031026
- Created by Automation
- (plus 12 more — see `07-reports-and-dashboards.md`)

## 18. Email logging (NEW capability — not in SF today)

SF has 0 EmailMessage records. The staging CRM has Outlook integration available. **Enable it post-cutover** so email correspondence finally gets captured. This is a NEW capability, not a migration.

## 19. Audit trail

SF has Setup → Setup Audit Trail (admin-only). Staging has an Admin → Audit Log. **Verify it captures user actions on records** (create/update/delete) for compliance.
