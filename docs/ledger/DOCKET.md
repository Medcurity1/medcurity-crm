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
| A3 | Campaign copy for 8-Touch + Warming presets | Jordan Mayer | The gate on Campaigns public launch (D1). | Presets still carry placeholder copy in the template editor | 2026-07-29 |
| A4 | On-Site Fee: confirm "under 250" = 249-and-below | Molly | She answered in June ("$500 under 250, $1,000 for 250 or more"), but **383 prod accounts sit at exactly fte_count 250** — worth her saying yes with that number in view before they flip $500→$1,000. | `accounts?fte_count=eq.250&archived_at=is.null` count = 383 | 2026-07-29 |
| A7 | Renewal duplicate cleanup round 2: PPoU + Hinet pairs (Joe's 8/3 forward) | Nathan + Dan (Jordan/Margaret for Citizens) | Joe forwarded the 7/28 renewals report asking for dedup logic; prod audit 2026-08-03 confirmed the root fix (covering dedup, promoted 7/27 a1c3514) is live and clean (runs 19-25: 0-3 created/day, 0 errors, no new dups), but TWO pre-fix duplicate pairs survive, each with its unclaimed half sitting in the claim queue: (1) Planned Parenthood of Utah "SRA \| Remote Services" $7,450 twice - keep claimed child 698457f0, delete unclaimed 4/18 SF-import ec317f41 (identical); (2) Hinet Managed IT "SRA\|Remote\|BAA\|BNVA" - $3,480 unclaimed 4/18 import (aba6f456) vs $2,784 claimed 7/20 child (0b9d1113; parent won at $2,784) - Dan confirms which amount is right, delete the other. MAYBE: Citizens Medical $0 SAFER child (9dc56afe) possibly inside the $19,800 bundle child (d48598cd) - Jordan/Margaret confirm. Delete via the proven 7/27 process (suppression auto-writes; append to docs/cleanup/). Also 6 Brayden Test Account husks (3 dup groups, reports exclude them) could be archived. | prod REST: open non-archived opps grouped by account + product-token-set → exactly 2 non-test dup groups (PPoU, Hinet) | 2026-08-03 |
| A8 | Collateral tab — awaiting Jordan M's plan | Jordan Mayer | Nathan 2026-08-04: future new sidebar tab (+1 tab, deliberately worth it) — a well-designed home for product collateral (battle cards, brochures, logos, user guides). Files live off-Pulse (SharePoint or similar), listed + linked in Pulse. Open design points: partner-specific collateral (partner's documents section vs also linked here), layout/search quality, and an easy "request new collateral" button (which will open the requests popup on the Collateral tab — see B8). Jordan M is doing the deep planning; don't design ahead of her. | No plan doc yet: `ls docs/collateral/ 2>/dev/null` fails | 2026-08-04 |
| A5 | MSD-957: does "gated" mean blocked, or reviewed? | Rachel | She asked bugs be "gated first by client-facing or not" (email 7/29 1:32pm). Built as **filed-and-flagged**, not blocked: the Jira ticket goes in immediately either way, and a client-facing bug leaves the Pulse request PENDING for her review. Blocking the filing would have delayed MSD-922 (BAA module broken, high) by 3 days. Needs her explicit yes. Also needs her definition of client-facing for the classifier prompt, and whether she'll close reviewed bugs herself. **Status correction (2026-07-31 promote audit): the MSD-957 CODE is already ON PROD** — main carries `2393b24` (promote) + `32ac345`/`6a23d82` (15s classify cap), contradicting the old B1 row's "prod deliberately not promoted"; that row is retired. The edge fn fail-softs to direct Jira filing when Helm env vars are absent, so prod behavior depends on whether prod's Supabase has HELM_BUG_INTAKE_URL/HELM_API_KEY set (unverified from this session). Her answers may still change the shipped behavior. | Ask her; MSD-957 comment 2026-07-30 lists all four questions. Code-on-prod: `git log origin/main --oneline \| grep -i MSD-957` | 2026-08-04 |

---

## B. On staging — awaiting prod go-ahead

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| B8 | Requests → header popup (built 8/4 AM, polish round 8/4 PM after Nathan's test) | Ember-gradient Submit Request pill + popup (Requests sidebar tab gone). Nathan's 8/4 polish applied same day: humorous placeholders (billboard/beanbags/leaderboard), warm orangey-red palette for button + popup header (violet stays reserved for AI), Ask AI got an always-visible violet pill border to match, footer made opaque with the From line dropped, plus Nathan's one-time "Requests moved up here!" ember callout under the button (one-click dismiss or first use, localStorage `requests_moved_callout_dismissed_v1`, never returns). Round 2 same day (Nathan approved colors/scroll/placeholders/callout): header description removed for a slimmer popup, and ALL user-facing em dashes purged from the feature (dialog, callout, toasts, client-impact labels, admin RequestCard) per his no-emdash rule. Live-verified on staging. Testing caution: product-BUG submits file real Jira tickets even from staging. Awaiting prod go. | `grep -n 'from-orange-500' src/features/requests/RequestDialogProvider.tsx` + staging header shows the pill; prod header does NOT until promote | 2026-08-04 |
| B10 | Nexus Metrics strip (Home's clickable Key Metrics carried over) | Nathan 8/4: metrics were Home's most-used feature because they're at the top and clickable. Built as its own section under the three surfaced briefing items, above Your widgets: compact 6-across clickable tiles (same kpi-registry queries, deep links, and accents as Home; SMALLER per his ask), reusing the user's existing Home metric picks (same localStorage config + Home's KpiConfigDialog for choosing), plus a Nexus-only Show/Hide toggle in Customize (default SHOWN, localStorage per user). The Metrics WIDGET stays in the gallery deliberately: it does trends/periods/team-scope the strip doesn't; the strip replaces the Home band, not the widget — Nathan can still call for the widget's removal. | `grep -n MetricsStrip src/features/nexus/NexusPage.tsx` wired | 2026-08-04 |
| B11 | Nexus widget drag handle: top-center grab bar | Nathan 8/4 (Rachel + Jordan both failed to find the old top-left corner grip): now a horizontal 6-dot grab bar centered at the top of each widget in Customize mode, phone-widget style, only rendered when the shell is actually sortable. | `grep -n GripHorizontal src/features/nexus/WidgetShell.tsx` | 2026-08-04 |
| B12 | Nexus pipeline widget renamed "My Open Opportunities" | Rachel (via Nathan 8/4) wanted an open-opps widget before Home retires — it EXISTED as "Current Pipeline" (identical content: your open opps, soonest close first); the name just didn't match Home's panel. Renamed in the gallery/builder + home-import. Existing placed widgets keep their stored names. | `grep -n '"My Open Opportunities"' src/features/nexus/WidgetBuilder.tsx` | 2026-08-04 |
| B13 | Briefing "View request" opens the actual request | Jordan M's CRM request 8/4 (in the requests queue — Nathan checks it off, not Claude): the briefing's request rows used to dump her on the submit form. Now the button reads View request and opens THAT request's detail dialog in place on Nexus (id parsed from the day-queue item_key; RequestDetailDialog exported from RequestCard; falls back to the admin inbox with a toast if the fetch fails). | `grep -n requestIdOf src/features/nexus/Briefing.tsx` | 2026-08-04 |
| B9 | Calendar tab removal (built 8/4 on Nathan's go) | ActivityCalendar.tsx deleted; route, sidebar entry, pathMap entry gone; 4 docs updated. Per the 8/4 sweep: zero deep links, zero tests, no dead code, no calendar-only data (everything visible in /activities). KEEP list honored (outlook-calendar-sync, renewals_calendar report, WidgetShell calendar icon key). /calendar now falls to NotFound. Awaiting prod go. | `grep -rn '"/calendar"' src/` = 0 hits; staging sidebar shows no Calendar | 2026-08-04 |

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
| D2 | On-Site Fee: price on raw headcount | Molly | Tier buckets can't express her rule (250 sits inside "101-250", and that bucket function is global to all pricing). Fix = price this ONE fee off `coalesce(fte_count, employees)` with the split at ≥250 → $1,000. Gated on A4. | `grep -n 'employees <= 250' src/lib/formatters.ts` still global | 2026-08-04 |
| D3 | On-Site Fee: auto-add when on-site SRA selected | Molly | Her Q3 answer said yes. Never started. | `grep -rn 'on-site-fee' src/features/opportunities/` returns nothing | 2026-08-04 |
| D6 | PandaDoc webhook wiring | (6/24 audit) | `supabase/functions/pandadoc-sync/` exists but is deliberately NOT CI-deployed (manual deploy only, per both Azure workflows). Wiring + verifying is open. | `grep -n pandadoc .github/workflows/azure-static-web-apps-*.yml` shows it in the NOT-deployed list | 2026-08-04 |
| D7 | Over-suppression decision | Nathan | NOT an enforcement gap — playbook-smartlead re-checks the Do-Not-Email list server-side and distrusts client filtering (index.ts:544, 1232). The open question is whether the current suppression *breadth* is right. | Decision, no code check | 2026-07-29 |
| D8 | Leadership-numbers fixes | (6/24 audit) | See `docs/audit/`. | `docs/audit/2026-06-24-full-audit.md` | 2026-08-04 |
| D9 | Guided account-creation popup | needs a new owner | Originally Brayden's; he's no longer with the company. Partly delivered by the 7/8 Closed Won gate; the guided CREATE popup was never built. Nathan to decide if anyone still wants it. | `grep -rn 'guided' src/features/accounts/` returns nothing | 2026-08-04 |
| D10 | 155 pre-horizon renewal parents | (optional hygiene) | 2024-vintage, anchors 6–18 months past. Automation never touches them; the covering-deal dedup protects the future. Optional: anchor-based suppression sweep + give v_renewal_audit an anchor horizon. Any future sweep must use the GENERATOR's anchor, not the audit's close+12mo. | Nothing at risk; informational | 2026-07-29 |
| D14 | Nexus tab launch checklist | Nathan | 2026-08-04: after Nathan's Nexus testing wraps — move tab toward the top of the sidebar, add/verify walkthrough (NexusTour.tsx already exists), flip ACTIVE_ANNOUNCEMENT banner, give the tab a highlight badge ("New" or "Launched" — Nathan leaning something like Launched since it isn't new), then start the Home-tab retirement (the 3rd tab removal, after B8's Requests and B9's Calendar). Nathan 8/4: the walkthrough must ALSO get a tile pointing at the header Submit Request button explaining what it does — the button already carries `data-tour="submit-request"` for exactly this. Gated on his testing + H2 (Home stays default until his flip call). | `grep -n ACTIVE_ANNOUNCEMENT src/components/AnnouncementBanner.tsx` still null + Nexus entry carries no badge in Sidebar.tsx | 2026-08-04 |
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
| H2 | Nexus dashboard default tab | Home stays the default until Nathan approves switching. |
