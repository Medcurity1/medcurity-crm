# Rebuild Differently — Things SF Has That We Should Build Better

These are SF capabilities that we DO need, but where the SF implementation has bugs, anti-patterns, or unnecessary complexity that we should not carry forward. Each item describes the SF approach, why it's bad, and what to build instead.

---

## 1. Renewal opportunity generation — fix brittle exact-day matching

**SF approach:** scheduled flow runs daily, only fires when `DaysUntilAnniversaryCloseDate == 115` exactly. If the scheduler misses a day, the opp is never renewed.

**Problems:**

1. No catch-up logic
2. No idempotency (can create duplicates if it runs twice or someone manually creates a renewal first)
3. Three Account fields (`Renewal_Type__c`, `Status__c`, `Every_Other_Year__c`) are queried but never used
4. Doesn't copy line items (43% of opps end up amount-only)

**Better:** see `renewal-flow-spec.md` for full spec. Use a window (e.g. ±5 days) with an idempotency check via `source_opportunity_id` foreign key, honor every-other-year and renewal-type fields, copy line items.

## 2. 60-days-before-maturity notification — same brittle exact-day issue

**SF approach:** scheduled flow on Opportunity, fires only when `today == maturity_date - 60` exactly.

**Better:** check if today falls in `[maturity_date - 65, maturity_date - 55]` AND no reminder task exists yet. Fully idempotent.

## 3. Set_FTEs_for_Account — fix the unsorted "first only" bug

**SF approach:** when `Account.Status__c` flips to Active or Inactive, looks up the "oldest" or "most recent" closed-won opportunity using `first only` with NO `ORDER BY`. Returns arbitrary records.

**Result:** `Active_Since__c` and `Churn_Date__c` / `Churn_Amount__c` are silently incorrect for many accounts.

**Better:** use `ORDER BY close_date ASC LIMIT 1` for oldest, `ORDER BY close_date DESC LIMIT 1` for newest. Validate after migration that the lifecycle dates still make sense (compare against migrated SF values to spot the bad ones).

## 4. Opportunity_Update_Name — drop the auto-rename behavior entirely

**SF approach:** when an Opportunity is updated, walks its line items and overwrites `Opportunity.Name` with concatenated unique product categories ("Compliance | Risk Assessment").

**Problems:**

1. Fires on EVERY opp update, recomputing the name each time
2. Clobbers user-entered names (sales reps may want descriptive opp titles)
3. Produces ugly auto-generated names

**Better:** don't replicate. Let users name their opps. If a structured "what's in this opp" display is needed, render it as derived UI (chips/badges next to the opp name) instead of mutating the name.

## 5. FTE-tier × product matrix — collapse the 155-SKU anti-pattern

**SF approach:** 12 Pricebooks (one per FTE tier from 1-20 to 5001-10000 + Standard) × 155 active products. Each "real" product is duplicated across 11 FTE tiers (e.g., "1-20 General Employee HIPAA Training", "21-50 General Employee HIPAA Training", ...).

**Result:** ~14 actual product concepts × 11 FTE tiers = 154 SKUs. Adding a new tier means cloning 14 SKUs. Reporting "show me all sales of HIPAA Training" requires enumerating 11 SKU names. The two `Apply_Opportunity_Discount_*` flows exist mostly to dance around this matrix.

**Better:** staging already does this right. 3 products with "Per FTE" pricing model. The migration just needs a SKU-name → (staging_product, FTE_tier) crosswalk to translate SF opp line items.

## 6. Discount propagation — make it computed, not denormalized

**SF approach:** two flows (`Apply_Opportunity_Discount_To_New_Opp_Product` and `Apply_Opportunity_Discount_to_Products_Not_Services`) ensure every "Products"-family line item's `Discount` field equals the opp-level `Discount__c`. They handle "new line added" and "opp-level discount changed" separately.

**Better:** don't store discount per line item. Compute it at read time:

```sql
SELECT
  oli.*,
  CASE
    WHEN p.family = 'Products' THEN COALESCE(oli.discount_override, opp.discount, 0)
    ELSE COALESCE(oli.discount_override, 0)  -- Services exempt from opp-level
  END AS effective_discount
FROM opportunity_line_items oli
JOIN products p ON p.id = oli.product_id
JOIN opportunities opp ON opp.id = oli.opportunity_id
```

No flows needed. Always correct.

## 7. Copy_Billing_Address_to_Shipping_Address — replace with a button

**SF approach:** boolean field on Account that triggers a workflow rule to copy address.

**Better:** a "Copy from billing" button on the shipping address section of the form. No persistent field needed.

## 8. Account.Status NULL → 5,080 prospect accounts polluting the Active table

**SF approach:** `Account.Status__c` is null for 90% of accounts. Sales only fills it in for actual customers.

**Result:** the Account list view is dominated by "stale prospect company records" that arrived via lead lists.

**Better in the new CRM:** either

(a) Use `lifecycle_status` enum with a default of `'prospect'` so it's never null, and filter Active views to `lifecycle_status IN ('active', 'pending')`
(b) Move the 5,080 prospect rows to a separate `companies` table and only "promote" to `accounts` when a deal is in motion

Recommendation: (a). Keep one Accounts table; use lifecycle_status to filter views.

## 9. Lead status sprawl — clean before migration

**SF state:** 30,943 leads (72%) with Status="New", never worked. Plus a lowercase `done` value (picklist drift).

**Better:** archive "New" leads older than 6 months as "expired" (not deleted, but out of working views). Use a single canonical Status enum with no case duplicates.

## 10. Industry picklist — dedupe the obvious duplicates

| SF problem | Fix |
|---|---|
| `Hospital` (1176) + `Hospital & Health Care` (384) | Merge to single value |
| `Technology` (202) + `information technology & services` (60, lowercase) + `Computer Software` | Merge or pick canonical |

**Better:** lock the picklist down with a curated enum, then automatically remap on import. Don't allow free-text values.

## 11. Opportunity.Type — replace messy 4-value picklist with clean enum

**SF state:** 977 "Existing Business", 640 "Opportunity" (the literal default value), 550 "New Business", 19 "Existing Business - New Service", 12 null, 9 "Existing Business - New Product".

**Better:** clean 4-value enum:
- `new` (550 "New Business")
- `renewal` (977 "Existing Business" + reasonable default for the 640 "Opportunity" rows)
- `expansion_service` (19)
- `expansion_product` (9)

Migrate the ambiguous "Opportunity" rows by inspecting Account.Status__c — if Active customer → renewal, else → new.

## 12. SF Profile sprawl — collapse to 2 roles

**SF state:** 22 profiles, only 5 used by active humans. Plus 88 permission sets.

**Better:** two roles — `admin` and `user`. Use feature flags / permission columns on the user record for any per-feature toggles. Don't create a "Standard Medcurity" custom profile in v1 — wait for actual demand.

## 13. Pardot's 4 Apex change-loggers — don't replicate the Pardot architecture

**SF state:** Pardot installs 5 triggers (Account / Contact / Lead change loggers + CampaignDeleteCheck + PardotTask), 390 Apex classes.

**Better:** if marketing automation is needed in the new CRM, treat it as a separate concern. Either:

(a) Keep HubSpot as the marketing automation system and sync via webhooks
(b) Build minimal marketing automation natively in the new CRM
(c) Pick a different MA tool (ActiveCampaign, Customer.io, etc.) that talks to Postgres directly

## 14. Email Templates — let staging be the new home

**SF state:** 21 templates, only 2 ever used. Don't migrate.

**Better:** start fresh in staging's Email Templates section. Sales team writes most emails ad-hoc anyway.

## 15. Reports — build views, not a reports engine

**SF state:** 710 reports (only 9% recently run). Built on a complex report-builder that requires admin training.

**Better:** for the ~20-30 must-have reports (see `must-replicate.md`), build them as:

- Built-in dashboards (top-level KPIs)
- Saved filters / list views (everyday "show me my open opps" type queries)
- SQL views in Supabase for ad-hoc analysis (admin-only)

Don't try to build a general-purpose report builder in v1. Add saved-views functionality if/when users ask.

## 16. The 2 separate Pardot/SF "auto-tracking" Campaigns

**SF state:** "Created from Salesforce" (5,113 leads) and "Website Tracking" Pardot auto-campaigns. They exist as artifacts, not actual marketing campaigns.

**Better:** don't replicate the auto-campaign concept. If you want to track lead provenance, use a `lead_source` field; if you want to track website visits, use a separate analytics tool.

## 17. Knowledge as `Knowledge__kav` + 2 custom fields

**SF state:** Knowledge object configured but the Knowledge license isn't even granted to API queries. Likely zero use.

**Better:** if Brayden confirms zero use → drop entirely. If a FAQ feature is wanted later, build it as a simple `knowledge_articles` table (id, question, answer, category, published, created_at) without the SF Knowledge complexity (article types, channels, data categories, translations, archives, etc.).

## 18. ContentDocument files

**SF state:** 160 files attached to records.

**Better:** if files are business-critical, use Supabase Storage (or S3) with a `record_attachments` table that polymorphically references the parent record. Don't replicate SF's ContentDocument/ContentVersion/ContentDocumentLink three-table model — collapse to one.

## 19. SF "Type" pattern overuse

SF has `Type__c` fields on Lead, Contact, Task, Opportunity — each a different freeform picklist with unclear semantics. Tasks are 99% null on Type.

**Better:** drop type fields wherever they're <10% populated. Where actually useful (Opportunity.Type for new/renewal/expansion), use a strict enum.

## 20. Two duplicate Mel Nevala user records

**SF state:** "Mel Nevala" + "Mel (Old) Nevala (Old)" — name-change incident left two records.

**Better:** in staging, allow user identity to change without splitting the record (mutable display name; immutable email/UUID). Reconcile any historical activity by pointing both old SF user IDs at the single staging user_id.
