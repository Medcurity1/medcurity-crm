# Renewal Automation — Spec for the New CRM

This is a **self-contained spec for Claude Code** to implement the renewal automation in the new Supabase + React CRM (`staging.crm.medcurity.com`). It documents:

1. What Salesforce does today (3 separate flows working together)
2. What's already scaffolded in the staging CRM
3. The exact behavior the new automation must produce
4. Edge cases / bugs in the SF version that the new version should NOT replicate
5. Acceptance criteria

---

## 1. The current Salesforce setup (3 flows)

### Flow A — `Renewal_Opportunity_2_No_Products` v4 (creates the renewal opp)

- **Trigger:** Scheduled (cadence not exposed in metadata; assume daily). NOT record-triggered.
- **Logic:**
  1. Query all `Opportunity` where `CloseDate < TODAY AND StageName = 'Closed Won'`.
  2. For each opp, compute `DaysUntilAnniversaryCloseDate` = days between TODAY and (CloseDate + 1 year), with a leap-year adjustment (Feb 29 → March 1).
  3. **If exactly 115:** look up the Account; **only proceed if `Account.Status__c = 'Active'`**.
  4. Create a new Opportunity, copying these fields from the source opp:
     - `AccountId`, `Amount`, `Description`, `Discount__c`, `LeadSource`, `Name`, `NextStep`, `OwnerId`, `Payment_Frequency__c`, `Subtotal__c`, `Contract_Length__c`
  5. Set on the new opp:
     - `CloseDate = source.CloseDate + 12 months` (or +11 months for "Year 2 of a 3-year contract" — the only exception)
     - `Contract_Year__c = next year in the cycle` (Year 1→2, 2→3, 3→1; non-3yr contracts always "Year 1")
     - `Cycle_Count__c = increments when starting a new 3-year cycle`
     - `Created_by_Automation__c = true`
     - `StageName = 'Proposal Conversation'`
     - `Type = 'Existing Business'`
- **Does NOT copy** `OpportunityLineItem` records → renewal opps have `Amount` but no product breakdown. (43% of all opps in SF are amount-only because of this.)

### Flow B — `Send_Notification_for_Renewal_Opportunity` v4 (notification 60 days before maturity)

- **Trigger:** Scheduled, on `Opportunity` where `StageName = 'Closed Won'`.
- **Logic:**
  1. For each closed-won opp, compute `MaturityDateMinus60 = Maturity_Date__c - 60 days`.
  2. **If TODAY exactly equals `MaturityDateMinus60`:** look up other opps on the same Account where stage NOT IN (Closed Won, Closed Lost).
  3. If any open opp exists → do nothing (someone's already working it).
  4. Otherwise → create a Task on the opp owner with subject/body from `NotificationEmailSubject` / `NotificationEmailBody` variables (these variables aren't defined in the flow metadata I could read — verify the actual subject/body in SF UI before cutover).

### Flow C — `Set_FTEs_for_Account` v2 (touches lifecycle dates on Status changes)

Not strictly part of the renewal pipeline, but related: when `Account.Status__c` changes to "Active" or "Inactive", this flow sets `Active_Since__c` or `Churn_Amount__c` + `Churn_Date__c` from the related opportunities.

**Bug to NOT replicate:** the lookups for "oldest" and "most recent" closed-won opportunities have NO `ORDER BY` and use `first only`. They return arbitrary records, not the actual oldest/most-recent. Brayden's churn metrics may be silently incorrect.

---

## 2. What the staging CRM already has

Visible in `staging.crm.medcurity.com/admin?tab=automations`:

- **Renewal Automation** (built-in feature, not yet enabled): "Automatically generates renewal opportunities for closed-won deals whose contract end date is approaching. Runs daily at 09:00 UTC and can be triggered manually. Accounts with renewal type 'no auto renew' are skipped." Configurable lookahead window. Last run: **Never**.
- **Quick-Start Template "Contract Expiring → Renewal Reminder"** — analog of Flow B (the 60-day notification).
- **Opportunity has a `Created by Automation` field** — direct analog of `Created_by_Automation__c`.
- **Opportunity has `Auto Renewal`, `Contract Length`, `Contract Year`, `Cycle Count`, `Maturity Date`, `Start Date`** — all the fields Flow A reads/writes.
- **Account has `Renewal Type`, `Every Other Year`, `Active Since`, `Churn Amount`, `Churn Date`** — all needed for lifecycle.

So the staging CRM has the right schema and the right shape of automation. What's needed is to:

(a) wire it up correctly (trigger conditions, idempotency, every-other-year logic, line-item copying)
(b) enable / configure it
(c) verify it produces the same renewal opps the SF flow does today

---

## 3. The NEW automation behavior (what to build)

### 3a. Renewal opportunity creator (`renewal_opportunity_generator`)

**Trigger:** Daily scheduled job at 09:00 UTC (already in staging description). Also exposed as a manual "Run Now" admin button.

**Pseudocode:**

```
config = renewal_automation_settings  // editable via Admin UI
  .lookahead_days        // default: 120 (covers SF's 115 + a buffer)
  .lookback_days         // default: 30  (catch-up for missed runs)
  .skip_account_renewal_types  // default: ['no auto renew']

today = current_date

candidate_opps = SELECT * FROM opportunities o
  JOIN accounts a ON a.id = o.account_id
  WHERE o.stage = 'Closed Won'
    AND a.lifecycle_status = 'Active'
    AND a.renewal_type NOT IN config.skip_account_renewal_types
    AND o.close_date BETWEEN
        today - INTERVAL '1 year' - INTERVAL config.lookback_days DAY
        AND
        today - INTERVAL '1 year' + INTERVAL config.lookahead_days DAY

for each opp in candidate_opps:
    // IDEMPOTENCY: skip if a renewal already exists for this account/cycle
    if exists(
        SELECT 1 FROM opportunities r
        WHERE r.account_id = opp.account_id
          AND r.created_by_automation = true
          AND r.source_opportunity_id = opp.id
    ):
        continue

    // Skip if a manually-created open opp on this account already exists
    if exists(
        SELECT 1 FROM opportunities o2
        WHERE o2.account_id = opp.account_id
          AND o2.stage NOT IN ('Closed Won', 'Closed Lost')
          AND o2.start_date >= today - INTERVAL '90 days'
    ):
        log('skipped: open opp already exists', opp.id)
        continue

    // Every-other-year handling (SF flow had this field but never used it — bug)
    if account.every_other_year and opp.cycle_count % 2 == 1:
        // skip this year, will renew next year
        continue

    // Compute new close date with 3-year-contract pull-back
    new_close_date = compute_new_close_date(opp)
    new_contract_year = compute_new_contract_year(opp)
    new_cycle_count = compute_new_cycle_count(opp)

    create opportunity (
        account_id = opp.account_id,
        owner_id = opp.owner_id,
        amount = opp.amount,
        subtotal = opp.subtotal,
        discount = opp.discount,
        description = opp.description,
        next_step = opp.next_step,
        lead_source = opp.lead_source,
        payment_frequency = opp.payment_frequency,
        contract_length = opp.contract_length,
        // staging-CRM stage, NOT SF's "Proposal Conversation"
        stage = 'Proposal',
        type = 'Renewal',
        close_date = new_close_date,
        contract_year = new_contract_year,
        cycle_count = new_cycle_count,
        created_by_automation = true,
        source_opportunity_id = opp.id,  // NEW field for idempotency
        // COPY LINE ITEMS — the SF v5 draft tried to add this. Do it.
    )

    for each line_item in opp.line_items:
        create opportunity_line_item (
            opportunity_id = new_opp.id,
            product_id = line_item.product_id,
            quantity = line_item.quantity,
            unit_price = line_item.unit_price,
            discount = line_item.discount,
        )

    log('renewal created', opp.id, new_opp.id)
```

### Helper functions

```python
def compute_new_close_date(opp):
    new_date = opp.close_date + relativedelta(months=12)
    # 3-year-contract "pull back 1 month" rule from SF
    if opp.contract_length == 36 and opp.contract_year == 'Year 2' and opp.cycle_count == 1:
        new_date = opp.close_date + relativedelta(months=11)
    # Leap-year guard: if source date was Feb 29, roll to Mar 1
    if opp.close_date.month == 2 and opp.close_date.day == 29:
        new_date = date(new_date.year, 3, 1)
    return new_date

def compute_new_contract_year(opp):
    if opp.contract_length != 36:
        return 'Year 1'
    cycle = {'Year 1': 'Year 2', 'Year 2': 'Year 3', 'Year 3': 'Year 1'}
    return cycle.get(opp.contract_year, 'Year 1')

def compute_new_cycle_count(opp):
    if opp.contract_length != 36:
        return opp.cycle_count or 0
    if opp.contract_year == 'Year 3':  # cycle restart
        return (opp.cycle_count or 0) + 1
    return opp.cycle_count or 0
```

### 3b. Renewal reminder task creator

**Trigger:** Daily scheduled job (same job as 3a is fine).

```
candidate_opps = SELECT * FROM opportunities
  WHERE stage = 'Closed Won'
    AND maturity_date BETWEEN today + 55 days AND today + 65 days
    AND NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.related_opportunity_id = opp.id
          AND t.subject = 'Renewal reminder'
          AND t.created_at >= today - INTERVAL 90 days
    )

for each opp:
    if exists(open opp on account):
        continue
    create task (
        owner_id = opp.owner_id,
        related_opportunity_id = opp.id,
        related_account_id = opp.account_id,
        subject = 'Renewal reminder',
        description = render_template('renewal_reminder', opp=opp),
        priority = 'Normal',
        status = 'Not Started',
        due_date = opp.maturity_date,
    )
```

The 55-65 day window (instead of SF's exact-day check) provides 11 days of catch-up for missed runs. Combined with the dedup check, this is safe.

### 3c. Account lifecycle automation

This already exists in staging as the `Closed Won → Active Account` Process Automation. Verify it covers:

- When opp.stage changes to 'Closed Won' AND account.lifecycle_status != 'Active' → set `lifecycle_status = 'Active'`, `active_since = COALESCE(active_since, opp.close_date)`.
- When account.lifecycle_status changes to 'Inactive' → set `churn_date = (SELECT MAX(close_date) FROM opportunities WHERE account_id = a.id AND stage = 'Closed Won')`, `churn_amount = (SELECT amount FROM opportunities WHERE id = (above subquery's source))`.

**Critically**: use `ORDER BY close_date DESC LIMIT 1` for "most recent" and `ORDER BY close_date ASC LIMIT 1` for "oldest" — the SF flow had neither and was returning arbitrary records.

---

## 4. SF bugs to NOT replicate

| SF bug | Fix in new CRM |
|---|---|
| Brittle exact-day match (`== 115`, `== 60`) | Use a window (e.g. ±5 days) with idempotency dedup |
| No idempotency check on renewal creation | Use `source_opportunity_id` foreign key + check before insert |
| `Account.Renewal_Type__c` queried but not used | Honor `renewal_type IN ('no auto renew', ...)` skip rule |
| `Account.Every_Other_Year__c` queried but not used | Honor it (skip odd cycle counts) |
| Renewal flow doesn't copy line items | Copy line items |
| Set_FTEs flow's "oldest"/"newest" lookups have no `ORDER BY` | Use proper ordered queries |
| `Opportunity_Update_Name` flow auto-renames opps and clobbers user input | Don't replicate; let users name their opps |
| Two scheduled flows on different cadences for related work | Run all renewal logic in one daily job |

---

## 5. Acceptance criteria

The new automation is correct if, given today's SF state:

1. **Backfill test:** running it once (with `lookback_days = 365`) produces a renewal opp for every closed-won opp from the last year that:
   - Is on an `Active` account
   - Has `renewal_type != 'no auto renew'`
   - Doesn't already have a renewal generated
   - Doesn't have an open opp on the same account
2. **Steady-state test:** running it daily produces ~1-3 new renewals per day on average (since SF averages ~1500 closed-won opps over the last 5 years and a typical opp triggers a renewal once per year).
3. **Idempotency test:** running it twice in a row produces ZERO new opps the second time.
4. **Every-other-year test:** for an account with `every_other_year = true` and last cycle_count = 1 (odd), no renewal is generated until next year.
5. **Reminder test:** for any closed-won opp whose `maturity_date` is 55-65 days out, a reminder task exists on the owner.
6. **Compare to SF "Created by Automation" report:** the volume of new auto-generated opps over a 30-day window matches SF's volume (±10%) for the same period before cutover.

---

## 6. Open questions (need Brayden's input before implementing)

1. **What renewal_type values should be skipped?** SF has the field but never used it. Need the actual list — likely `'no auto renew'`, possibly others.
2. **Confirm the Notification email subject/body** in SF — the SF flow's `NotificationEmailSubject` / `NotificationEmailBody` variables aren't defined in the metadata I read. Brayden should grab the actual text from a recent reminder task.
3. **3-year-contract pull-back rule** — verify with Brayden that the +11-months-for-Year-2 logic is correct and shouldn't apply to Year 3 too. The SF formula description says "Fixing 3 year contract pull back (1 month)" but the logic is asymmetric.
4. **Should "every other year" accounts auto-renew at all?** Or just skip every other year? Confirm semantics.

---

## 7. Migration cutover

When SF sunsets:

1. Pre-cutover: ensure every SF closed-won opp has been migrated to staging with `source_opportunity_id` populated when applicable (so idempotency check works on the first new-CRM run).
2. Disable Flow A and Flow B in SF the day before cutover.
3. Enable staging's renewal automation with `lookback_days = 30` (so it picks up anything SF would have done in the last month).
4. Run manually once, verify output, then schedule it daily.
5. Monitor "Created by Automation" report (staging analog of SF's) for 30 days to confirm steady-state behavior.
