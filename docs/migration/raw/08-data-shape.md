# Data Shape: Volumes, Picklists, Pricing, Products

Generated 2026-04-15.

## Headline findings

- **2,207 Opportunities, ~400/year throughput** since 2022. Skewed heavily to "Existing Business" (renewals) which makes the renewal automation business-critical.
- **Win rate: 1241 won / (1241+799) = 60.8%** on closed opps. Very healthy.
- **5,642 Accounts but 5,080 (90%) have NULL `Status__c`.** Only 315 are tagged "Active" customers. The Status field appears to be only populated by sales for actual customers (active/inactive tracking), not for prospects.
- **42,697 Leads but 30,943 (72%) are Status="New" — never worked.** Lead intake is dominated by purchased lists / cold-call campaigns that mostly sit untouched. The marketing funnel is bottom-heavy.
- **Pricing model is FTE-tiered**: 12 Pricebooks (one per FTE bucket from 1-20 up to 5001-10000) × 155 active products. Each product is duplicated per FTE bucket (e.g., "1-20 General Employee HIPAA Training", "21-50 General Employee HIPAA Training", etc.) instead of using a single product with tiered pricing. **This is the data structure that the Set_FTEs_for_Account flow + Apply_Opportunity_Discount_to_Products_Not_Services flow are dancing around.**
- **Industry data is HIPAA / healthcare compliance focused**: dominant industries are Hospital (1176), Hospital & Health Care (384), Community Health Center (355), Rural Hospital (125), Behavioral Health (108), plus medical specialties. Two industry values for "Hospital" indicates picklist drift / lack of cleanup.

## Opportunity stages (only 6)

| Stage | Count | Notes |
|---|---|---|
| Closed Won | 1,241 | 56.2% of all opps |
| Closed Lost | 799 | 36.2% |
| Proposal Conversation | 104 | Active pipeline — also the default starting stage for renewal-flow-created opps |
| Details Analysis | 34 | Earlier in funnel |
| Proposal and Price Quote | 21 | Late funnel |
| Demo | 8 | Tiny — possibly underused |

**Implication for new CRM**: 6 stages is small enough to keep as-is. Don't redesign sales process during migration — replicate the funnel, then iterate.

## Opportunity types

| Type | Count | Notes |
|---|---|---|
| Existing Business | 977 | Renewals — the biggest bucket |
| Opportunity | 640 | A picklist value of literally "Opportunity" — indicates "Type" is often left at default. **Data quality issue.** |
| New Business | 550 | Net-new customers |
| Existing Business - New Service | 19 | Cross-sell |
| (null) | 12 | Missing |
| Existing Business - New Product | 9 | Cross-sell |

**Implication**: The "Type" picklist needs a default-mapping decision. Suggest: collapse to {New, Renewal, Expansion} in the new CRM.

## Opportunity counts by close-date year

| Year | Count |
|---|---|
| 2018 | 5 (org just started) |
| 2019 | 29 |
| 2020 | 97 |
| 2021 | 242 |
| 2022 | 388 |
| 2023 | 388 |
| 2024 | 373 |
| 2025 | 418 |
| **2026** | **262 YTD (Apr 15) — pace ~785 = highest year ever** |
| 2027 | 3 (forward-dated) |
| 2028 | 2 (forward-dated) |

## Account.Status__c distribution

| Status | Count | % |
|---|---|---|
| (null) | 5,080 | 90.0% |
| Active | 315 | 5.6% |
| Inactive | 170 | 3.0% |
| Pending | 39 | 0.7% |
| Discovery | 38 | 0.7% |

**The new CRM should NOT include 5,080 prospect accounts as `accounts`**: they're really "company records" that came from lead lists. Suggest a clearer separation: `companies` (master company directory) vs. `customer_accounts` (active+inactive customer relationships). Or: just use a single `accounts` table with a `lifecycle_stage` enum.

## Lead.Status distribution (42,697 leads)

| Status | Count | % |
|---|---|---|
| New | 30,943 | 72.5% |
| Assigned | 4,851 | 11.4% |
| Qualified | 4,207 | 9.9% |
| Contacted | 1,511 | 3.5% |
| Working | 881 | 2.1% |
| Unqualified | 198 | 0.5% |
| In Process | 63 | 0.1% |
| done | 43 | 0.1% (note lowercase, picklist drift) |

**The `New` bucket of 30,943 is essentially purchased-list leftovers.** Migrating these as `leads` in the new CRM is questionable — they may be cold/expired.

## Lead source distribution (top 20)

| Source | Count |
|---|---|
| (null) | 13,602 |
| Cold Call - SMB | 5,145 |
| eClinicalWorks List | 4,680 |
| Medibeat | 4,661 |
| Athena List | 3,617 |
| AVP Leads List - UpWork | 1,508 |
| Webinar | 1,318 |
| Lead Rocks | 1,129 |
| NextGen | 906 |
| New York Lead List | 839 |
| Email Campaign - SMB | 687 |
| Partner - Influence | 475 |
| CHCAMS 2023 | 440 |
| CHUG19 | 424 |
| AuDacity 2019 | 363 |
| AuDacity 2021 | 349 |
| Partner - Other | 340 |
| Specialty Networks | 293 |
| NWRPCA | 221 |
| SMB Targets | 215 |

**Several sources are old conferences (CHUG19, AuDacity 2019/2021)** and stale list buys. The picklist needs cleanup.

## Cases (354 total)

| Status | Count |
|---|---|
| Closed | 136 |
| 1st Contact Resolution | 115 |
| New | 43 |
| Zipline-Closed | 41 |
| Closed- Deferred | 19 |

**"Zipline" cases** — Zipline Interactive was the consultancy that built the original org. These cases predate current ownership. **The case object is barely used** (354 cases over 5+ years = ~70/year).

## Industries (top 25)

Medcurity is HIPAA compliance + cybersecurity for healthcare. Industry distribution confirms:

| Industry | Count |
|---|---|
| (null) | 1,757 |
| Hospital | 1,176 |
| Hospital & Health Care | 384 |
| Community Health Center (CHC) | 355 |
| Technology | 202 |
| Consulting | 171 |
| Rural Hospital | 125 |
| Behavioral Health | 108 |
| Rheumatology | 72 |
| Medical Practice | 62 |
| information technology & services | 60 |
| Accounting | 59 |
| Audiology, Orthopedics, Pediatrics, Women's Health, Family Medicine, Business Associate, Gastroenterology, Surgery, Non-profit, Neurology, Dental, Direct Care, Computer Software | 27-54 each |

**Picklist drift problems:**
- "Hospital" vs "Hospital & Health Care" — both used, should be one
- "information technology & services" (lowercase) vs "Technology" — both used
- "Computer Software" overlaps with "Technology"
**Action: Cleanup the Industry picklist before migration. Don't bring duplicate values to the new CRM.**

## Pricing structure

### 12 Pricebooks (one per FTE tier + standard)

```
1-20, 21-50, 51-100, 101-250, 251-500, 501-750, 751-1000,
1001-1500, 1501-2000, 2001-5000, 5001-10000, Standard (default SF)
```

### 155 Active Products

Split into 2 families:
- **Products** (73): "1-20 Business Associate Agreements Management", "1-20 Compliance Officer Training", "1-20 General Employee HIPAA Training", "1-20 Policies and Procedures", etc.
- **Services** (82): "1-20 Advanced Network Vulnerability Assessment", "1-20 Phishing Services", "1-20 MIPS Services", etc.

**Each product is duplicated across all 11 FTE tiers** — so there are really ~14 unique product concepts × 11 FTE tiers = 154 SKUs, plus 1 Standard. This is a SF Pricebook anti-pattern: instead of one product with 11 prices, they made 11 copies of the same product.

### Implications for new CRM pricing model

**Don't replicate the SF anti-pattern.** The new CRM should model:
- A `products` table with ~14 rows (one per actual product concept)
- A `pricing_tiers` table with 11 FTE-bucket rows
- A `product_prices` join table with 14 × 11 = 154 rows mapping (product, tier) → price

This unlocks:
- Adding a new tier (e.g., "10001+ Enterprise") in one row instead of 14
- Renaming a product without renaming 11 SKUs
- Reporting "show me all sales of HIPAA Training across all tiers" without enumerating 11 SKU names

The opp-line-item flows (`Apply_Opportunity_Discount_*`) become much simpler if Family is a product attribute that doesn't have 11 copies.

## Recommended picklist cleanups before migration

1. **Account.Industry**: collapse "Hospital" + "Hospital & Health Care", drop the lowercase "information technology & services" duplicate, dedupe Computer Software/Technology.
2. **Lead.Status**: drop "done" (lowercase). Decide on canonical names.
3. **Lead.LeadSource**: archive year-stamped conferences (CHUG19, AuDacity 2019/2021, CHCAMS 2023) — they're historical artifacts, not active sources.
4. **Opportunity.Type**: replace 4 messy values with a clean enum (`new`, `renewal`, `expansion_service`, `expansion_product`) and migrate the 640 default-value "Opportunity" rows to the most likely correct value.
5. **Account.Status**: decide what NULL means. Suggest: NULL → "Prospect" or move those rows to a separate companies table.
