# DOCKET — current & future work

Everything requested, planned, or ideated that is NOT yet shipped. **This is Claude's primary tracking system across sessions — it must be 100% current.**

## Rules (read before touching this file)

1. **One item per row.** Never bundle sub-items into one line — bundled items hide staleness (this file's 2026-07-27 audit found 10 dead sub-items buried inside 3 bundled lines).
2. **Every row carries a `Verify` recipe and a `Checked` date.** The recipe must re-prove the item is still open, from code or live data, with no memory required.
3. **Never report a row as current without re-running its Verify first.** "It's in the docket" is not evidence.
4. **Close rows in the same commit as the work.** Move to `SHIPPED.md`; do not leave tombstones here.
5. **Re-audit anything `Checked` more than ~14 days ago** — run `/docket` (`.claude/skills/docket/SKILL.md`).
6. **Build work and decisions only.** Not other people's job tasks, not Nathan's personal to-dos.

Statuses: `IDEA` · `QUEUED` · `IN PROGRESS` · `BLOCKED` · `STAGING` (awaiting prod)

---

## A. Awaiting a person

| # | Item | Who | Detail | Verify | Checked |
|---|---|---|---|---|---|
| A3 | Campaign copy for 8-Touch + Warming presets | Jordan Mayer / Nathan | **IN PROGRESS 8/18:** Jordan's fixed 8-Touch source was recovered from Nathan's pinned email and migration `20260818150000_campaign_8touch_fixed_copy.sql` now loads all four email bodies plus the call/LinkedIn task notes with AI drafting disabled. Summer's pinned nurture source is six emails over ten weeks, so it is being used for the owned-address Warming test but has not been silently substituted for the separate three-email/eight-day Warming preset. | Prod Warming preset still shows `content_ai_draft:true`; prod 8-Touch must show four populated email steps after promotion | 2026-08-18 |
| A4 | On-Site Fee: confirm "under 250" = 249-and-below | Molly | She answered in June ("$500 under 250, $1,000 for 250 or more"), but **383 prod accounts sit at exactly fte_count 250** — worth her saying yes with that number in view before they flip $500→$1,000. | `accounts?fte_count=eq.250&archived_at=is.null` count = 383 | 2026-07-29 |
| A11 | Hinet renewal price: Dan confirms $2,784 vs $3,480 before proposing | Dan | Remainder of the 8/4 duplicate cleanup (round 2, see docs/cleanup/2026-08-04-duplicate-renewal-round2.md): the kept Hinet renewal 0b9d1113 is priced $2,784 (last year's close) but the archived SF stub said $3,480 (a 25% raise) — a pricing flag is stamped on the survivor; Dan confirms which before it goes out. CLOSED with the rest of A7: PPoU + Hinet stubs archived 8/4 (SHIPPED); Citizens $0 SAFER question RESOLVED by Joe 8/5 (SAFER verified as a $400 line item on the bundle, archive stands, no restore). Optional leftover: 6 Brayden Test Account husks could be archived someday. | prod: opp 0b9d1113 notes still carry the pricing flag and amount still 2784 | 2026-08-05 |
| A10 | Flag the rest of the bi-annual clients (EOY status fix follow-up) | Rachel/Summer (which accounts) + Nathan | The 8/5 every-other-year fix (SHIPPED) keys off accounts.every_other_year, which is set on exactly ONE prod account (North Sound, flipped 8/5 as the live verification — badge went Former Customer→Customer instantly). Other bi-annual clients still show Former Customer until flagged. LIST DELIVERED to Nathan 8/5 (biannual-candidates-2026-08-05.csv, from the prod ARR Base Dataset export): 9 repeated-2yr-pattern accounts, 5 in-gap-with-next-deal (incl. North Sound, already flagged), 22 single-win-~2yr-stale for review, 1 clear tri-annual (Hope Health, 36mo). AWAITING: Rachel's confirmed subset, then flag the boxes (bulk data change = Nathan's go). Rachel is handling the flagging herself off the list (Nathan 8/5: not waiting on her). Tri-annual pair (Hope Health + Unity Hospice) needs the cadence build on prod (B25) before it can be set. | prod: accounts?every_other_year=eq.true count still 1 (only North Sound) | 2026-08-05 |
| A14 | Summer: the 9 MN hospitals already in the CRM — flip to Prospecting? | Summer (or Nathan on her behalf) | The 8/7 MN load created the 16 genuinely-missing accounts. Nine names from her list already existed and were LEFT ALONE on purpose: CCM Health, Community Memorial, Cook Hospital, Hendricks Community Hospital Association, Johnson Memorial (all hers, already Active/Prospecting-ish), Lake Region Healthcare (2 unassigned records — also a dedup candidate), Mille Lacs Health System (Molly's, state wrongly set to Michigan), North Valley Health Center (unassigned, no state), Windom Area Health (Molly's, no state). Open question is only for the ones owned by someone else or unassigned — don't steal Molly's accounts without her say. Also worth fixing: Mille Lacs state MI→MN, North Valley/Windom missing state, Lake Region duplicate pair. | prod: `accounts?q=mille lacs` still shows state Michigan | 2026-08-07 |
| A19 | Notification sounds: the six-sound swap — ON STAGING, awaiting Nathan's listen | Nathan | Nathan 8/18: six-sound swap built and on Staging. **8/18 audit polish (local, not pushed):** hidden tabs play Pulse audio; OS banners silent; unlock at volume 0; autoplay failure queued; overlapping ringtones stop including cloned WAV repeats; **stop also clears the autoplay-failure queue** so a cancelled alert cannot replay when the tab is shown again; follow-up due has a picker row; high-five Duration is hidden. NEXT: Nathan listens on staging (focused and background tabs), then prod promote needs his explicit go. | staging: `grep -c 'value: "' src/features/notifications/NotificationSettingsPanel.tsx` = 6 and KEPT_SOUNDS = felt/quill/lantern/musicbox/bloom/beacon; prod still shows the old 7 until promoted | 2026-08-18 |

---

## B. On staging — awaiting prod go-ahead

| # | Item | Who | Detail | Verify | Checked |
|---|---|---|---|---|---|
| B41 | Collateral announcement mobile layout | Nathan live QA 8/18 | At 390px, stack the copy and full-width action while keeping dismiss clear; preserve the desktop row. Production stays blocked until this exact follow-up clears Staging. | focused layout tests + production build + live 390px Staging check | 2026-08-18 |
| B39 | Collateral v1.2 design tweaks — STAGING, awaiting Nathan's prod go | Jordan Mayer (v1.2 docx 8/11) via Nathan's build brief 8/18 | All 14 spec changes plus Nathan's live round, on Staging. **8/18 audit polish (local, not pushed):** family-chip invert fix; image cards dropped `no-referrer`; pinned row labeled when filters are on; empty-state copy points at Request. **Phone QA:** the New: Collateral banner now stacks on small screens (copy above a full-width Open Collateral, dismiss stays absolutely positioned). Prod promotion = Nathan's explicit go only. | prod: collateral_settings.visible_to_roles still `{admin,super_admin}` and prod sidebar still shows the ADMIN badge on Collateral (v1.2 not promoted) | 2026-08-18 |

---

## C. In progress

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| C2 | Nexus "Your Day" overhaul — hide/tune live on Staging | Nathan 2026-07-29. Phase 1 (ranked queue + Briefing), landing flip, and the clearer **Meeting prep** presentation are live on Staging. The existing `paused_reason=meeting_booked` queue source now uses that label throughout the briefing, counts, cards, and Tune your list; it opens the account and keeps the stored category stable so existing snoozes/hides survive. REMAINING: Jordan M's plan review sign-off and H3 Home hard-remove. Plan: `docs/nexus/your-day-plan.md`. | `4236019`, CI 32213030800, focused day-queue tests | 2026-08-18 |
| C1 | Campaigns overhaul (the big project) | Phases 1–5 built + the full 2026-07-28 outside-review program (7 batches); admin-only + staging-gated until Nathan tests. **Nathan's testing STARTED 2026-08-04**. **8/18 Staging `7f09717`, run 32202640453:** audit polish plus a simpler template path: pick template, choose people, review and launch; sequence details stay collapsed and custom is secondary. Combined tree passed 736 tests, full build, exact deploy, and live desktop/390px flow checks with no browser errors. Production is excluded. Plan: `docs/campaigns/campaigns-plan.md`. | `grep -n "AdminGate><PlaybookPage" src/App.tsx` + `grep -n '"/playbook"' src/components/layout/Sidebar.tsx` shows the Admin badge | 2026-08-18 |

---

## D. Queued — buildable now

| # | Item | Who | Detail | Verify | Checked |
|---|---|---|---|---|---|
| D1 | Campaigns public launch checklist | Nathan | (1) Jordan's copy into presets; (2) flip ACTIVE_ANNOUNCEMENT in AnnouncementBanner.tsx; (3) remove admin gates at the 3 flip points (App.tsx route, Sidebar adminItems, ContactsList right-click). Also decide the 2 Playbook GH workflows disabled since 6/26 — likely superseded by the Campaigns engine. Prod Smartlead activation is COMPLETE (2026-07-29, Nathan's "turn the nightly thing on"): API key was already set; the campaigns_daily_sweep cron is now installed on prod (10 13 UTC daily, key-inline command pasted by Nathan himself — GUC route blocked by 42501 on prod) and proven with a supervised run: ok=true, 0 errors, 49 campaigns synced, 13 left for next run by the step-1 budget. (The leads_per_day clamp, formerly item 4 here, shipped 2026-07-27 — see SHIPPED.) | `grep -n ACTIVE_ANNOUNCEMENT src/components/AnnouncementBanner.tsx` | 2026-08-04 |
| D2 | On-Site Fee: price on raw headcount | Molly | Tier buckets can't express her rule (250 sits inside "101-250", and that bucket function is global to all pricing). Fix = price this ONE fee off `coalesce(fte_count, employees)` with the split at ≥250 → $1,000. Gated on A4. | `grep -n 'employees <= 250' src/lib/formatters.ts` still global | 2026-08-04 |
| D3 | On-Site Fee: auto-add when on-site SRA selected | Molly | Her Q3 answer said yes. Never started. | `grep -rn 'on-site-fee' src/features/opportunities/` returns nothing | 2026-08-04 |
| D6 | PandaDoc webhook wiring | (6/24 audit) | `supabase/functions/pandadoc-sync/` exists but is deliberately NOT CI-deployed (manual deploy only, per both Azure workflows). Wiring + verifying is open. | `grep -n pandadoc .github/workflows/azure-static-web-apps-*.yml` shows it in the NOT-deployed list | 2026-08-04 |
| D7 | Over-suppression decision | Nathan | NOT an enforcement gap — playbook-smartlead re-checks the Do-Not-Email list server-side and distrusts client filtering (index.ts:544, 1232). The open question is whether the current suppression *breadth* is right. | Decision, no code check | 2026-07-29 |
| D8 | Leadership-numbers fixes | (6/24 audit) | See `docs/audit/`. | `docs/audit/2026-06-24-full-audit.md` | 2026-08-04 |
| D9 | Guided account-creation popup | needs a new owner | Originally Brayden's; he's no longer with the company. Partly delivered by the 7/8 Closed Won gate; the guided CREATE popup was never built. Nathan to decide if anyone still wants it. | `grep -rn 'guided' src/features/accounts/` returns nothing | 2026-08-04 |
| D10 | 155 pre-horizon renewal parents | (optional hygiene) | 2024-vintage, anchors 6–18 months past. Automation never touches them; the covering-deal dedup protects the future. Optional: anchor-based suppression sweep + give v_renewal_audit an anchor horizon. Any future sweep must use the GENERATOR's anchor, not the audit's close+12mo. | Nothing at risk; informational | 2026-07-29 |

---

## E. Queued — Campaigns polish

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| E6 | Sweep status view readable by authenticated (LOW) | v_campaigns_daily_sweep_schedule_status granted to `authenticated` — matches the existing cron-view precedent. | `grep -n v_campaigns_daily_sweep_schedule_status supabase/migrations/20260722200000_*.sql` | 2026-08-04 |
| E7 | Step column stuck on "Not sent yet" | Stays until events carry sequence numbers. Could infer email-1-sent from campaign metrics. | `grep -n stepLabel src/features/playbook/CampaignDetailSheet.tsx` | 2026-08-04 |
| E8 | Right-click launch: collapse the Recipients step | **STAGING VERIFIED 8/18:** a contact/list right-click now keeps its recipients locked, shows a compact "Going to" confirmation, runs Do-Not-Email and active-enrollment checks in place, and skips the full audience-builder step. Failed checks block progression and expose Retry. Live staging contact path showed `1 eligible` before enabling Launch settings. | Repeat with a known suppressed and already-enrolled staging contact before production to verify the visible exclusion/override states | 2026-08-18 |
| E9 | Right-click launch: offer custom campaign, not presets-only | **STAGING VERIFIED 8/18, picker restacked 8/18:** custom is still available from a contact/list right-click, now as a secondary "Or start a custom campaign" choice under the templates. The same AI wizard handoff and locked-recipient path remain. | `grep -n "Or start a custom campaign" src/features/playbook/QuickCampaignDialog.tsx` | 2026-08-18 |
| E10 | Per-launch sequence editing exists but isn't discoverable | **PARTIAL 8/18:** Review and launch now has a visible Edit sequence button; the saved template stays untouched and edits still apply to this launch only. Remaining: a one-click edit control on each collapsed step, not only the whole-sequence button. (Copy itself still blocked on Jordan M, A3.) | `grep -n "Edit sequence" src/features/playbook/CampaignWizard.tsx` | 2026-08-18 |
| E11 | Sanitize campaign reply bodies everywhere | **LOCAL VERIFIED 8/18, ready for staging:** the new browser/Edge normalizer keeps the human reply and removes HTML, quoted history, marked signatures, CID images, and trackers. Future contact activities/tasks store the readable version; raw `campaign_events` stays as the audit source; the Replies feed cleans historical raw events. Calendar task HTML escaping was also closed. Existing QA task/notification rows are intentionally not rewritten. Independent review has no staging blocker; 592 tests + production build + Edge parse checks pass. | Prod still shows the pre-fix raw QA task/reminder; local `extractReplyBody` calls `normalizeReplyText`, and `stopEnrollmentForReply` stores `readableReplyBody` | 2026-08-18 |
| E12 | Campaign merge fields need grammar-safe automatic fallbacks | **LOCAL VERIFIED 8/18, ready for staging with the current Campaigns batch:** the editor now shows friendly First name / Organization / Signature controls, while the launch server converts both new and legacy copy to Smartlead Liquid fallbacks (`there`, `your organization`) and `%signature%`. Preview uses a real selected recipient when available and readable fallbacks otherwise. Manual task merge also supports company aliases, the responsible rep's name, and their new self-service outreach phone. | `tests/campaignContent.test.ts` passes; production still has the pre-fix blank-company QA email until this batch is promoted | 2026-08-18 |
| E13 | Campaign signature and tracking HTML must render reliably | **PARTIAL LIVE PROOF 8/18:** controlled staging send `STAGING QA — Summer → Nathan — 2026-08-18` / Smartlead #3820917 reached Outlook with one complete Summer signature, working visible website/LinkedIn treatment, and no visible broken-image boxes. The message source/accessibility tree still carries Smartlead's tracker image `alt="line"`; first-load Gmail plus light/dark/mobile and explicit tracking policy remain open. | Preserve the received Outlook proof; finish Gmail/light/mobile QA and decide open/click tracking before external launch | 2026-08-18 |
| E14 | Reply alerts are redundant and immediate reminders are noisy | **STAGING VERIFIED + PRESENTATION POLISHED 8/18:** Nathan replied `QA stop test — staging campaign reply ingestion check.` to Smartlead #3820917. Pulse recorded one clean reply, moved the enrollment to Replied/stopped, showed exactly one dedicated reply notification and one due-now follow-up task, and produced no generic assignment bell or instant reminder email. A follow-up display layer now converts legacy raw-HTML campaign reminders into readable reply text, shortens the old assignment/reminder headings, and gives future reply alerts/tasks brief punctuation-first copy instead of campaign-name chains. | Campaign detail shows 1 sent / 1 open / 1 reply and enrollment Replied; notification display tests cover the three legacy rows from production QA | 2026-08-18 |
| E15 | Salesperson-grade guided Campaign Builder | **IN PROGRESS 8/18:** Write-first editing, friendly body and subject personalization, recipient-aware previews, protected advanced HTML, automatic copy validation, self-service outreach phone, compact locked quick-start audiences, accessible Custom/preset choices, and natural task previews are built on staging. The four-row Launch readiness checklist consistently gates copy, audience safety, a confirmed Smartlead connection, and a current non-full selected inbox through the final confirmation. Controlled campaign `STAGING QA — Summer → Nathan — 2026-08-18` launched from staging as Smartlead #3820917 with one internal recipient and four Pulse tasks; its send/reply loop passed. The sequence-summary fallback leak was fixed on staging. The hardening batch prevents friendly editor chips from double-wrapping provider fallbacks, bounds untrusted reply parsing, safely substitutes `$` in task merge values, reports failed Smartlead start/task setup with a Pulse recovery step, corrects draft-start guidance, and enforces the server's 10,000-recipient ceiling. Meeting/opportunity detection now pauses the individual lead in Smartlead before Pulse records the automatic pause. Remaining verification: E13 client/tracking proof, edited-copy/subject live render, meeting-booked Smartlead pause proof, and all four sales-user entry paths. | Walk each entry path as a sales user; any raw token, unexplained setting, duplicated recipient, suppressed recipient, unknown sender, or launch without all-green preflight keeps this open | 2026-08-18 |
| E16 | Keep Campaigns confirmation and input surfaces Pulse-themed | **IN PROGRESS 8/18:** Nathan wants two-click confirmations, calendars, and similar interaction surfaces rendered inside Pulse instead of browser/OS-native boxes. Campaign launch, stop/delete, unsaved-work, template deletion, and enrollment-stop flows already use Pulse dialogs. The remaining Campaigns native confirms were found in Clear audience and newsletter-draft deletion; both now use the shared Pulse ConfirmDialog locally, with a regression test covering the full playbook feature folder. Native date/time inputs were not present in Campaigns. | `rg -n 'window\\.(confirm|alert|prompt)|\\b(confirm|alert|prompt)\\(' src/features/playbook` returns no UI calls; visually verify both dialogs on staging | 2026-08-18 |
| E17 | Campaign reply follow-up tasks must be actionable and readable everywhere | **LOCAL VERIFIED 8/18:** Production QA exposed a legacy reply task whose long Campaign name and raw Outlook HTML leaked into Nexus, the activity detail page, and the general editor. The shared activity presentation now turns it into `Follow up with <email>` plus only the new reply text across Nexus, task lists, timelines, detail, and editing. Nexus gets a direct Done action; the full task page gets Mark complete/Reopen; completion refreshes Nexus immediately. The edit dialog is wider, scroll-safe, uses a responsive type grid, and presents campaign follow-ups as a locked task type instead of a clipped row of activity choices. Future reply tasks were already being stored with clean wording. | Visually verify the legacy-shaped task on staging, complete/reopen a disposable staging task, and confirm it leaves/returns to Nexus | 2026-08-18 |

---

## I. Campaigns outside-review (2026-07-28 fleet audit) — Nathan approved "go for it on your list"

Source: `docs/audit/2026-07-28-campaigns-outside-review.md` (61-agent read-only audit; 22 confirmed + 1 plausible bugs, 147 unverified findings, 129-idea roadmap). The 4 worst confirmed bugs shipped same-day (see SHIPPED 2026-07-28). Everything below is verified-real and still open.

### I-a. Remaining confirmed bugs

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| I14 | v_marketing_suppression recomputes 11 branches per check, unindexable | CTE referenced 7× (materialized), email from lateral unnest → `.in()` can't push to an index; every launch pays full recompute per 500-batch. | view def in 20260728100000 (unchanged structure) | 2026-07-31 |
| I20 | Orchestration engine has zero automated test coverage | All 7 campaign test files import only _shared pure modules; launch/status/sweep/webhook handlers untested — where every confirmed bug lived. | `grep -rln 'from "..*functions/\(playbook-smartlead\|campaign-webhooks\)/index' tests/` = 0 (no test imports a handler module) | 2026-08-04 |

### I-b. Approved next builds (top experience wins)

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| I31 | Everything else from the review | 147 unverified findings + the full 129-idea roadmap (18 themes) live in the report — mine it when each area is touched. | `docs/audit/2026-07-28-campaigns-outside-review.md` exists | 2026-08-04 |
| I34 | Rep-rollout flip: three RLS prerequisites from the review builds | (1) campaign_enrollments.owner_user_id now carries the CONTACT's owner, so `campaign_enrollments_read_own` alone would hide co-workers' enrollments from a campaign's owner — the flip needs an additional "enrollments of campaigns I own" SELECT policy, and 20260723040000's comment claiming enrollments carry the campaign owner is stale. (2) campaign_drafts RLS is admin-ALL; the wizard scopes per-user in the QUERY (fetchLatestCampaignDraft) — the flip needs a real per-user policy. (3) lead_lists RLS is own-or-admin, so the wizard's "From a saved list" source only shows a rep their OWN lists — the marketing→sales list handoff needs a deliberate widening (e.g. share non-working lists) or the helper text changed to "your own lists". | `grep -n "campaign_enrollments_read_own" supabase/migrations/20260723040000_campaigns_rep_access_rls.sql` — no campaign-owner policy beside it | 2026-08-04 |

---

## F. Queued — low-priority bug pile (deferred with eyes open)

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| F2 | RLS InitPlan wraps missing on aux tables | Landed for exactly 5 tables (accounts, activities, contacts, leads, opportunities). opportunity_products, stage_history, products, user_profiles, audit_logs, … still unwrapped. | `grep -o 'on public\.[a-z_]*' supabase/migrations/20260721170000_*.sql \| sort -u` | 2026-08-04 |
| F3 | OpportunityContacts N+1 | One activities query per stakeholder. | `grep -n activities src/features/opportunities/OpportunityContacts.tsx` | 2026-08-04 |
| F4 | Last-activity views scan whole activities table | On unscoped sort paths. | view definitions in `supabase/migrations/` | 2026-07-29 |
| F5 | RenewalsQueue unvirtualized | Double table + ~13 full-list filter passes per totals memo. | `grep -c 'virtual\|Virtuoso' src/features/renewals/RenewalsQueue.tsx` = 0 | 2026-08-04 |
| F6 | Duplicate dashboard-metrics cache keys | TeamDashboard vs the standard report use colliding keys. | `grep -rn v_dashboard_metrics src/features/reports/TeamDashboard.tsx src/features/reports/standard/` — same view queried from two places with different cache keys | 2026-08-04 |
| F9 | v_renewal_audit's stale past_due note | The view's past_due reason text still promises the old wide lookback. Bundle into the next audit-view re-emit. (The other half of the old row — the generic "Already has renewal" preview label — shipped 2026-07-31 as "Renewal exists or dismissed".) Also stale in the same emit: the view's has_live_renewal reason text says "a live child renewal exists" but the flag ORs in manual suppressions. | `grep -rn 'past due' supabase/migrations/20260727130000_*.sql` — note text unchanged by any later migration | 2026-08-04 |
| F11 | read_only role sees Lists write buttons | RLS blocks the writes; the cosmetic gate is missing. | Lists UI role gating | 2026-07-29 |
| F13 | One empty April list | Was two (Nebraska Leads + FQHC); the 2026-07-29 audit found only ONE list with zero members remains on prod — worth telling Summer which, and FQHC rebuilds via Report Builder → Save as list if it was deleted. | prod `lead_lists` with no `lead_list_members` rows = 1 | 2026-07-29 |
| F14 | email_dup_status not pen-aware | Avoided/pending imports misclassified in dedup surfaces. Verifier-downgraded LOW. | `grep -rn email_dup_status src/` | 2026-08-04 |
| F15 | email_sync cron NULL-response noise (cosmetic) | Its every-10-min call exceeds pg_net's 5s wait; the function completes fine (verified by effect 7/27). Raising timeout_milliseconds would clear the noise from net._http_response. | prod `net._http_response` NULL status_code rows | 2026-07-29 |
| F16 | Last-activity DB views miss contact-only activities | Same blind spot B37 fixed in the UI: v_account_last_activity / v_accounts_with_activity roll up only rows with account_id stamped, so the ~124 historical contact-only rows (and their accounts' "last touch") are invisible to list sorting/rotting indicators. B37's write-side stamp stops NEW orphans, so this is bounded to history. Fix = re-emit the views joining through contacts (or backfill account_id on the 124 with Nathan's go — bulk data op). | `grep -n "where a.account_id is not null" supabase/migrations/20260707000001_last_activity_views_include_events.sql` — join-through-contacts absent in any later migration | 2026-08-14 |

---

## G. Ideas / someday

| # | Item | Who | Detail |
|---|---|---|---|
| G0 | Reports tab information architecture rethink | Nathan | 2026-07-29: Reports now spans two very different meanings of "report": analytics (financial metrics, team statistics, soon the full 16-metric catalog from the Nexus program) and operational pulls (Lists tab, Builder, e.g. cross-referencing customers out of a campaign). One tab is fine and the Reports name can likely stay, but the INSIDE needs deliberate organization (clear zones for Numbers vs Lists vs Builder) once the Nexus overhaul settles. Fine-tune later, not now. |
| G1 | AI smart lists | Nathan | Ask AI assembles a call list from natural language ("every non-customer in Washington"). Lists over reports because membership is editable without touching contact data. |
| G2 | CRM AI layer | Nathan | Describe-a-report, AI nav/search. Big project. |
| G3 | Ask AI → build a campaign | Nathan | "Find my prospects in the Southwest, start them on a 2-email campaign referencing our customer there." Future layer on the Campaigns overhaul. |
| G4 | Account Snake mini-game | Nathan | Deal Merger won the pick; snake "maybe another time". |
| G5 | Pulse Arcade hub | Nathan | Games list, profiles, records, daily events. Revisit at 6+ games (currently 3). |
| G6 | Reverse FTE autofill (opportunity → account) | Molly | One-way account→opp shipped; her ask was bidirectional. |
| G7 | Nexus called-by filter caps at 250 contact ids | (review note) | Sanity-check under real volume post-adoption. |
| G8 | Claim panel: "possible duplicate" badge | (from Joe's 8/3 dup report) | Both surviving dup halves sat unnoticed in the to-be-claimed queue. Run find_covering_renewal_deal per unclaimed row (or a batched view) and badge rows that already have a covering deal, so a dup half can't hide in the claim queue again. Small build. |

---

## H. Watch / verify later

| # | Item | Detail |
|---|---|---|
| H1 | Meddy widget 1h cache | Keep the meddy-chat edge fn backward-compatible ≥1h after widget-affecting deploys. |
| H3 | Home hard-remove decision (~2026-08-25) | Soft remove hit prod 8/11 (SHIPPED, promote fcfd6f2). If the ~2-week watch window stays quiet, ask Nathan for the HARD-remove go: delete HomePage.tsx + /home route + sidebar row + HOME_RETIRED flag, set NEXUS_FEEDBACK_LINK false. If anyone complains meanwhile: flip HOME_RETIRED false (one-line restore). |
