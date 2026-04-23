# Flow Metadata - All Bespoke Active Flows + Renewal v5 Draft

Generated 2026-04-15 by reading Flow.Metadata via Tooling API. For each flow: trigger, variables, formulas, lookups, decisions, assignments, loops, record creates/updates, action calls.

---

## Renewal_Opportunity_2_No_Products v4 ACTIVE

- **Id:** `301RO00000av0RaYAI`
- **Process type:** AutoLaunchedFlow, API v63
- **Description:** "Fixing 3 year contract pull back (1 month)"

### Trigger / Start
- **triggerType: Scheduled**  ← runs on a schedule, NOT record-triggered
- start → `GetOpportunity`

### Variables
- `AccountEveryOtherYear`: String, output  *(captured from Account but never used in v4 logic — orphan)*
- `AccountRenewalType`: String, output  *(captured from Account but never used in v4 logic — orphan)*
- `AccountStatus`: String, output  *(captured from Account but never used in v4 logic — orphan)*
- `MatchedPriceBookId`: String  *(declared, never set or used)*

### Formulas
- `DaysUntilAnniversaryCloseDate` (Number) = days between TODAY and (CloseDate + 1 year), with leap-year fix (Feb 29 → March 1)
- `NewCloseDate` (Date) = CloseDate + 12 months. **Special case:** if 3-year contract AND newContractYear="Year 2" AND cycleCount=1, use +11 months instead (this is the "pull back 1 month" fix from the description)
- `NewContractYear` (String) = if 3-year contract: cycle Year 1→2, 2→3, 3→1; else "Year 1"
- `NewCycleCount` (Number) = increments cycle count when starting a new 3-year cycle
- `TodayDate` (Date) = TODAY()

### Record Lookups
- `GetOpportunity` from Opportunity, filters: `CloseDate < TodayDate AND StageName = "Closed Won"` → next: `Check_if_Opportunities_Found`
- `GetAccount` from Account, first only, filters: `Id = Loop_Through_Opportunities.AccountId AND Status__c = "Active"` → `Assign_Account_Level_Variables`

### Decisions
- `Check_if_Opportunities_Found`: if any opps found → `Loop_Through_Opportunities`
- `Should_We_Create_Renewal`:
  - rule `Within_105_Day_Window`: `DaysUntilAnniversaryCloseDate == 115` (note: rule named "105" but value is 115) → `GetAccount`
  - default → `Loop_Through_Opportunities` (skip this opp)

### Assignments
- `Assign_Account_Level_Variables`: copies Account fields to vars (these vars are never used downstream in v4)
  - `AccountRenewalType = GetAccount.Renewal_Type__c`
  - `AccountStatus = GetAccount.Status__c`
  - `AccountEveryOtherYear = GetAccount.Every_Other_Year__c`
  - → `Create_Renewal_Opportunity`

### Loops
- `Loop_Through_Opportunities` over `GetOpportunity` collection → next: `Should_We_Create_Renewal`

### Record Creates
- `Create_Renewal_Opportunity` on Opportunity, copies the following fields from the original closed-won opp:
  - `AccountId`, `Amount`, `Description`, `Discount__c`, `LeadSource`, `Name`, `NextStep`, `OwnerId`, `Payment_Frequency__c`, `Subtotal__c`, `Contract_Length__c`
  - And sets:
    - `CloseDate = NewCloseDate` (rolled forward, with 3-yr-contract pull-back logic)
    - `Contract_Year__c = NewContractYear`
    - `Cycle_Count__c = NewCycleCount`
    - `Created_by_Automation__c = true`
    - `StageName = "Proposal Conversation"`
    - `Type = "Existing Business"`
  - → loop back to `Loop_Through_Opportunities`

### CRITICAL ISSUES (open questions for Brayden)
1. **Brittle 115-day window**: trigger fires only when `DaysUntilAnniversaryCloseDate == 115` exactly. If the scheduled flow misses a day (org maintenance, scheduler hiccup), the opp is never renewed. **There is no catch-up logic.**
2. **No idempotency check**: nothing checks "does a renewal opp already exist for this account/cycle?" before creating one. If the flow runs twice on the same day, or if someone manually creates a renewal before the flow fires, you'll get duplicates.
3. **Account.Renewal_Type__c, Status__c, Every_Other_Year__c are queried but unused.** The `Should_We_Create_Renewal` decision doesn't reference Account.Status (only the GetAccount lookup filters by `Status__c="Active"`), and Renewal_Type/EveryOtherYear are completely orphaned. Looks like incomplete logic — was probably intended to skip non-renewing accounts or honor every-other-year cycles. **The "every other year" logic is NOT implemented.**
4. **Closed Lost opps are silently skipped** (good), but **no logic for opps that were Closed Won but customer is now churned**. The `Status__c = "Active"` filter on Account lookup catches this implicitly.
5. **Schedule details unknown from metadata** — need to check Flow Trigger Explorer or scheduled job entry to know cadence and start time.

---

## Renewal_Opportunity_2_No_Products v5 DRAFT (not active)

- **Id:** `301RO00000jxZb3YAE`
- **Description:** "Attempt to add products to the flow."
- Same trigger/structure as v4. Brayden was iterating to also copy OpportunityLineItems on renewal but never finished/activated it.
- **OPEN QUESTION:** Should renewal opps copy product lines? Currently they don't, which means after renewal you have an opp with `Amount` and `Subtotal__c` but no line items. That's likely why this draft exists.

---

## Send_Notification_for_Renewal_Opportunity v4 ACTIVE

- **Id:** `3015w000000nNKWAA2`
- **Process type:** AutoLaunchedFlow, API v58
- **Trigger:** Scheduled, on Opportunity, filter: `StageName = "Closed Won"`

### Logic
- Formulas:
  - `MaturityDateMinus60 = $Record.Maturity_Date__c - 60`
  - `TodayPlus60 = $Flow.CurrentDate + 60` (declared but unused)
- Decision `Check_if_Maturity_Date_is_2_Months_Away`: if `$Flow.CurrentDate == MaturityDateMinus60` (i.e., today is exactly 60 days before this opp's Maturity_Date__c) → continue
- Lookup `Get_Open_Opportunity`: find any opp on the same Account with stage NOT IN (Closed Won, Closed Lost) — i.e., is there already an open renewal/expansion?
- Decision `Does_Open_Opportunity_Exist`:
  - Yes → (no action — flow ends silently)
  - No (default) → `Create_Task`
- Record Create `Create_Task`: creates a Task assigned to the opp owner reminding them about renewal
  - `Subject = NotificationEmailSubject` (variable)
  - `Description = NotificationEmailBody` (variable)
  - `WhatId = $Record.Id`, `OwnerId = $Record.OwnerId`, `Priority = "Normal"`, `Status = "Not Started"`

### CRITICAL ISSUES
1. **Same brittle exact-day check**: only fires when today is *exactly* 60 days before maturity. Miss the day, miss the alert.
2. **Different cadence than the renewal-creation flow** (60 days vs 115 days). Two scheduled flows running on slightly different timelines doing related work.
3. **NotificationEmailSubject and NotificationEmailBody variables are referenced but I don't see them defined** in this flow's metadata — they may come from defaults or be set elsewhere. Need to verify the actual subject/body text.

---

## Apply_Opportunity_Discount_To_New_Opp_Product v1 ACTIVE

- **Id:** `3015w000000nNJiAAM`
- **Process type:** AutoLaunchedFlow (record-triggered), API v58
- **Trigger:** RecordAfterSave on **OpportunityLineItem**, on Create only

### Logic
1. `Get_Related_Product` (Product2, by Id from line item) → `Product_or_Service`
2. Decision: if `Product.Family == "Products"` → `Get_Related_Opportunity`. Else (Services), do nothing.
3. `Get_Related_Opportunity` (by Id) → `Check_if_Opportunity_Has_Discount`
4. Decision: if Opportunity.Discount__c is not null → `Set_Opportunity_Product_Discount`
5. Assignment: `$Record.Discount = Get_Related_Opportunity.Discount__c`
6. Record Update: write back `Discount = Get_Related_Opportunity.Discount__c` on the line item

**Business intent:** When you add a new product line to an opp that already has a discount, automatically apply that discount to the new line — but only if it's a "Products" family item (not "Services").

---

## Apply_Opportunity_Discount_to_Products_Not_Services v2 ACTIVE

- **Id:** `3015w000000nNJTAA2`
- **Process type:** AutoLaunchedFlow (record-triggered), API v58
- **Trigger:** RecordAfterSave on **Opportunity**, Create+Update, when `Discount__c IsChanged`

### Logic
1. `Get_Opportunity_Products` (all OpportunityLineItem where OpportunityId = $Record.Id)
2. Loop through each product
3. If `Product2.Family == "Products"` → set `Discount = $Record.Discount__c` on that line, add to a collection
4. After loop, bulk update the collection

**Business intent:** Companion to the previous flow. When you change the opp-level Discount__c on an existing opp, propagate it to all "Products" line items.

**Together with the prior flow:** any "Products" line on an opp always reflects the opp-level discount; "Services" lines are exempt. This is essentially a denormalized formula — the discount could just be a formula field on the line item, but they implemented it as two flows.

---

## Set_FTEs_for_Account v2 ACTIVE

- **Id:** `3015w000000nNIaAAM`
- **Process type:** AutoLaunchedFlow (record-triggered), API v58
- **Trigger:** RecordAfterSave on **Account**, Create+Update, when `NumberOfEmployees IsChanged OR Status__c IsChanged`

### Logic — does THREE things:
**1. FTE tier mapping (when NumberOfEmployees changes):**
Decision tree maps NumberOfEmployees → `FTEs__c`:
- ≤20 → 20
- ≤50 → 50
- ≤100 → 100
- ≤250 → 250
- ≤500 → 500
- ≤750 → 750
- ≤1000 → 1000
- ≤2000 → 2000
- ≤5000 → 5000
- >5000 → uses NumberOfEmployees as-is (no cap)
- (default if 0 or null) → 0

**2. Active_Since__c (when Status__c becomes "Active"):**
- `Get_Oldest_Closed_Won_Opportunity` for the account (NOTE: query has no ORDER BY, "first only" — this likely returns an arbitrary closed-won opp, NOT the oldest. **Probable bug.**)
- Sets `Account.Active_Since__c = oldestOpp.CloseDate`

**3. Churn fields (when Status__c becomes "Inactive"):**
- `Get_Most_Recent_Closed_Won_Opportunity` for the account (same bug — no ORDER BY, "first only" returns arbitrary record)
- Sets `Churn_Amount__c = oppAmount`, `Churn_Date__c = opp.Maturity_Date__c`

### CRITICAL ISSUES
1. **"Oldest" and "Most Recent" lookups have no ORDER BY** — they're using `first only` against an unsorted query, so the values are effectively arbitrary. This is a bug. Brayden's churn metrics may be wrong if they rely on these.
2. **The FTE tier table is hardcoded.** Likely tied to pricing tiers — confirm with Brayden.

---

## Opportunity_Update_Name v1 ACTIVE

- **Id:** `301RO0000027DfJYAU`
- **Process type:** AutoLaunchedFlow (record-triggered), API v58
- **Trigger:** RecordAfterSave on **Opportunity**, Update only, when `HasOpportunityLineItem == true`

### Logic
1. Loop through OpportunityLineItems for this opp
2. For each, check if `Product_Category__c` is already in `varCategoryNames` (concatenated string)
3. If not yet added, append it with " | " separator
4. After loop, formula `OppNameFormula` strips the trailing " | " (uses `LEFT(varCategoryNames, LEN-3)`)
5. Update `Opportunity.Name = OppNameFormula` (concatenated unique product categories)

**Business intent:** Auto-name opportunities based on the unique product categories on their line items, separated by " | ". E.g., an opp with 3 line items in categories "Compliance", "Compliance", "Risk Assessment" would be renamed to `Compliance | Risk Assessment`.

### CRITICAL ISSUES
1. **Trigger fires on EVERY Opportunity update where the opp has line items** — this could fire dozens of times per opp throughout its lifecycle, recomputing the name each time and overwriting whatever the user typed. **Friction risk:** users may set a custom name that gets clobbered.
2. **Why a flow and not a formula field?** The Name field would have to be writeable for this to work, but conceptually this is a derived value. Worth replacing with a generated column / view in the new CRM.
