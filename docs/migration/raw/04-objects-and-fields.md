# Custom Objects & Custom Fields - Bespoke Inventory

Generated 2026-04-15. Filtering out managed-package noise (`pi` Pardot, `HubSpot_Inc`).

## Headline finding

**Of 21 "custom objects" originally counted, ZERO are truly bespoke.** All 20 named-package objects are managed (Pardot/HubSpot/etc), and the only "Knowledge" entity is `Knowledge__kav` — the standard Salesforce Knowledge article object — with two custom fields (`Question__c`, `Answer__c`) tacked on.

**Of 203 "custom fields", ~96 are bespoke** — the rest are added by Pardot/HubSpot packages on standard objects.

> **Correction (2026-04-15):** an earlier draft listed `Knowledge__c` as a bespoke custom object. That was wrong — `Knowledge__c` does not exist. The correct entity is `Knowledge__kav` (standard SF Knowledge), with two extra custom fields. The Knowledge license isn't granted to API queries, so a record count couldn't be retrieved. Likely zero or single-digit articles in actual use. See `09-activities-and-content.md` for full details.

## Knowledge configuration (standard SF object + 2 custom fields)

| Object | Fields added | Likely purpose |
|---|---|---|
| `Knowledge__kav` (standard SF Knowledge) | `Question__c`, `Answer__c` | FAQ / knowledge base. Two-field design suggests minimal use. **Verify if actively used; if not, drop entirely.** |

## Bespoke fields by standard object

### Account (24 bespoke fields)
- **Lifecycle:** `Active_Since__c` (date — auto-set by Set_FTEs flow), `Status__c` (Active/Inactive — drives churn flow), `Renewal_Type__c`, `Auto_Renewal` (on Opp)
- **Sizing:** `FTEs__c` (auto-tier from NumberOfEmployees), `FTE_Range__c`, `Number_of_Providers__c`, `Locations__c`, `Every_Other_Year__c`
- **Financial:** `ACV__c`, `Lifetime_Value__c`, `Churn_Amount__c`, `Churn_Date__c`, `Contracts__c`
- **Account Mgmt:** `Account_Number__c`, `Next_Steps__c`, `Project__c`, `Priority_Account__c`, `Time_Zone__c`
- **Partner:** `Partner_Account__c`, `Partner_Prospect__c`, `Partner_Source__c`, `Referring_Partner__c`
- **Other:** `Do_Not_Contact__c`, `Copy_Billing_Address_to_Shipping_Address__c` (workflow trigger, can drop)

### Contact (~25 bespoke; many `pi__` Pardot fields excluded)
- **Lifecycle:** `Archived__c`, `Do_Not_Contact__c`, `Days_Since_Last_Activity__c`, `Type__c`, `Primary_Contact__c`, `Business_Relationship_Tag__c`
- **Sales qualification:** `MQL__c`, `SQL__c`, `Credential__c`
- **Contact info:** `Phone_Ext__c`, `LinkedIn_Profile__c`, `Time_Zone__c`, `Number_of_Locations__c`
- **Notes/follow-up:** `Next_Steps__c`, `Sales_Notes__c`, `Events__c`, `Do__c`, `Partner_Source__c`, `Opportunity_ContractId__c`

### Lead (~19 bespoke)
- `Business_Relationship_Tag__c`, `Credential__c`, `Do_Not_Market_To__c`, `Events__c`, `LinkedIn_Profile__c`, `MQL__c`, `Partner_Source__c`, `Phone_Ext__c`, `Priority_Lead__c`, `Project__c`, `Time_Zone__c`, `Type__c`
- (Also extensive `pi__` Pardot tracking fields: utm, campaign, score, grade, conversion data, etc.)

### Opportunity (15 bespoke)
- **Renewal/contract:** `Auto_Renewal__c`, `Contract_Length__c`, `Contract_Year__c`, `Created_by_Automation__c`, `Cycle_Count__c`, `Maturity_Date__c`, `Start_Date__c`, `One_Time_Project__c`
- **Pricing/discount:** `Discount__c`, `Subtotal__c`, `Payment_Frequency__c`, `Promo_Code__c`
- **Sizing:** `FTE_Range__c`, `FTEs__c`
- **Workflow:** `Follow_Up__c`

### OpportunityLineItem (2 bespoke)
- `Product_Category__c` (drives Opportunity_Update_Name flow)
- `CategorySort__c`

### Product2 (4 bespoke)
- `Category__c`, `CategorySort__c`, `Service_Product__c`, `Service_Type__c`

### Case (4 bespoke)
- `Assigned_NVA__c`, `Definitions__c`, `Next_Steps__c`, `Partner__c`

### Campaign (managed pkg only — no bespoke)
### CampaignMember (1 bespoke: `Attended__c`)

## Implications for new CRM schema

### Tables needed
1. **accounts** — must include all 24 bespoke fields above
2. **contacts** — must include ~25 bespoke fields
3. **leads** — must include ~19 bespoke fields  *(consider: do you need a separate leads table, or merge with contacts?)*
4. **opportunities** — must include 15 bespoke fields including the renewal-flow-critical ones
5. **opportunity_line_items** — Product_Category and CategorySort
6. **products** — Category, CategorySort, Service_Product, Service_Type
7. **cases** — 4 bespoke fields
8. **campaigns** + **campaign_members** — small surface area
9. **knowledge** (only if Brayden confirms actual usage): Question, Answer  *(very likely droppable — `Knowledge__kav` is the standard SF Knowledge object with two custom fields; the SF Knowledge license isn't even granted to API queries here, suggesting near-zero use)*

### Fields that exist solely to feed automations (consider dropping or replacing)
- `Account.Copy_Billing_Address_to_Shipping_Address__c` — drives the workflow rule. Drop in new CRM (just don't have a separate shipping address, or copy in form).
- `Account.FTE_Range__c` and `Opportunity.FTE_Range__c` — likely formula fields that bucket FTE counts. Could be a generated column or computed at read time.
- `Account.Active_Since__c` and churn fields — auto-set by Set_FTEs flow. Can be views over opportunities.
- `Opportunity.Created_by_Automation__c` — true if created by renewal flow. Useful flag; keep but rename to `is_auto_renewal_generated`.
- `Opportunity.Cycle_Count__c` and `Contract_Year__c` — only meaningful in 3-year contract context. Consider modeling as a separate `contract_cycle` association.
