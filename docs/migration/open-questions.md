# Open Questions for Brayden

Things that came out of the SF exploration that need a human answer before the migration plan can be finalized. Grouped by urgency (P0 = blocks engineering work; P1 = needed before cutover; P2 = nice to know).

---

## P0 — Blocks engineering work

### Q1. HubSpot strategy

SF has a bidirectional HubSpot integration via the `HubSpot_Inc` "Daiquiri" v3.0 managed package (6 Apex classes, 4 Remote Sites, dedicated Connected App). **You only mentioned "I think we have HubSpot"** — confirm:

- (a) Is HubSpot the upstream system of record for marketing data, or SF, or both?
- (b) Post-cutover, do you want HubSpot to: (i) sync to the new CRM directly via webhooks, (ii) be replaced entirely by something else, or (iii) sit alongside the new CRM with manual handoff?

### Q2. Pardot / Account Engagement fate

The Pardot package (`pi` namespace v5.9) is fully installed with 390 Apex classes, 5 triggers, 4 Remote Sites. Are you actively using Pardot for marketing campaigns today, or has it been quietly abandoned?

- If actively used: it needs a Postgres sync target post-cutover (Pardot doesn't natively talk to non-SF CRMs).
- If retired: separate workstream to migrate or wind down.

### Q3. Medcurity Website API caller

There's a bespoke Connected App called "Medcurity Website API" (created 2020-06-23, never modified since). The associated SF user (`brandon.perdue@ziplineinteractive.com`, "Website API") has been inactive since the day it was created.

- (a) Is the public website still pushing leads/contacts into SF via this Connected App? Or is it broken / using a different integration now?
- (b) If yes — the website needs to be repointed at the new CRM's inbound API before SF cutover. Who owns the website codebase?

### Q4. The 30,943 stale "New" leads

72% of all SF leads (30,943 of 42,697) have Status="New" and have never been worked. They came from purchased lists (Cold Call SMB, eClinicalWorks List, Medibeat, Athena List). Migrating them to the new CRM as `leads` would inflate the leads table 4x with cold/expired records.

What do you want to do with them?

- (a) Archive to a separate table for compliance, hide from working views
- (b) Move to a "lead lists" feature for re-prospecting
- (c) Drop entirely
- (d) Something else

### Q5. Cases — drop or rebuild?

SF has 354 Cases (~70/year over 5+ years). Many are old "Zipline-Closed" cases from the prior consultancy era. **Staging has no Cases section.**

- Is customer support handled in another tool now (Zendesk/Intercom/Front)? If yes → drop.
- If still using SF Cases → need to add a Cases section to staging.

### Q6. Knowledge — drop or rebuild?

SF has Knowledge configured as `Knowledge__kav` (standard SF Knowledge) with two custom fields (`Question__c`, `Answer__c`). The Knowledge license isn't even granted to API queries, suggesting near-zero use.

- Confirm: is anyone reading or maintaining Knowledge articles in SF today? If no → drop.

### Q7. Renewal_Type values to skip

The SF renewal flow queries `Account.Renewal_Type__c` but never uses it (a bug). The new CRM should honor it. What renewal_type values mean "do not auto-renew"?

- Likely candidates: 'no auto renew', 'manual only', 'opt out'
- Need the actual list before the new automation can be wired up

### Q8. "Every Other Year" semantics

SF queries `Account.Every_Other_Year__c` but never uses it. For the new automation:

- (a) Should `every_other_year=true` accounts skip every other renewal entirely?
- (b) Or are they on biennial 2-year contracts that need different cycle math?
- Need the actual semantics before wiring up.

### Q9. Brayden's SF identity

There's a "Brayden Reports" folder with 43 reports (17 actively used). **`braydenf@medcurity.com` is NOT in the SF user list.** The folder must belong to a different person named Brayden, or it's a personal folder that pre-dates your involvement.

- Who is the Brayden in "Brayden Reports"?
- Are those reports yours (under a different SF email) or someone else's?

---

## P1 — Needed before cutover

### Q10. The 2025 Task volume explosion

Tasks created per year: 87 (2020), 459 (2021), 8 (2022), 246 (2023), 223 (2024), **4,272 (2025)**, 1,330 (YTD 2026, on pace for ~4,000/year).

What changed in early 2025 to drive a 17× increase in Task creation?

- A new sales process / required activity tracking?
- A new automation kicking in (Send_Notification_for_Renewal_Opportunity ramping?)
- Adoption of Salesforce Inbox / Outlook integration creating tasks automatically?
- A new manager / process change?

This matters because it affects how we design the Tasks UI in the new CRM.

### Q11. NotificationEmailSubject / NotificationEmailBody

The `Send_Notification_for_Renewal_Opportunity` flow creates a Task with subject and body from variables I couldn't find in the metadata. Pull the actual text from a recent reminder Task in SF (or share what you want the new reminder to say).

### Q12. 3-year contract pull-back rule

Renewal flow has logic: "if 3-year contract AND Year 2 AND cycleCount=1 → use +11 months instead of +12." Description says "Fixing 3 year contract pull back (1 month)."

- Is this asymmetry correct (only Year 2, only cycle 1)?
- Should the same rule apply to Year 3?
- Or is this a band-aid for a one-time issue and shouldn't be in the new code?

### Q13. Account.Status NULL = ? **[RESOLVED 2026-04-16]**

5,080 of 5,642 accounts (90%) have `Status__c` = NULL. They're prospect/lead-list companies, not customers.

**Resolution from Brayden (2026-04-16):** Don't rely on the NULL values; derive `lifecycle_status` from deal + product history. Rules:

- **Active** if any currently-held product subscription is active (the most recent deal on that specific product is Closed Won and not yet expired, with no superseding Closed Lost for the same product).
- **Inactive** if every product the account ever bought has expired unrenewed or been lost without replacement.
- **The key nuance:** a Closed Lost deal doesn't demote the account if it's pitching a NEW product on top of an existing active subscription (e.g., customer has HIPAA Training Closed Won, sales pitched Phishing Services and customer declined → still Active).
- Accounts with no opportunity history → `prospect`.
- Accounts with open opportunities but no closed deals yet → `pending` or `discovery` depending on stage.

Full spec: see `account-status-derivation-spec.md`. The automation handles both import-time backfill and ongoing recomputation, so no user ever sets this manually.

### Q14. Opportunity.Type "Opportunity" = ?

640 of 2,207 opportunities have `Type='Opportunity'` (the literal default picklist value). What should they be re-categorized as during migration?

- Default to "Renewal" if Account.Status is Active?
- Default to "New" otherwise?
- Or leave as-is for manual review?

### Q15. The 160 ContentDocuments

Are the 160 file attachments business-critical (contracts, signed docs)? If yes, build storage migration. If no, skip.

### Q16. "Mel Nevala" duplicate user records

There are two SF user records: "Mel Nevala" (`melissan@medcurity.com`-ish) and "Mel (Old) Nevala (Old)" (`seanm@medcurity.com`). Looks like a name change incident. Should historical activity be merged under one staging user record?

### Q17. Email Templates worth saving

Of 21 email templates, only "Test 1" (used 5 times in 2021) and "Case Study Email" (used 4 times in 2024) have ever been sent. Confirm: drop all? Or migrate Case Study Email?

---

## P2 — Nice to know

### Q18. OIQ (Sales Insights) usage

The OIQ Sales Insights package is installed but appears unused. Is anyone using Sales Insights features (Inbox-style email tracking, etc.) today? If no — confirm we can drop.

### Q19. The "Pardot" Q4 24 & Q1 25 of Accounts for Renewals report

There's a report named "Q4 24 & Q1 25 of Accounts for Renewals" — implies a quarterly renewal review process. Is this a real cadence we should formalize in the new CRM (e.g., a quarterly "renewal review" view)?

### Q20. Cases: "Zipline-Closed" status

41 cases have status "Zipline-Closed" — referencing the consultancy that built the original SF org. These predate current ownership. Should they migrate (with status mapped to "closed")? Or drop as historical cruft?

### Q21. Account.Time_Zone__c, Contact.Time_Zone__c, Lead.Time_Zone__c

Time zone fields exist on three entities. Used for outbound call timing? Email send time? Just informational? Worth understanding before deciding whether to add to staging.

### Q22. The 8 Campaigns

Of the 8 SF campaigns, "Medcurity User Group Meeting" has 219 contact attendees. Is the User Group an active program? Should staging have a way to track event attendance, or is this one-off?

### Q23. The 2 active Knowledge articles (if any)

If Q6 says Knowledge is used, share the article topics so we can decide whether to migrate or just refresh.

### Q24. Picklist value cleanups for Industry

I plan to merge:
- `Hospital` (1176) + `Hospital & Health Care` (384) → `Hospital`
- Drop lowercase `information technology & services` (60), keep `Technology`
- Merge `Computer Software` into `Technology`

Confirm or correct.

### Q25. ARR — is the SF report accurate?

Brayden has an "ARR - Chad" report. Worth confirming the ARR formula being used, since the new CRM will need to reproduce it.

### Q26. The "New Customers/Quarter (not 100%accurate)" report

This report's name literally says "not 100% accurate." What's known to be wrong with it? Should the new CRM's equivalent fix it, or replicate the inaccuracy for continuity?
