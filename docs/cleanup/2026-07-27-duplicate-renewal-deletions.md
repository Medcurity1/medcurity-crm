# Duplicate auto-renewal cleanup — 2026-07-27

Nathan's go-ahead in chat 2026-07-27 ("you need to handle this. so do what you need
to do to clean out the confident duplicates and make sure task reminders and such
are also taken care of"). Executed same day via Nathan's authenticated prod session.

## Why these 11

Root cause: the renewal generator's only dedup was "does this parent already have a
child linked via `renewal_from_opportunity_id` (or a suppression row)?" Renewals
created by hand or imported from Salesforce in April carry no parent link, so their
parents looked un-renewed and the 2026-07-20 23:10 UTC batch run (75 children in one
microsecond) generated second copies.

Selection test (Nathan's retro test): a child was deleted ONLY if (a) it is
machine-made (batch/cron `created_at` fingerprint + `created_by_automation`), and
(b) the real renewal ALREADY EXISTED in Pulse before the child was generated AND
covers every product of the parent contract — i.e. the planned generator fix would
never have created it. Ambiguous cases (partial product coverage, Keena's
multi-contract chains) were NOT deleted; they went to Margaret/Rachel to judge.

Effect of deletion: `trg_opportunities_renewal_suppression` (20260612000001) writes
a `renewal_suppressions` row per parent, so none of these regenerate. Line items
cascade-delete. Logged emails/activities survive (`on delete set null`) and remain
on the account timeline. The real renewals still generate their own children next
cycle off their own contract dates.

## Deleted opportunities (11 — total $105,698.00)

| # | Account | Opp id | Name | $ | Parent id | Evidence (real renewal already there) |
|---|---|---|---|---|---|---|
| 1 | Greater Baltimore Medical Center (GBMC Healthcare Inc.) | aa10b2f5-9dab-4d2b-a292-3bd00f9c5749 | SRA \| Onsite Services | 44,654.00 | 353807ec-c8cf-4d7d-a72d-74278c80e5e0 | Margaret's OPEN manual twin, same name+$, created 2026-04-22 (child 7/20). Her deal stays; child's contract dates (2026-08-15 > 2027-08-15) worth copying onto it. |
| 2 | Keena Healthcare Technology (June chain only) | c82b4859-e369-4fc4-b03a-a5dbb849fbe4 | Custom Service | 13,200.00 | 3a3d2a51-fc46-44d7-aafe-d5f829c954b2 | Closed-won $13,200 Custom Service 2026-06-09>2027-06-09, created 2/28. Keena's other two children (Oct $13,200, $4,400) NOT deleted — with Margaret. |
| 3 | Summit Medical Center | 4de1cf45-71b6-4e44-9e1b-d72b36495a81 | Remote Services \| BAA \| SRA | 9,700.00 | 0561e244-b99c-4cb7-8a91-b5078570fe16 | Closed-won same products same $ 2026-01-21>2027-01-21, created 1/21. |
| 4 | Western North Carolina Community Health Services | b1630f08-a94c-47a3-b732-160e041216db | SRA \| Remote Services | 8,740.00 | 6a99e3a4-9541-49b3-b373-4777baae5353 | Closed-won same products same $ 2026-05-28>2027-05-28, created 3/3. |
| 5 | Speare Memorial Hospital | e4c72af2-5912-471f-b994-3a6235b8b240 | SRA \| Remote Services | 8,100.00 | a764ae01-b592-4dfc-b54b-9c20624b98d6 | Closed-won same products same $ 2026-06-09>2027-06-09, created 3/4. |
| 6 | Colorado Allergy & Asthma Centers, P.C. | b79979ed-3c23-4633-b78f-6364bf1e703e | Onsite Services \| BNVA \| SRA | 7,232.00 | 8157d0ff-4894-4378-a115-8006e6a5dbce | Closed-won same products 2026-05-28>2027-05-28 at $9,040 (price rise), created 3/3. |
| 7 | Galvanic Health | f805aa70-38b7-479c-8b51-2384928d70a0 | Remote Services \| BNVA \| SRA | 5,060.00 | 1a06d40e-3b30-4d58-ad6d-82431643b9b4 | Closed-won same products same $ 2026-07-20>2027-07-20, created 4/14. Renewal email thread stays on the account. |
| 8 | Southland Neurologic Institute | f779b068-10ef-46e6-b150-e97705d44171 | SRA \| Remote Services \| P+P | 4,600.00 | 07c8f1dc-39f5-4233-a989-5a6fc16ee6f2 | Closed-won same products same $ 2026-07-13>2027-07-13, created 4/5. |
| 9 | Speare Memorial Hospital | 5e9f9473-79ef-4539-b849-8e9748fb2c72 | Custom Service | 3,500.00 | ba549f8a-fd32-424c-bb1d-b3ed0a4e0871 | Closed-won same product same $ 2026-06-09>2027-06-09, created 3/4. Doc-request email thread stays on the account. |
| 10 | Listen Hear | 0ba9a6bd-d18c-48fc-81bf-ce579d88bddf | SRA | 456.00 | 6e354760-4661-4b7f-911f-6fe03f0f5bb1 | Summer's OPEN manual twin, same name+$, created 2026-03-28. Her deal stays. |
| 11 | Hearing Doctors of New Jersey | f24d0460-4390-4803-aa15-6f9f7450a440 | SRA | 456.00 | b67f56a9-679a-4b6b-954c-14d7889b4f3b | Manual twin closed LOST 7/27 (created 4/19) — customer declined the renewal. |

Key recreation fields, common to all 11 unless noted: `kind=renewal`,
`team=renewals`, `stage=proposal_conversation`, `contract_length_months=12`,
`contract_year=1`, `contract_signed_date=2026-04-25`, `created_by_automation=true`,
`automation_source=crm_renewal_v1`, `probability=90`, `name_auto_sync=true`,
`created_at=2026-07-20T23:10:38.734559Z`, `created_by=a226c531` (Nathan, ran the
batch), all bulk-claimed by Margaret (renewal_claimed_by=4bb689ed) 7/21–7/24.
Per-deal owner/close/contract-end/amount-splits:

| Opp id (short) | owner_user_id | close_date | contract_end | svc/prod split | payment | auto_renew | sig req |
|---|---|---|---|---|---|---|---|
| aa10b2f5 GBMC | 4bb689ed (Margaret; assessor 4bb689ed) | 2026-08-15 | 2027-08-15 | 0 / 0 (amount-only) | annually | false | yes |
| c82b4859 Keena | ca8df4d0 | 2026-06-23 | 2027-06-23 | 0 / 0 | annually | true | no |
| 4de1cf45 Summit | ca8df4d0 | 2026-07-10 | 2027-07-10 | 4900 / 4800 | monthly | true | no |
| b1630f08 WNC | (null owner) | 2026-06-26 | 2027-06-26 | 4900 / 3840 | annually | true | no |
| e4c72af2 Speare | ca8df4d0 | 2026-06-27 | 2027-06-27 | 0 / 0 | annually | false | yes |
| b79979ed ColoAllergy | ca8df4d0 | 2026-06-26 | 2027-06-26 | 4160 / 3072 (20% disc) | annually | true | no |
| f805aa70 Galvanic | 1d1eb93e (Summer) | 2026-08-07 | 2027-08-07 | 3800 / 1260 | annually | false | yes |
| f779b068 Southland | ca8df4d0 | 2026-07-29 | 2027-07-29 | 0 / 0 | annually | true | no |
| 5e9f9473 Speare CS | ca8df4d0 | 2026-06-27 | 2027-06-27 | 0 / 0 | annually | false | yes |
| 0ba9a6bd ListenHear | 1d1eb93e (Summer) | 2026-07-21 | 2027-07-21 | 0 / 456 | annually | false | yes |
| f24d0460 HearingDocs | 4bb689ed (Margaret; assessor 4bb689ed) | 2026-08-12 | 2027-08-12 | 0 / 456 | annually | false | yes |

## Deleted line items (13, cascade would have removed them anyway)

f805aa70 (Galvanic): 156b92fb qty1 @1800 −30% = 1260; 9268e139 qty1 @2800; db7fee93 qty1 @1000.
b79979ed (Colorado): 156b92fb @4800 −20% = 3840; 66286474 @4000 −20% = 3200; db7fee93 @2500 −20% = 2000.
4de1cf45 (Summit): 156b92fb @3900; 6214e7ad @900; 9268e139 @4900.
f24d0460 (Hearing Doctors): 156b92fb @456. 0ba9a6bd (Listen Hear): 156b92fb @456.
b1630f08 (Western NC): 156b92fb @3840; 9268e139 @4900.

## Deleted open reminder tasks (5)

| Task id | Subject | Owner | Due (born overdue) | Opp |
|---|---|---|---|---|
| 7416fda0-cf03-4c4b-9353-23c9decbd458 | New signature needed: SRA \| Onsite Services renewal | Margaret | 2026-06-16 | GBMC aa10b2f5 |
| c2188a8d-b0ed-4d62-89fa-0a0789d66d56 | New signature needed: SRA \| Remote Services \| BNVA renewal | Summer | 2026-06-08 | Galvanic f805aa70 |
| c4152c4c-94c6-4b3b-beb1-1fc4661bf0d4 | New signature needed: SRA renewal | Summer | 2026-05-22 | Listen Hear 0ba9a6bd |
| 67289f0c-ab62-4583-bac4-728f15bb5895 | New signature needed: SRA \| Remote Services renewal | (ca8df4d0) | 2026-04-28 | Speare e4c72af2 |
| f1e18d9a-96a4-4bbf-9349-9092756561d0 | New signature needed: Custom Service renewal | (ca8df4d0) | 2026-04-28 | Speare 5e9f9473 |

Task bodies were the standard template: "This renewal is on a non-auto-renew
account. A new contract signature is needed before the anniversary on <date>.
Created by renewal automation." Margaret's completed Hearing Doctors task and all
logged emails were kept (they detach to the account).

## Not deleted

- The 5 already-Closed-Won duplicates ($20,068.50: Blue Mountain, Hana, Ko-Kwel,
  Rheumatology & Osteoporosis, Beautiful You) — awaiting Margaret's confirmation,
  then Nathan deletes (RLS: closed_won deletes are admin-only).
- The 6 ambiguous ($39,069: Keena Oct $13,200, Keena $4,400, Universal Primary Care
  $7,300, Gunnison $6,906.50, Neurology Center $6,250, Camp Lowell $1,012.50) —
  with Margaret/Rachel.
- The other 74 open auto-renewals — legitimate.

## Undo

Re-inserting a deleted deal requires: delete its parent's `renewal_suppressions`
row, then recreate from the table above (or just let the generator recreate it on
the next daily run once the suppression row is removed — it will rebuild the child
with the same fields and line items from the parent).
