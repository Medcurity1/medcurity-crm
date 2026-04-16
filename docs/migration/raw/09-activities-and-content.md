# Activities, Email Templates, Campaigns, Files, Knowledge

Generated 2026-04-15.

## Headline findings

- **6,625 Tasks total, with a HUGE behavioral shift between 2024 and 2025**: 223 tasks/year in 2024 → 4,272 in 2025 → 1,330 YTD 2026 (still on pace for ~4000/year). Someone started using Tasks heavily in 2025. **Verify with Brayden what changed — possibly a new sales process, possibly a new automation, possibly Salesforce Inbox/Activity Capture being turned on.**
- **129 Events total** (calendar items) — much smaller volume than Tasks.
- **0 EmailMessage records** — emails are NOT logged into Salesforce. There's no "email-to-Salesforce" or Inbox capture configured. All email correspondence with customers lives outside SF (HubSpot likely).
- **6,546 of 6,625 Tasks (99%) have NULL Type** — Type field is unused. Don't bother carrying it forward.
- **Email Templates: 21 active, but only 2 have ever been used in 5 years** ("Test 1" used 5 times in 2021; "Case Study Email" used 4 times in 2024). All others are package defaults or unused. **Email-template feature can be dropped from new CRM scope — sales team writes ad-hoc emails in HubSpot/Outlook.**
- **Campaigns are essentially unused**: 8 total, mostly tests. Only 3 are "active" and 2 of those are auto-populated catch-all campaigns (`Created from Salesforce`, `Website Tracking`).
- **Account hierarchy is barely used**: only 45 of 5,642 accounts have a parent.
- **OpportunityLineItems: 2,579 line items across 1,253 opps. 954 opps (43%) have NO line items** — they're just top-level Amount values without product breakdown. This matches the renewal flow's behavior of not copying line items.
- **`Knowledge` is configured as `Knowledge__kav` (the Salesforce Knowledge article object)** with `Question__c` + `Answer__c` custom fields, but the Knowledge license appears not granted to my session — count couldn't be retrieved. **Likely zero or near-zero Knowledge articles in actual use.** The earlier finding of "1 bespoke custom object Knowledge__c" was incorrect — it's the `Knowledge__kav` standard Knowledge object with two custom fields tacked on.

## Tasks (6,625 total)

### By status
| Status | Count |
|---|---|
| Completed | 5,316 (80.2%) |
| Not Started | 1,306 (19.7%) |
| In Progress | 3 (0.05%) |

**"In Progress" is barely used.** Most tasks are created and either immediately marked done or left untouched.

### By type
| Type | Count |
|---|---|
| (null) | 6,546 (98.8%) |
| Other | 52 |
| Meeting | 27 |

### By creation year
| Year | Count |
|---|---|
| 2020 | 87 |
| 2021 | 459 |
| 2022 | 8 (lull) |
| 2023 | 246 |
| 2024 | 223 |
| **2025** | **4,272** |
| 2026 YTD (Apr 15) | 1,330 |

The 2025 explosion is striking. **Open question for Brayden: what changed in early 2025 that drove a 17× increase in Task creation?** Hypotheses:
- New CRM-required sales activity tracking
- A new automation (e.g., the renewal Send_Notification flow's task creation began ramping)
- Sales team adoption of Salesforce Inbox / Outlook integration
- New manager / process change

## Events (129 total)
Low volume. Calendar/meeting tracking is not happening in SF.

## Email correspondence: 0 EmailMessage records
SF is not the system of record for email. **Migration implication**: No email history to migrate. Customer email correspondence lives in HubSpot or sales reps' inboxes.

## Email Templates (21 active)

### Templates that have actually been used:
| Name | Subject | Times Used | Last Used |
|---|---|---|---|
| Test 1 | "Test 1" | 5 | 2021-06-09 |
| Case Study Email | "Medcurity Case Study" | 4 | 2024-03-07 |

### Bespoke templates (created but never used or no usage data):
- Cold compliance email string (Subject: "Security Risk Analysis")
- Email Two Compliance
- Contact: Follow Up (SAMPLE)
- Several "Appointment Confirmation" templates (likely SF Appointment package defaults)

### Service / Case templates (auto-fired by case workflows):
- Case Assignment Notification
- Case Comment
- Essentials Auto-Response Email to Customer
- Task Reminder Notification
- Service appointment templates (Scheduled / Rescheduled / Canceled)

**Migration recommendation**: Drop all email templates. Sales team uses HubSpot for outbound mail.

## Campaigns (8 total)

| Name | Active | Status | Type | Leads | Contacts | Notes |
|---|---|---|---|---|---|---|
| Created from Salesforce | Yes | In Progress | Other | 5,113 | 321 | Auto-populated catch-all for SF-created records |
| Website Tracking | Yes | In Progress | Other | 0 | 0 | Pardot/MCAE auto-tracking campaign |
| Medcurity Webinars | Yes | In Progress | Other | 0 | 0 | Webinar attribution placeholder, never populated |
| Medcurity User Group Meeting | No | Planned | Email | 0 | 219 | Past UG meeting, has 219 contact attendees |
| Abby Specialty Network Campaign | No | Planned | Email | 41 | 1 | Departed user's campaign |
| Test Campaign | Yes | Planned | Email | 0 | 0 | Test |
| TEST | No | Planned | Advertisement | 1 | 1 | Test |
| JAMISON TEST CAMPAIGN | No | Planned | Email | 0 | 0 | Test |

**Migration recommendation**: 
- Drop test campaigns
- Keep "Medcurity User Group Meeting" attendance data if event attribution matters
- Drop the Pardot auto-campaigns (will regenerate if Pardot stays)
- The campaign feature itself is unused for actual marketing — drop or defer

## Account Hierarchy: 45 accounts have a parent

Account hierarchy/parent-child relationships are barely modeled. Don't prioritize complex hierarchy support in the new CRM — flat structure is sufficient.

## OpportunityLineItem analysis

- **2,579 line items across 1,253 opps** = avg 2.06 line items/opp
- **954 opps have NO line items** = 43% of all opportunities are amount-only
- Reflects the renewal flow's known behavior: renewal opps inherit Amount but not product lines

**Implication for new CRM**: Decide whether opportunities REQUIRE line items, or whether amount-only opps are valid. Recommendation: support both, but make the renewal automation copy line items forward (the v5 draft flow that Brayden didn't finish).

## Files & Notes

- **160 ContentDocuments** (uploaded files attached to records). Small volume.
- **1 ContentNote** (Lightning notes). Effectively zero.

**Migration**: 160 files is small enough to download and re-upload manually if needed, or skip entirely if files aren't business-critical (verify with Brayden).

## Knowledge

Configured as `Knowledge__kav` (the standard SF Knowledge article object) with two custom fields: `Question__c`, `Answer__c`. The Knowledge license isn't granted to API queries, so I can't get a record count. **Likely 0 articles or single-digit articles in use.** Drop unless Brayden confirms it's used.

## Implications for migration

1. **Don't migrate task type/status complexity** — 99% of tasks are Type=null. A simple `tasks` table with description, due_date, status, owner, related_to (polymorphic) is sufficient.
2. **Don't carry email templates forward.** They're not used in SF. If sales team needs templates, they belong in HubSpot or a future email tool.
3. **Don't carry campaigns forward (yet).** No active marketing campaigns in SF. If campaign attribution is needed post-cutover, build it in the new CRM as a fresh feature.
4. **Decide the email tracking story:** if the new CRM should log inbound/outbound emails, that's a NEW feature not in SF today. Either build email logging in the new CRM, or rely on HubSpot for that history.
5. **Investigate the 2025 task explosion** before designing the tasks UI in the new CRM — understanding what drove it may surface a workflow that needs first-class support.
6. **Don't over-engineer Knowledge / FAQ support** until usage is verified.
