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
| A1 | Camp Lowell duplicate renewal | Rachel | $1,012.50 auto-renewal; its successor is a 3-yr "SP SRA" $499 — likely the same product renamed. Delete or keep. Last of the 20-deal cleanup. | `opportunities?created_by_automation=eq.true&renewal_from_opportunity_id=not.is.null&amount=eq.1012.5` still open on prod | 2026-07-27 |
| A3 | Campaign copy for 8-Touch + Warming presets | Jordan Mayer | The gate on Campaigns public launch (D1). | Presets still carry placeholder copy in the template editor | 2026-07-27 |
| A4 | On-Site Fee: confirm "under 250" = 249-and-below | Molly | She answered in June ("$500 under 250, $1,000 for 250 or more"), but **383 prod accounts sit at exactly fte_count 250** — worth her saying yes with that number in view before they flip $500→$1,000. | `accounts?fte_count=eq.250&archived_at=is.null` count = 383 | 2026-07-27 |

---

## B. On staging — awaiting prod go-ahead

_(none — everything staged today promoted to PROD 2026-07-27 in 81bec7d)_

---

## C. In progress

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| C1 | Campaigns overhaul (the big project) | Phases 1–5 built + the full 2026-07-28 outside-review program (7 batches); admin-only + staging-gated until Nathan tests. Plan: `docs/campaigns/campaigns-plan.md`. | `grep -n "AdminGate><PlaybookPage" src/App.tsx` + Campaigns in Sidebar adminItems (the literal "Rep rollout flip point" comment phrase no longer exists — old recipe was unrunnable) | 2026-07-28 |

---

## D. Queued — buildable now

| # | Item | Who | Detail | Verify | Checked |
|---|---|---|---|---|---|
| D1 | Campaigns public launch checklist | Nathan | (1) Jordan's copy into presets; (2) flip ACTIVE_ANNOUNCEMENT in AnnouncementBanner.tsx; (3) remove admin gates at the 3 flip points (App.tsx route, Sidebar adminItems, ContactsList right-click). Also decide the 2 Playbook GH workflows disabled since 6/26 — likely superseded by the Campaigns engine. (The leads_per_day clamp, formerly item 4 here, shipped 2026-07-27 — see SHIPPED.) | `grep -n ACTIVE_ANNOUNCEMENT src/components/AnnouncementBanner.tsx` | 2026-07-27 |
| D2 | On-Site Fee: price on raw headcount | Molly | Tier buckets can't express her rule (250 sits inside "101-250", and that bucket function is global to all pricing). Fix = price this ONE fee off `coalesce(fte_count, employees)` with the split at ≥250 → $1,000. Gated on A4. | `grep -n 'employees <= 250' src/lib/formatters.ts` still global | 2026-07-27 |
| D3 | On-Site Fee: auto-add when on-site SRA selected | Molly | Her Q3 answer said yes. Never started. | `grep -rn 'on-site-fee' src/features/opportunities/` returns nothing | 2026-07-27 |
| D5 | SF importer pricing guard | (7/27 sweep) | Importer plain-inserts price_book_entries deduped only by sf_id (SalesforceImport.tsx ~4342). Post-constraint, a PricebookEntry re-import fails loudly per row instead of silently recreating debris. Needs a real upsert or a hard "pricing imports are closed" block. Also: derive fte_range from the SF product-name prefix when the book name lacks one. | `grep -n 'from(tableName)' -A2 src/features/admin/SalesforceImport.tsx` still plain `.insert()` | 2026-07-27 |
| D6 | PandaDoc webhook wiring | (6/24 audit) | `supabase/functions/pandadoc-sync/` exists but is deliberately NOT CI-deployed (manual deploy only, per both Azure workflows). Wiring + verifying is open. | `grep -n pandadoc .github/workflows/azure-static-web-apps-*.yml` shows it in the NOT-deployed list | 2026-07-27 |
| D7 | Over-suppression decision | Nathan | NOT an enforcement gap — playbook-smartlead re-checks the Do-Not-Email list server-side and distrusts client filtering (index.ts:544, 1232). The open question is whether the current suppression *breadth* is right. | Decision, no code check | 2026-07-27 |
| D8 | Leadership-numbers fixes | (6/24 audit) | See `docs/audit/`. | `docs/audit/2026-06-24-full-audit.md` | 2026-07-27 |
| D9 | Guided account-creation popup | needs a new owner | Originally Brayden's; he's no longer with the company. Partly delivered by the 7/8 Closed Won gate; the guided CREATE popup was never built. Nathan to decide if anyone still wants it. | `grep -rn 'guided' src/features/accounts/` returns nothing | 2026-07-27 |
| D10 | 155 pre-horizon renewal parents | (optional hygiene) | 2024-vintage, anchors 6–18 months past. Automation never touches them; the covering-deal dedup protects the future. Optional: anchor-based suppression sweep + give v_renewal_audit an anchor horizon. Any future sweep must use the GENERATOR's anchor, not the audit's close+12mo. | Nothing at risk; informational | 2026-07-27 |
| D12 | Deploy pipeline: pinned-old Supabase CLI + blanket edge-function redeploy | (7/27 deploy flake) | The prod deploy FAILED once on 2026-07-27 (promote 81bec7d) at `exit 135` while bundling **sync-emails — a function nobody had touched**; `gh run rerun --failed` then went green on the same sha. Two contributing causes: (1) `package.json` pins `supabase` to **2.47.2** while 2.110.0 is current, so CI runs a CLI that's many versions behind; (2) both Azure workflows deploy **all 23 edge functions on every run** even when zero changed (this promote changed 0). Fix options: bump the pin (test on staging first — the CLI has had breaking flag changes, e.g. the decorator warning already in our logs), and/or only deploy functions whose files changed in the diff. Blast radius when it bites: migrations run BEFORE the function deploy and the frontend upload runs AFTER, so a mid-run failure leaves prod DB-ahead-of-frontend (safe, as on 7/27) — but a future reordering would make it unsafe. | `grep -n '"supabase"' package.json` shows 2.47.2; `grep -c 'functions deploy' .github/workflows/azure-static-web-apps-white-flower-0f9685910.yml` = 23 | 2026-07-27 |

---

## E. Queued — Campaigns polish

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| E2 | Campaign event stats ship every row | useCampaignEventStats pulls all campaign_events to tally 4 buckets. Lazy + index-supported so cheap today; convert to a count/group-by RPC before high volume. | `grep -n useCampaignEventStats src/features/playbook/api.ts` | 2026-07-27 |
| E3 | reconcileCampaignLeads sequential writes | Single-row writes, capped at 25 campaigns/run. Batch via chunked upsert before volume grows. | `grep -n reconcileCampaignLeads supabase/functions/playbook-smartlead/index.ts` | 2026-07-27 |
| E4 | Double-enroll race | Two concurrent launches can enroll the same email. Needs an advisory lock — a unique index is ruled out because enrollment_overrides deliberately allows double-enroll. | `grep -n enrollment_overrides supabase/functions/playbook-smartlead/index.ts` | 2026-07-27 |
| E5 | DST hour drift (cosmetic) | ptUtcOffsetHours() buckets DST by month, so task due TIMES are off an hour for ~1 week before each US transition. Never the wrong day. | `grep -n ptUtcOffsetHours supabase/functions/_shared/campaign-scheduling.ts` | 2026-07-27 |
| E6 | Sweep status view readable by authenticated (LOW) | v_campaigns_daily_sweep_schedule_status granted to `authenticated` — matches the existing cron-view precedent. | `grep -n v_campaigns_daily_sweep_schedule_status supabase/migrations/20260722200000_*.sql` | 2026-07-27 |
| E7 | Step column stuck on "Not sent yet" | Stays until events carry sequence numbers. Could infer email-1-sent from campaign metrics. | `grep -n stepLabel src/features/playbook/CampaignDetailSheet.tsx` | 2026-07-27 |
| E8 | Delete the LIVE TEST campaign | "LIVE TEST — Phase 2 webhooks (Nathan only)" still `active` on STAGING (not on prod). | staging `campaigns?name=like.*LIVE TEST*` returns 1 row | 2026-07-27 |

---

## I. Campaigns outside-review (2026-07-28 fleet audit) — Nathan approved "go for it on your list"

Source: `docs/audit/2026-07-28-campaigns-outside-review.md` (61-agent read-only audit; 22 confirmed + 1 plausible bugs, 147 unverified findings, 129-idea roadmap). The 4 worst confirmed bugs shipped same-day (see SHIPPED 2026-07-28). Everything below is verified-real and still open.

### I-a. Remaining confirmed bugs

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| I1 | Webhook self-heal skips campaigns whose registration failed at launch | Heal filters `.not("smartlead_webhook_id","is",null)` — the broken ones are never retried; launch swallows the failure silently. | `grep -n 'not("smartlead_webhook_id"' supabase/functions/playbook-smartlead/index.ts` | 2026-07-28 |
| I2 | isWebhookHealthy inverts its own uncertain-check rule | `if (!rows.length) return false` on an unrecognized GET shape → re-registers a duplicate webhook every sweep → events double-counted. | `grep -n 'if (!rows.length) return false' supabase/functions/playbook-smartlead/index.ts` | 2026-07-28 |
| I3 | Two recipients sharing one email enroll twice and break webhook lookup | Launch dedupes only by contact_id; QuickCampaignDialog bypasses the byEmail merge; `.maybeSingle()` then errors on 2 rows forever. (Sibling of E4's race.) | `grep -n seenContactIds supabase/functions/playbook-smartlead/index.ts` — still contact_id-only | 2026-07-28 |
| I7 | No compare-and-set on campaign status (Stop racing Start) | setCampaignStatus writes unconditionally after a stale read; start's task spawn can land on a just-stopped campaign. | status writes lack `.eq("status", expected)` | 2026-07-28 |
| I8 | Sweep step 1 unbudgeted + fixed order starves steps 2-7 | syncCampaigns runs before any hasBudget() with no cap; shared 100s budget; steps 4-6 have no rotation cursor. | `grep -n 'await syncCampaigns' supabase/functions/playbook-smartlead/index.ts` before first hasBudget | 2026-07-28 |
| I9 | Sweep selects unpaginated — silent truncation at PostgREST's 1000-row cap | Zero `.range(` in the sweep's own selects (the launch-path suppression/enrollment checks were paged 7/28); meddy-sweep pages around the same cap deliberately. | sweep step selects in playbook-smartlead/index.ts lack `.range(` | 2026-07-28 |
| I11 | Webhook category text unvalidated → AI prompt-injection path | extractCategory accepts any string; flows verbatim into playbook-ai's prompt whose training notes become permanent "hard rules" with no review. | `grep -n extractCategory supabase/functions/campaign-webhooks/index.ts` — no allowlist/cap | 2026-07-28 |
| I12 | Each campaign gets exactly ONE AI analysis, at ~20 sends | `.is("analyzed_at", null)` + sent>=20; never re-analyzed at completion. Fix pairs with a manual "Get insights" button. | insight-candidate select in playbook-smartlead/index.ts | 2026-07-28 |
| I13 | Tracker stats scan every enrollment of every campaign in one unbounded .in() | Includes collapsed old campaigns; GET-URL breaks ~200 campaigns. Convert to a count RPC (supersedes-adjacent to E2). | `grep -n useCampaignEnrollmentStats src/features/playbook/api.ts` — no limit/RPC | 2026-07-28 |
| I14 | v_marketing_suppression recomputes 11 branches per check, unindexable | CTE referenced 7× (materialized), email from lateral unnest → `.in()` can't push to an index; every launch pays full recompute per 500-batch. | view def in 20260728100000 (unchanged structure) | 2026-07-28 |
| I15 | Prod sweep cron likely firing daily at a 500ing function | 20260722200000's GUC fallback rewrites the email-sync URL; prod has no SMARTLEAD_API_KEY → daily dead call logged as success. Confirm on prod, then silence or gate. | fallback block in 20260722200000_campaigns_daily_sweep_cron.sql:88-107 | 2026-07-28 |
| I16 | Legacy Mailchimp/newsletter rows sit in "Ongoing campaigns" forever | 20260722100000 migrated them status active, steps [], 0 enrollments; CampaignsTab never filters origin. | `grep -n "origin" src/features/playbook/CampaignsTab.tsx` — not filtered | 2026-07-28 |
| I18 | delete-campaign action has no status precondition | UI gates Delete to drafts; the edge action deletes ANY status, orphaning spawned tasks. | delete-campaign handler in playbook-smartlead/index.ts | 2026-07-28 |
| I19 | Campaigns writes nothing to the audit log | Zero audit_log hits across the feature despite Pulse's mature audit system; who launched/stopped what is unrecorded. | `grep -rn audit_log supabase/functions/playbook-smartlead/ supabase/functions/campaign-webhooks/` = 0 | 2026-07-28 |
| I20 | Orchestration engine has zero automated test coverage | All 7 campaign test files import only _shared pure modules; launch/status/sweep/webhook handlers untested — where every confirmed bug lived. | `grep -l "_shared" tests/campaign*.test.ts` = all of them | 2026-07-28 |
| I21 | Signature-header lockout risk (PLAUSIBLE, unconfirmed) | verifyOptionalSignature 401s any present-but-unrecognized signature header; if Smartlead ever signs with an account-level key, every webhook dies → 5-failure auto-disable. | `grep -n verifyOptionalSignature supabase/functions/campaign-webhooks/index.ts` | 2026-07-28 |

### I-b. Approved next builds (top experience wins)

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| I36 | campaigns.settings read-modify-write clobber window | syncCampaigns (last_metrics_sync_at) and the sweep reconcile (last_sweep_at) both rewrite the whole settings JSON; a manual Sync racing the cron can drop the other's key. Sequential within one sweep run — only the concurrent-manual case. Fix = a jsonb-merge RPC. | `grep -c "last_sweep_at\|last_metrics_sync_at" supabase/functions/playbook-smartlead/index.ts` — both via spread-update | 2026-07-28 |
| I37 | Ignored wizard resume banners can strand draft rows | Ignore the banner + build fresh + abandon without launching → the old row is only cleaned on a successful launch. Low-volume leak; add cleanup on discard-by-abandonment or an updated_at-based prune. | `grep -n "draftBanner" src/features/playbook/CampaignWizard.tsx` — cleanup only in handleLaunchSuccess | 2026-07-28 |
| I38 | Test-coverage gaps from the 7/28 build day | Top pure-logic candidates without tests: touchEventBucket/eventTypeBucket (funnel-vs-per-email agreement), mailtoRecipient/replySubject (mailto injection guards), the influence won/open bucketing + renewal exclusion (extract to a pure helper first), and the Deno-side resolveSyncedStatus/extractDailyLimit (need the vitest-importable-extraction treatment webhook-normalize got). | `ls tests/ \| grep -c campaign` vs the list here | 2026-07-28 |
| I35 | Needs-you reply tally: caps + error visibility | The "N replies waiting" tally reads the Replies feed query (30-day window, 50-row cap, handled rows consume slots) — at volume, older UNHANDLED replies fall out and the flag silently drops; a failed replies query also silently zeroes the signal. Convert to a dedicated unhandled-count query (pairs with promoting `handled` to a real column, roadmap) before campaign volume grows. | `grep -n REPLIES_LIMIT src/features/playbook/api.ts` = 50 | 2026-07-28 |
| I31 | Everything else from the review | 147 unverified findings + the full 129-idea roadmap (18 themes) live in the report — mine it when each area is touched. | `docs/audit/2026-07-28-campaigns-outside-review.md` exists | 2026-07-28 |
| I32 | Custom templates saved with no owner | useSaveTemplate's insert never sets owner_user_id, so every custom template (incl. InsightsPanel's preset copies) will be INVISIBLE to reps under campaign_templates_read_own when the rep-access RLS flips. Backfill + set-on-insert before the flip. | `grep -n owner_user_id src/features/playbook/api.ts` — absent from the template insert payload | 2026-07-28 |
| I33 | Manual opt-out has no writer | marketing_optouts allows reason='manual' (non-overridable, labeled in the report) but nothing can create one — admins can only REVOKE today. Add an "Opt out of marketing" action (contact page or DoNotEmail report) writing via an edge action. | `grep -rn "reason: \"manual\"" supabase/functions/ src/` = 0 hits | 2026-07-28 |
| I34 | Rep-rollout flip: three RLS prerequisites from the review builds | (1) campaign_enrollments.owner_user_id now carries the CONTACT's owner, so `campaign_enrollments_read_own` alone would hide co-workers' enrollments from a campaign's owner — the flip needs an additional "enrollments of campaigns I own" SELECT policy, and 20260723040000's comment claiming enrollments carry the campaign owner is stale. (2) campaign_drafts RLS is admin-ALL; the wizard scopes per-user in the QUERY (fetchLatestCampaignDraft) — the flip needs a real per-user policy. (3) lead_lists RLS is own-or-admin, so the wizard's "From a saved list" source only shows a rep their OWN lists — the marketing→sales list handoff needs a deliberate widening (e.g. share non-working lists) or the helper text changed to "your own lists". | `grep -n "campaign_enrollments_read_own" supabase/migrations/20260723040000_campaigns_rep_access_rls.sql` — no campaign-owner policy beside it | 2026-07-28 |

---

## F. Queued — low-priority bug pile (deferred with eyes open)

| # | Item | Detail | Verify | Checked |
|---|---|---|---|---|
| F1 | Meddy ding hits every staff tab | The `meddy_messages` subscription has NO postgres_changes filter — every INSERT company-wide reaches every open staff tab, each triggering a DB round-trip. (The sibling `notifications` channel IS filtered; only this one leaks.) Fix = broadcast channel scoped to joined conversations, or a client-side Set gate. | `grep -n 'table: "meddy_messages"' -A2 src/hooks/useNotificationToasts.ts` — no `filter:` key | 2026-07-27 |
| F2 | RLS InitPlan wraps missing on aux tables | Landed for exactly 5 tables (accounts, activities, contacts, leads, opportunities). opportunity_products, stage_history, products, user_profiles, audit_logs, … still unwrapped. | `grep -o 'on public\.[a-z_]*' supabase/migrations/20260721170000_*.sql \| sort -u` | 2026-07-27 |
| F3 | OpportunityContacts N+1 | One activities query per stakeholder. | `grep -n activities src/features/opportunities/OpportunityContacts.tsx` | 2026-07-27 |
| F4 | Last-activity views scan whole activities table | On unscoped sort paths. | view definitions in `supabase/migrations/` | 2026-07-27 |
| F5 | RenewalsQueue unvirtualized | Double table + ~13 full-list filter passes per totals memo. | `grep -c 'virtual\|Virtuoso' src/features/renewals/RenewalsQueue.tsx` = 0 | 2026-07-27 |
| F6 | Duplicate dashboard-metrics cache keys | TeamDashboard vs the standard report use colliding keys. | `grep -rn v_dashboard_metrics src/features/reports/TeamDashboard.tsx src/features/reports/standard/` — same view queried from two places with different cache keys | 2026-07-27 |
| F7 | HomePage chunk prefetch for deep-linkers | Fires for users who never visit Home. Deliberate boot-waterfall tradeoff — revisit only if boot profiling says so. | `grep -n prefetch src/features/dashboard/HomePage.tsx` | 2026-07-27 |
| F8 | Renewal card's 2 pull-back knobs are dead | RenewalAutomationCard renders pullback_days_auto_renew / _signature_required (6 refs) but the live generator ignores both. Wire them or remove them. | `grep -c pullback_days src/features/admin/RenewalAutomationCard.tsx` = 6, and 0 in the latest generator migration | 2026-07-27 |
| F9 | Renewal preview reason labels | Suppressed parents show a generic "Already has renewal"; v_renewal_audit's past_due note still promises the old wide lookback. Bundle into the next audit-view re-emit. | preview `reason` strings in the latest renewal migration | 2026-07-27 |
| F11 | read_only role sees Lists write buttons | RLS blocks the writes; the cosmetic gate is missing. | Lists UI role gating | 2026-07-27 |
| F12 | ImportsPen search has no debounce | Admin-only page. | `grep -n debounce src/features/leads/ImportsPen.tsx` returns nothing | 2026-07-27 |
| F13 | Two empty April lists | Nebraska Leads + FQHC are husks post-retirement — worth telling Summer. No INDUSTRY smart-list rule exists, so FQHC rebuilds via Report Builder → Save as list. | prod `lists` rows with 0 members | 2026-07-27 |
| F14 | email_dup_status not pen-aware | Avoided/pending imports misclassified in dedup surfaces. Verifier-downgraded LOW. | `grep -rn email_dup_status src/` | 2026-07-27 |
| F15 | email_sync cron NULL-response noise (cosmetic) | Its every-10-min call exceeds pg_net's 5s wait; the function completes fine (verified by effect 7/27). Raising timeout_milliseconds would clear the noise from net._http_response. | prod `net._http_response` NULL status_code rows | 2026-07-27 |

---

## G. Ideas / someday

| # | Item | Who | Detail |
|---|---|---|---|
| G1 | AI smart lists | Nathan | Ask AI assembles a call list from natural language ("every non-customer in Washington"). Lists over reports because membership is editable without touching contact data. |
| G2 | CRM AI layer | Nathan | Describe-a-report, AI nav/search. Big project. |
| G3 | Ask AI → build a campaign | Nathan | "Find my prospects in the Southwest, start them on a 2-email campaign referencing our customer there." Future layer on the Campaigns overhaul. |
| G4 | Account Snake mini-game | Nathan | Deal Merger won the pick; snake "maybe another time". |
| G5 | Pulse Arcade hub | Nathan | Games list, profiles, records, daily events. Revisit at 6+ games (currently 3). |
| G6 | Reverse FTE autofill (opportunity → account) | Molly | One-way account→opp shipped; her ask was bidirectional. |
| G7 | Nexus called-by filter caps at 250 contact ids | (review note) | Sanity-check under real volume post-adoption. |

---

## H. Watch / verify later

| # | Item | Detail |
|---|---|---|
| H1 | Meddy widget 1h cache | Keep the meddy-chat edge fn backward-compatible ≥1h after widget-affecting deploys. |
| H2 | Nexus dashboard default tab | Home stays the default until Nathan approves switching. |
