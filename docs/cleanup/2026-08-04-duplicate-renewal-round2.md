# 2026-08-04 duplicate-renewal cleanup, round 2 (PPoU / Hinet / Citizens) + the 8/5 Joe review

Round 2 of the 7/27 cleanup (see `2026-07-27-duplicate-renewal-deletions.md`),
from Joe's 8/3 forward of the renewals report. Done on PROD 2026-08-04 by a
Claude session on Nathan's go, written up here 2026-08-05 (the 8/4 session
recorded it only in SHIPPED.md; this file is the durable record).

## What was archived (not deleted; every record carries its reason in notes)

| Account | Kept | Archived | Why |
|---|---|---|---|
| Planned Parenthood of Utah | claimed child 698457f0 ($7,450) | unclaimed 4/18 SF-import stub ec317f41 (identical) | Pre-fix duplicate pair; 5 emails moved to the kept renewal |
| Hinet Managed IT | claimed 7/20 child 0b9d1113 ($2,784) | unclaimed 4/18 SF-import stub aba6f456 ($3,480) | Pre-fix pair; 84 emails moved to the kept renewal; PRICING FLAG stamped on survivor (SF copy said $3,480 = 25% raise vs last year's $2,784) — Dan must confirm the right price before proposing |
| Citizens Medical Center | bundle child d48598cd ($19,800, "SAFER \| SRA \| Onsite Services") | standalone $0 SAFER child 9dc56afe + its duplicate signature task | SAFER judged included in the bundle |

## The 8/5 Joe review of the Citizens call

Joe (8/5): **"If SAFER isn't one of the products in the bundle renewal, then
leave the separate listing in place. We do want to track all products sold,
even @ $0."**

Verified live on prod 8/5: the bundle renewal d48598cd carries SAFER as a real
**$400 product line item** (SRA $11,200 + Onsite $8,200 + SAFER $400 =
$19,800), covering the same service year (Nov 18 2026 → Nov 18 2027 vs the
archived one's Nov 24 2026 → Nov 24 2027). The archived $0 SAFER's own
description said "We gave them free SAFER Module access for signing the SRA.
We need to add the $400 SAFER pricing to next year's opportunity" — which is
exactly what the bundle does. **Joe's restore condition was NOT met; the
archive stands. No prod change made on 8/5.**

## The standing rule (save for every future cleanup)

- **Every product sold stays tracked, even at $0.** A $0 deal is often an
  intentional obligation (free first year, signing bonus) and may carry
  follow-up pricing instructions in its description.
- Never archive/delete a listing as "redundant" unless the SAME product is
  verifiably a **product line item** on another deal covering the SAME
  period. Check line items, not deal NAMES (Citizens' bundle child was named
  "SAFER | SRA | Onsite Services" while its parent was named
  "| SRA | Onsite Services" — names lie in both directions).
- When in doubt, ask Joe/Nathan before acting.

## Undo (if ever needed)

The archived records still exist (archive, not delete): clear `archived_at`
on opp 9dc56afe / ec317f41 / aba6f456 and the Citizens signature task, and
remove any `renewal_suppressions` row written for their parents.
