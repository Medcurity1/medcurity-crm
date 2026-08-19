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

---

## B. On staging — awaiting prod go-ahead

| # | Item | Who | Detail | Verify | Checked |
|---|---|---|---|---|---|

---

## C. In progress

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| C2 | Nexus "Your Day" overhaul — PHASE 1 IS LIVE on staging (row corrected 8/4) | Nathan 2026-07-29. **Correction from the 8/4 audit:** phase 1 shipped in late July under different names than this row's old Verify expected — the ranked next-best-action queue exists as the rep_day_queue RPC (migrations 20260729130000-210000) + Briefing.tsx (hero, top-3 cards, see-all, snooze-to-4am). Home-value absorption is also largely done as of 8/4: KPIs → MetricsStrip (B10), wins/recents/tasks/pipeline exist as widgets, quick actions in the hero. REMAINING: meeting-prep rows, Jordan M's plan review sign-off, and Phase 3 = the landing flip (H2/D14: move tab up, tour, banner, Home retirement). Plan: `docs/nexus/your-day-plan.md`. | `grep -n rep_day_queue src/features/nexus/day-queue-api.ts` (phase 1 live) + landing-flip.ts NEXUS_IS_LANDING still false (flip not done) | 2026-08-04 |
| C1 | Campaigns overhaul (the big project) | Phases 1–5 built + the full 2026-07-28 outside-review program (7 batches); admin-only + staging-gated until Nathan tests. **Nathan's testing STARTED 2026-08-04** — first feedback logged as E8/E9/E10; more expected. Plan: `docs/campaigns/campaigns-plan.md`. | `grep -n "AdminGate><PlaybookPage" src/App.tsx` + `grep -n '"/playbook"' src/components/layout/Sidebar.tsx` shows the Admin badge | 2026-08-04 |

---

## D. Queued — buildable now

| # | Item | Who | Detail | Verify | Checked |
|---|---|---|---|---|---|
| D1 | Campaigns public launch checklist | Nathan | (1) Jordan's copy into presets; (2) flip ACTIVE_ANNOUNCEMENT in AnnouncementBanner.tsx; (3) remove admin gates at the 3 flip points (App.tsx route, Sidebar adminItems, ContactsList right-click). Also decide the 2 Playbook GH workflows disabled since 6/26 — likely superseded by the Campaigns engine. Prod Smartlead activation is COMPLETE (2026-07-29, Nathan's "turn the nightly thing on"): API key was already set; the campaigns_daily_sweep cron is now installed on prod (10 13 UTC daily, key-inline command pasted by Nathan himself — GUC route blocked by 42501 on prod) and proven with a supervised run: ok=true, 0 errors, 49 campaigns synced, 13 left for next run by the step-1 budget. (The leads_per_day clamp, formerly item 4 here, shipped 2026-07-27 — see SHIPPED.) | `grep -n ACTIVE_ANNOUNCEMENT src/components/AnnouncementBanner.tsx` | 2026-08-04 |
| D19 | Submit Request dialog opens on the Collateral form by default — bugs get misfiled | Nathan 8/14 ("got a request notification for a collateral request but it literally wasn't one? take a look") | DIAGNOSED 8/14, fix awaits Nathan's pick. Dan Fairchild's client-impacting ZLCMS bug (order 2469 Is Paid + PAID BUT NOT PROVISIONED) was filed as type=collateral at 22:54 UTC: the top-bar SubmitRequestButton calls openRequestDialog() with no arg and RequestDialogProvider defaults `tab: "collateral"` (also the first tab pill), so the collateral form greets everyone and Dan typed his bug into it. Proof on the row (cae5371b): details still carry the collateral-form field partner_or_event plus retyped_from:"collateral". Blast radius: collateral routes to Nathan+Jordan M only (product routes to Makena+Rachel+Nathan), and ALL the 8/13 bug machinery (classifier, client-impact check, screenshot urging, Jira auto-file) lives on the product form only — so a misfiled bug bypasses dev entirely; MSD-1094 exists only because Dan also emailed Makena, and the request was manually retyped+completed same evening. First occurrence (only row ever with retyped_from; prior collateral requests all genuine). Fix candidates: (a) open on a type-chooser step with no pre-selected form (recommended), (b) product-first default, (c) run the bug-sniffer on collateral text too. | `grep -n 'tab: "collateral"' src/features/requests/RequestDialogProvider.tsx` + `grep -n "openRequestDialog()" src/features/requests/RequestDialogProvider.tsx` — default still collateral | 2026-08-14 |
| D16 | No way to mark an account "still a customer" by hand | Nathan (from Summer's 8/7 email: "unable to find where I can update Northwest Resources II back to a current client") | Customer Status is derived only. An override column EXISTS (`customer_status_override` + reason + at, RPC `set_account_customer_status_override`) but it is one-directional in practice: the ONLY writer is the closed-lost "still a client?" prompt (useClosedLostGuard.tsx:67), which can force **former_client**; AccountDetail exposes just `useClearCustomerStatusOverride` (the undo). Nothing anywhere can force **client**. So when deal history is wrong or thin (missing contract end date + last win older than cadence×365d), a rep has no lever and no explanation — Summer hunted for a field that doesn't exist. Options: (a) admin-only "Mark as current customer" with required reason, surfaced on the status card, reusing the existing RPC + the `clear_override` staleness logic already in 20260805120000; (b) cheaper: make the status card explain WHY it's Former Customer and name the lever (Renews Every / close a deal), which likely prevents most of these emails. | `grep -rn "p_override: 'client'" src/` returns nothing — no caller can set client | 2026-08-07 |
| D2 | On-Site Fee: price on raw headcount | Molly | Tier buckets can't express her rule (250 sits inside "101-250", and that bucket function is global to all pricing). Fix = price this ONE fee off `coalesce(fte_count, employees)` with the split at ≥250 → $1,000. Gated on A4. | `grep -n 'employees <= 250' src/lib/formatters.ts` still global | 2026-08-04 |
| D3 | On-Site Fee: auto-add when on-site SRA selected | Molly | Her Q3 answer said yes. Never started. | `grep -rn 'on-site-fee' src/features/opportunities/` returns nothing | 2026-08-04 |
| D6 | PandaDoc webhook wiring | (6/24 audit) | `supabase/functions/pandadoc-sync/` exists but is deliberately NOT CI-deployed (manual deploy only, per both Azure workflows). Wiring + verifying is open. | `grep -n pandadoc .github/workflows/azure-static-web-apps-*.yml` shows it in the NOT-deployed list | 2026-08-04 |
| D7 | Over-suppression decision | Nathan | NOT an enforcement gap — playbook-smartlead re-checks the Do-Not-Email list server-side and distrusts client filtering (index.ts:544, 1232). The open question is whether the current suppression *breadth* is right. | Decision, no code check | 2026-07-29 |
| D8 | Leadership-numbers fixes | (6/24 audit) | See `docs/audit/`. | `docs/audit/2026-06-24-full-audit.md` | 2026-08-04 |
| D9 | Guided account-creation popup | needs a new owner | Originally Brayden's; he's no longer with the company. Partly delivered by the 7/8 Closed Won gate; the guided CREATE popup was never built. Nathan to decide if anyone still wants it. | `grep -rn 'guided' src/features/accounts/` returns nothing | 2026-08-04 |
| D10 | 155 pre-horizon renewal parents | (optional hygiene) | 2024-vintage, anchors 6–18 months past. Automation never touches them; the covering-deal dedup protects the future. Optional: anchor-based suppression sweep + give v_renewal_audit an anchor horizon. Any future sweep must use the GENERATOR's anchor, not the audit's close+12mo. | Nothing at risk; informational | 2026-07-29 |
| D12 | Deploy pipeline: pinned-old Supabase CLI + blanket edge-function redeploy | (7/27 deploy flake) | The prod deploy FAILED once on 2026-07-27 (promote 81bec7d) at `exit 135` while bundling **sync-emails — a function nobody had touched**; `gh run rerun --failed` then went green on the same sha. Two contributing causes: (1) `package.json` pins `supabase` to **2.47.2** while 2.110.0 is current, so CI runs a CLI that's many versions behind; (2) both Azure workflows deploy **all 23 edge functions on every run** even when zero changed (this promote changed 0). Fix options: bump the pin (test on staging first — the CLI has had breaking flag changes, e.g. the decorator warning already in our logs), and/or only deploy functions whose files changed in the diff. Blast radius when it bites: migrations run BEFORE the function deploy and the frontend upload runs AFTER, so a mid-run failure leaves prod DB-ahead-of-frontend (safe, as on 7/27) — but a future reordering would make it unsafe. | `grep -n '"supabase"' package.json` shows 2.47.2; `grep -c 'functions deploy' .github/workflows/azure-static-web-apps-white-flower-0f9685910.yml` = 23 | 2026-08-04 |

---

## E. Queued — Campaigns polish

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| E6 | Sweep status view readable by authenticated (LOW) | v_campaigns_daily_sweep_schedule_status granted to `authenticated` — matches the existing cron-view precedent. | `grep -n v_campaigns_daily_sweep_schedule_status supabase/migrations/20260722200000_*.sql` | 2026-08-04 |
| E7 | Step column stuck on "Not sent yet" | Stays until events carry sequence numbers. Could infer email-1-sent from campaign metrics. | `grep -n stepLabel src/features/playbook/CampaignDetailSheet.tsx` | 2026-08-04 |
| E8 | Right-click launch: collapse the Recipients step | Nathan's 8/4 testing: launching from a right-clicked contact still walks through the shared Recipients step (CampaignWizard.tsx:834 "Step 3 — Recipients (shared)") even though the target is already explicit (right-click pre-seeds it, line 168). Desired feel: right click → pick preset (or custom) → confirm sequence → start. Keep a visible-but-compact "going to: X" confirmation rather than a full step. | `grep -n 'Step 3 — Recipients (shared)' src/features/playbook/CampaignWizard.tsx` — still one shared step with no pre-seeded skip path | 2026-08-04 |
| E9 | Right-click launch: offer custom campaign, not presets-only | Nathan's 8/4 testing: the right-click picker offers only presets. The wizard already HAS a full custom path (mode === "ai", "New Campaign" — describe it, AI writes the sequence); it's just not reachable from the right-click entry. Add a "Custom campaign" option beside the presets. Nathan: "may be nice as well?" — leaning yes, cheap since the mode exists. | Right-click path in ContactsList.tsx (ctxCampaignOpen) reaches only template mode — no ai-mode entry from context menu | 2026-08-04 |
| E10 | Per-launch sequence editing exists but isn't discoverable | Nathan's 8/4 testing: he couldn't tell whether the preset sequence was editable at launch. It IS — template mode deep-copies steps as freely-editable for that launch only (CampaignWizard.tsx:223, step-2 subtitle line 601 says "edit them for this launch only"). Make it obvious: visible Edit affordance per step, not just subtitle text. (Copy itself still blocked on Jordan M — A3.) | UX check: step 2 of Launch sequence shows no per-step edit affordance beyond the subtitle sentence | 2026-08-04 |

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
