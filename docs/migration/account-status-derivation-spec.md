# Account.Status Derivation — Spec

The most critical data-quality cleanup in the migration. The SF org has 5,080 of 5,642 Accounts (90%) with NULL `Status__c`, and even the 485 that do have a value are set manually and can drift out of sync with actual deal/product reality.

This spec describes: (1) the rule for deriving `lifecycle_status` from deal and product history, (2) how to apply it as a one-time import backfill for all 5,642 SF accounts, and (3) how to keep it accurate ongoing via automation so no user has to set it manually.

This spec is self-contained for Claude Code to implement against the staging CRM (`staging.crm.medcurity.com`, Supabase + React).

---

## 1. The business rule (in plain English)

> An account is **Active** if they currently hold any active product subscription. A product subscription is active when its most recent deal (on that specific product) is Closed Won and has not yet been superseded by a Closed Lost. If every product they ever bought has either expired unrenewed OR been lost to a Closed Lost deal, the account is **Inactive**.

The important nuance Brayden flagged: a Closed Lost deal does NOT necessarily mean the customer left. Sales may have pitched them a new product (e.g. "Phishing Services") on top of their existing active product (e.g. "HIPAA Training"). If the customer declines the upsell, that Closed Lost deal covers only the pitched product — the underlying HIPAA Training subscription is still active, so the account is still Active.

## 2. Lifecycle status enum

```
lifecycle_status: 'active' | 'inactive' | 'pending' | 'discovery' | 'prospect'
```

- **`active`** — at least one product currently active (as defined below). This is the "paying customer" state.
- **`inactive`** — was a customer, now churned. No currently-active products.
- **`pending`** — has a non-closed-won opportunity open but no active products yet (first deal in progress, or re-engagement after churn).
- **`discovery`** — early-stage, in qualification/demo.
- **`prospect`** — imported lead/company record with no opportunity history (replaces the 5,080 SF NULL rows).

**Mapping from existing SF values (for the 485 accounts that DO have Status today):**

| SF Status__c | staging lifecycle_status | Notes |
|---|---|---|
| Active | active | Validate against derived value; log mismatches |
| Inactive | inactive | Validate |
| Pending | pending | Validate |
| Discovery | discovery | Pass through |
| NULL | (derived) | Run the derivation rule |

## 3. Derivation algorithm

### Inputs

For each account, gather:

- All opportunities (`opportunities` table) ordered by `close_date ASC`
- All line items per opportunity (`opportunity_line_items` joined to `products`)
- Current date (`today`)

### Per-product active state

A product subscription (identified by `(account_id, product_id)`) is **currently active** if:

1. There exists at least one opportunity on this account that is `stage = 'Closed Won'` AND contains a line item for this product AND whose `maturity_date >= today` (contract not yet expired)
   — OR —
   There exists a Closed Won deal for this product with no maturity_date populated AND no later Closed Lost deal for the same product.

2. AND that Closed Won deal is NOT superseded by a later Closed Lost deal FOR THE SAME PRODUCT. "Later" means `close_date >` the Closed Won's `close_date`.

3. AND the product is not explicitly marked churned via other signals (e.g. a `cancelled_at` timestamp on a deal or product subscription — tbd if this exists).

In plain SQL sketch:

```sql
-- active_product_subscriptions view
WITH deals_per_product AS (
    SELECT
        o.account_id,
        oli.product_id,
        o.stage,
        o.close_date,
        o.maturity_date,
        ROW_NUMBER() OVER (
            PARTITION BY o.account_id, oli.product_id
            ORDER BY o.close_date DESC, o.id DESC  -- tiebreak by id so it's stable
        ) as rn
    FROM opportunities o
    JOIN opportunity_line_items oli ON oli.opportunity_id = o.id
    WHERE o.stage IN ('Closed Won', 'Closed Lost')
),
latest_deal_per_product AS (
    SELECT * FROM deals_per_product WHERE rn = 1
)
SELECT
    account_id,
    product_id,
    stage AS latest_stage,
    close_date AS latest_close_date,
    maturity_date,
    (
        stage = 'Closed Won'
        AND (maturity_date IS NULL OR maturity_date >= CURRENT_DATE)
    ) AS is_currently_active
FROM latest_deal_per_product;
```

### Account lifecycle_status from product state

```sql
-- For each account:
lifecycle_status = CASE
    -- Has at least one currently-active product subscription
    WHEN EXISTS (
        SELECT 1 FROM active_product_subscriptions aps
        WHERE aps.account_id = a.id AND aps.is_currently_active = TRUE
    ) THEN 'active'

    -- Has at least one Closed Won deal ever, but none currently active
    WHEN EXISTS (
        SELECT 1 FROM opportunities o
        WHERE o.account_id = a.id AND o.stage = 'Closed Won'
    ) THEN 'inactive'

    -- Has an open opportunity (not closed) — in flight
    WHEN EXISTS (
        SELECT 1 FROM opportunities o
        WHERE o.account_id = a.id
          AND o.stage NOT IN ('Closed Won', 'Closed Lost')
          AND o.stage IN ('Proposal', 'Verbal Commit')  -- late-stage opens
    ) THEN 'pending'

    WHEN EXISTS (
        SELECT 1 FROM opportunities o
        WHERE o.account_id = a.id
          AND o.stage IN ('Lead', 'Qualified')  -- early-stage opens
    ) THEN 'discovery'

    -- No opportunity history at all
    ELSE 'prospect'
END
```

## 4. Edge cases to handle

1. **Account with Closed Won but no maturity_date populated.** Likely pre-migration or data-quality issue. Default to `is_currently_active = true` if no later Closed Lost exists for the same product. Log these for manual review.

2. **Account with only amount-only opportunities (no line items).** 43% of SF opps fall in this bucket. For these, fall back to opportunity-level reasoning: account is active if the most recent Closed Won opp has not been followed by a Closed Lost on the same account. This is coarser than the product-level rule but necessary because we can't see the product breakdown. Log these accounts for manual review after migration.

3. **Account with SF `Status__c = 'Active'` but derivation says `inactive`.** Don't silently overwrite. Emit a warning and let the human decide. Most likely cause: SF Status is stale because no one updated it after a contract lapsed.

4. **Account with no opportunities at all but SF `Status__c = 'Active'`.** Edge case; probably bad data. Flag for review.

5. **Closed Lost deal for a product the account never bought.** If the Closed Lost deal's line item's product has NO prior Closed Won on the same account, treat the Closed Lost as "pitched, not lost" — it doesn't affect active-product calculus for other products. The algorithm above handles this naturally (it only supersedes a prior Closed Won for the same product).

6. **"Amount-only" renewal opps.** The renewal flow copies `Amount` but not line items (43% of opps). For renewal-generated opps, inherit the parent opp's line items at derivation time via `source_opportunity_id`. (This is why the renewal-flow-spec.md already requires the new CRM to copy line items.)

7. **`every_other_year = true` accounts between renewal years.** Their contract may technically have lapsed but they're in the gap year. Treat them as `active` if they have a renewal scheduled (auto-generated) OR if their most recent maturity_date was within the last 12 months.

## 5. One-time import backfill

As part of Phase 7 (data migration), after all accounts / opportunities / opportunity_line_items are loaded:

```
-- Run once against the migrated data
UPDATE accounts a
SET lifecycle_status = derive_lifecycle_status(a.id),
    lifecycle_derived_at = NOW(),
    lifecycle_source = 'import_backfill_v1'
WHERE lifecycle_status IS NULL;  -- only backfill untouched records

-- Then validate the 485 that had SF Status__c set
INSERT INTO migration_audit (account_id, field, sf_value, derived_value, action_taken)
SELECT
    a.id,
    'lifecycle_status',
    a.sf_status__c,
    derive_lifecycle_status(a.id),
    CASE WHEN a.sf_status__c = derive_lifecycle_status(a.id) THEN 'match'
         ELSE 'mismatch_kept_derived' END
FROM accounts a
WHERE a.sf_status__c IS NOT NULL;
```

**Decision point for Brayden:** on mismatch, do we keep the derived value (trust the algorithm) or the SF-set value (trust the human)? Recommendation: keep derived, but dump mismatches to a CSV for Brayden to review. Most mismatches are likely SF staleness.

## 6. Ongoing automation (replaces manual setting)

Trigger the recomputation whenever a change could affect lifecycle_status:

| Event | Recompute for |
|---|---|
| Opportunity stage changes to/from `Closed Won` or `Closed Lost` | the opp's account |
| OpportunityLineItem added, removed, or product changed | the opp's account |
| Opportunity `maturity_date` changes | the opp's account |
| New opportunity created (any stage) | the opp's account |
| Account's `every_other_year` or `renewal_type` changes | that account |
| Daily scheduled sweep | all accounts (safety net for time-based transitions, e.g. maturity_date rolling past today) |

Implementation:

- Supabase trigger on `opportunities` AFTER INSERT / UPDATE / DELETE → queues a recompute for `NEW.account_id` (and `OLD.account_id` if different).
- Supabase trigger on `opportunity_line_items` AFTER INSERT / UPDATE / DELETE → queues a recompute for the parent opp's account.
- Daily scheduled job (same job that runs the renewal automation) → sweeps all accounts. This catches maturity_date rolling past today without any explicit event.
- Recompute function: runs the derivation SQL from section 3, updates `accounts.lifecycle_status`, `lifecycle_derived_at`, `lifecycle_source = 'automation'`. If value changed, write to `account_lifecycle_history` (account_id, from_status, to_status, changed_at, reason).

## 7. User override

Sometimes a human knows something the algorithm doesn't (e.g., "this account is churning even though the contract hasn't expired yet"). Support a manual override:

- Add `lifecycle_status_override` and `lifecycle_status_override_reason` fields on `accounts`
- If override is set, the automation respects it (doesn't overwrite)
- Admin UI exposes "clear override" to re-engage the automation
- Log overrides to `account_lifecycle_history` with `source = 'manual'`

## 8. Reporting/visibility

Expose in the admin UI / data-health section:

- Count of accounts by lifecycle_status
- Count of accounts with status mismatches between derived and override
- Count of accounts with incomplete data (missing maturity_date on Closed Won, etc.) — Brayden's working list
- Daily transitions (how many went active → inactive or vice versa yesterday)
- Time-in-state histogram (helps spot accounts stuck in pending/discovery)

## 9. Acceptance criteria

The automation is correct if:

1. **Backfill test:** running it against a snapshot of SF data produces `active` status for the 315 accounts SF currently marks Active (±5% — mismatches are flagged, not silently forced).
2. **Closed Lost upsell scenario:** for an account with Closed Won on Product A (not expired) AND Closed Lost on Product B (same account, later date, different product), the account remains `active`. Product B's loss doesn't demote the account.
3. **Churn scenario:** for an account with Closed Won on Product A (maturity_date in the past) and no renewal, followed by a Closed Lost on Product A, the account becomes `inactive`.
4. **Mid-migration idempotency:** running the backfill twice produces the same results.
5. **Daily sweep transitions:** an account whose last Closed Won's maturity_date rolled past today flips to `inactive` on the next daily sweep (or `active` if an auto-renewal was created in the meantime).
6. **Override respect:** setting `lifecycle_status_override = 'inactive'` on an account that the algorithm thinks is active causes subsequent runs to leave it as `inactive` until cleared.
7. **History:** every transition writes a row to `account_lifecycle_history` with timestamp and reason.

## 10. Open questions before implementing

1. **Do Closed Lost deals have line items in SF?** If Yes, great — the product-level rule works cleanly. If some are amount-only, fall back to opportunity-level reasoning for those specific deals (and flag for review). `@migration-audit should catch any issues.`
2. **How should `one_time_project = true` opportunities affect status?** A one-time project that's Closed Won doesn't imply ongoing active product. Probably exclude one-time projects from the "is_currently_active" calculation.
3. **Does Medcurity ever sell the same product twice to the same account (upgrade/downgrade)?** If yes, `(account_id, product_id)` isn't necessarily unique enough — may need to track a `contract_id` or similar. For now, the ROW_NUMBER() + "latest deal" approach handles this correctly by looking at the most recent deal per product.
4. **Should `discovery` and `pending` be merged?** SF has 38 + 39 of these; they may be a distinction without difference. Confirm with Brayden.
5. **Is there a grace period after maturity_date where the account stays active?** (e.g. 30-day grace window). In SF today, the renewal flow fires at 115 days BEFORE maturity, so most active accounts have a renewal already pending. But if the renewal doesn't close in time, does the account flip to inactive on day 1 after maturity? Recommendation: no grace period (strict maturity), but log the day-1 transition prominently.

---

## Summary for Claude Code

**Build order:**

1. Add `lifecycle_status_override`, `lifecycle_status_override_reason`, `lifecycle_derived_at`, `lifecycle_source` columns to `accounts`
2. Create `account_lifecycle_history` table
3. Write the `derive_lifecycle_status(account_id)` SQL function (pure function, no side effects)
4. Write the `recompute_account_lifecycle_status(account_id)` procedure (calls derive, writes to accounts + history if changed)
5. Add triggers on `opportunities` and `opportunity_line_items` that call recompute
6. Hook recompute into the daily scheduled job alongside renewal automation
7. Build admin UI: account lifecycle history view, override controls, data-health counts
8. Run the backfill once on migrated SF data
9. Dump mismatches vs SF's old Status__c to CSV for Brayden's review
10. Acceptance tests per section 9
