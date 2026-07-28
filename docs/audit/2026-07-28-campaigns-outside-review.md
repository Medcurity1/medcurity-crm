# Campaigns Tool — Outside Review

**Date:** July 28, 2026 · **Method:** 61-agent read-only fleet (33 independent reviewers → dedupe → adversarial verification of every top claim → synthesis) · **Nothing was changed** — no code, no data, no settings.

---

## The one-paragraph verdict

The Campaigns tool is genuinely well-built at its core — the architecture is sound, all 313 automated tests pass, and the prior July 22 audit already caught and fixed a batch of serious issues. But this deeper sweep found real problems the earlier passes missed, concentrated in three places: **(1) opt-out handling has holes** — for a compliance company, the most important thing to fix; **(2) the automation fails silently** — when something breaks (a failed stop, a failed upload, a broken webhook, a dead nightly job), the tool reports success and nobody finds out; and **(3) the marketing → sales handoff is missing** — everything routes to whoever clicked Launch, not to the people who own the relationships. None of this is visible in day-to-day admin testing, which is exactly why it survived. The improvement roadmap below (129 vetted ideas in 18 themes) is where this goes from "solid" to genuinely best-in-class.

---

# Part 1 — Confirmed bugs (23)

Every item here was claimed by one reviewer and then **independently re-verified by a second agent whose only job was to disprove it** against the actual code. These are real.

## 🔴 Critical (1)

**1. People on the Do-Not-Email list can still get emailed if their address has capital letters.**
The master suppression list stores emails exactly as typed (e.g. `Jane.Doe@Clinic.org`), but every campaign check lowercases before comparing. Capitals never match lowercase in an exact comparison — so a contact saved with any capital letter in their email sails straight past the Do-Not-Email screen and gets enrolled. This undermines the tool's most important safety rail.
*Where: the `v_marketing_suppression` view (migration 20260720155000) + both places that query it.*

## 🟠 High (8)

**2. An unsubscribe can be silently thrown away.**
If someone's sequence already ended — because they replied, bounced, were stopped, or the campaign finished — and *then* they click unsubscribe, the handler quits early and never sets their Do-Not-Contact flag. This is the *common* ordering, not a rare one: "take me off your list" arrives as a reply first (which ends the sequence), and the unsubscribe signal lands seconds later into a closed door. The person stays fully eligible for the next campaign, the next call list, and the next LinkedIn task.

**3. Unsubscribes and bounces from CSV-uploaded people are recorded nowhere that matters.**
People added by CSV or paste have no contact record, and the Do-Not-Contact flag only gets written to contact records. Their opt-out is noted on the enrollment row — which the suppression list never reads. Upload the same spreadsheet next month and they're emailed again, with call tasks spawned for reps. (Related unverified findings: hard bounces *never* suppress an address for future campaigns, and the nightly safety-net reconcile checks replies and bounces but not unsubscribes.)

**4. Every campaign task and reply goes to whoever clicked Launch — never to the contact's owner.**
The wizard has no owner picker; every call task, LinkedIn task, reply notification, and follow-up task is assigned to the launcher. Jordan can't run a campaign on Summer's accounts without personally becoming the owner of all of Summer's calls. The plan doc explicitly called for owner routing; it never got built.

**5. A failed Stop (or Start) still reports "success."**
None of the campaign status writes check whether the database write actually worked. If a stop fails mid-flight, Smartlead keeps sending while Pulse shows a green "Campaign stopped" toast. This is the scariest reliability bug in the batch: the one button that must never lie can lie.

**6. A partially failed launch still enrolls everyone.**
Recipients upload to Smartlead in batches of 400. If one batch fails, the launch continues and creates Pulse enrollments — and call tasks, and timeline entries — for people who were never actually added to the sending platform. The code even has a comment claiming it only enrolls "people actually added," which is false.

**7. The webhook repair job skips exactly the campaigns that need repairing.**
If webhook registration fails at launch (a network blip), the failure is swallowed, the campaign is saved webhook-less, and the nightly "self-heal" step explicitly filters to campaigns that *have* a webhook ID — so the broken ones are never looked at again. Those campaigns never get real-time replies/bounces and depend entirely on the once-a-day partial reconcile.

**8. Resuming a paused person permanently loses their call/LinkedIn tasks.**
When an opportunity opens, the sweep pauses the person and archives their pending tasks. Clicking Resume flips them back to active — but nothing un-archives the tasks, and the task spawner only runs once per person, ever. Their remaining manual touches just vanish.

**9. The nightly sweep silently truncates at 1,000 rows.**
None of the sweep's database reads use paging, and Supabase caps un-paged reads at 1,000 rows (other jobs in this codebase page around this deliberately). As data grows, the sweep will quietly process an arbitrary 1,000-row subset and skip the rest — no error, no sign.

## 🟡 Medium (14)

**10. Two people sharing one email address break event tracking for both.** Launch dedupes by contact ID but not by email; two enrollments with the same address make every webhook lookup for it fail from then on.

**11. The "Let AI draft this email" checkbox does nothing.** It's on by default for every new step in the from-scratch builder, hides the subject/body fields, promises "AI will draft this when the campaign runs" — and no code anywhere reads it. The default path saves emails with no content.

**12. The nightly webhook health-check misreads Smartlead's answer and re-registers a duplicate webhook every day.** Each duplicate means every event gets delivered (and counted) one more time.

**13. A stop that races an in-flight start loses.** No compare-and-set on status writes; a concurrent Start can overwrite a Stop and spawn tasks onto a campaign the user just killed.

**14. When Smartlead marks a campaign "completed" (last email sent), Pulse force-completes everyone and archives reps' still-future call/LinkedIn tasks.** A Day-14 call task dies silently on Day 10.

**15. The sweep re-pauses people a human deliberately resumed — every single day** — as long as the triggering opportunity is still open. The human's decision is reverted nightly.

**16. The sweep's first step has no time budget and can starve all the others.** One shared 100-second clock, fixed order, no rotation for most steps — during a Smartlead slow-down, task catch-up, webhook heal, and insights simply never run, and the same steps lose every day.

**17. Sweep failures are invisible.** Every error is a console line; the cron scheduler records "succeeded" the moment the request is *queued*, even if it then returns 401/500. Nothing anywhere checks the actual result.

**18. The sweep is also the only scheduled job the watchdog doesn't watch.** Every other required job is on the watchdog's list; this one was added later and never registered. Combined with #17: if it dies, nobody is told, ever.

**19. Reply "categories" from the public webhook go unvalidated into the AI prompt and the UI.** Any text a sender-controlled payload puts in the category field is stored verbatim, stringified into the AI's prompt (which auto-writes "hard rules" into training with no human review), and rendered as a badge. It's a prompt-injection path into your future email copy.

**20. Each campaign gets exactly one AI analysis, ever — at the worst possible moment.** Eligibility starts at ~20 sends (about day one), the analysis stamps itself done, and nothing ever re-runs it when the campaign completes with real results.

**21. The tracker loads statistics by scanning every enrollment row of every campaign in one unbounded query** — including long-dead campaigns. Grows forever; breaks outright around ~200 campaigns.

**22. Every suppression check rebuilds the entire 60,000-row suppression math from scratch** — the view can't use indexes, so each launch and each recipient screen pays the full recompute per 500-email batch.

**23. A signature-header mismatch can lock out all webhooks** *(verified "plausible" — the one item not fully confirmable without live traffic)*: the code guesses at Smartlead's signature scheme; if Smartlead ever sends a signature keyed differently than assumed, every event for every campaign gets rejected with a 401 — and after 5 failures Smartlead disables the webhook.

---

# Part 2 — Five more catches from the completeness critic

A final agent audited what the *fleet itself* might have missed, and spot-checked these in code. Treat them as one notch below "confirmed" (each was code-verified once, not adversarially twice):

1. **Applying an AI suggestion can permanently overwrite a shared preset template.** Campaigns launched from a preset stamp the *preset's* ID onto suggestions, and Apply has no "is this a preset?" guard — one click edits the system template every future campaign starts from. (The UI deliberately makes presets read-only everywhere else.)
2. **The nightly sweep is almost certainly firing on prod every day and erroring.** The cron's fallback logic reuses prod's email-sync settings, and prod has no Smartlead key — so the function 500s before doing anything. Harmless to data, but it's a daily dead firing that pg_cron logs as "success," and it should be confirmed/silenced.
3. **A launched campaign is completely immutable — there is no "fix it" path.** No rename, no editing steps, no adding recipients, nothing for a campaign that went out with a typo or the wrong list. The only mid-flight controls are pause/stop.
4. **Closing the wizard — Escape, X, or an accidental outside click — discards everything with no warning.** Ironically, a `campaign_drafts` table was built for exactly this and is referenced by zero lines of code.
5. **Old Mailchimp/newsletter records sit in "Ongoing campaigns" forever** — the legacy migration copied them in as "active" with no steps and no enrollments, and the tracker never filters them out. Also in this bucket: the delete API skips the draft-only rule the UI enforces; the feature writes nothing to Pulse's audit log (who launched/stopped what is unrecorded); and the orchestration engine itself — launch, status changes, sweep, webhooks, where every confirmed bug above lives — has **zero automated test coverage** (all 7 test files cover only the pure math helpers).

---

# Part 3 — The improvement roadmap

267 raw ideas from 33 reviewers, deduplicated and ranked into 18 themes. Impact/effort shown as [impact/effort]; S = ≤1 day, M = 1–3 days, L = bigger.

## A. Experience — what reps and Jordan feel

### 1. Daily triage — see what needs you today
The tracker treats every campaign as equal weight; a broken campaign looks identical to a healthy one.
- [high/M] A "needs you" section: unhandled replies, stalled sends, idle drafts bubble to the top
- [medium/M] Trouble flags on cards: no events in days, high bounce rate, inbox maxed
- [medium/S] "Synced 3h ago" freshness stamp; search box; owner filter; stale-draft age hints
- [medium/S] Make the reply count visually dominant (it's the number that matters, currently same gray as everything)

### 2. Replies — act without leaving Pulse
- [high/M] Real actions on a reply card: open a pre-filled reply email, log a call, create an opportunity
- [medium/M] Surface the auto-created follow-up task on the reply card ("Follow-up task created — due today")
- [medium/S] Name the people excluded from a quick-launch, not just a count

### 3. Recipients & ownership — the right people, the right owner
- [high/M] Launch a campaign from a saved List or Report result (today: one contact tag, or CSV re-upload)
- [high/M] Add people to a campaign that's already running
- [high/M] "In a campaign" status + Pause/Stop buttons right on the contact and account pages
- [high/M] Owner picker at launch; follow-up tasks routed to each contact's own owner
- [medium/S] Contact-frequency guardrail (a 90-day cooldown setting already exists on templates — enforced nowhere)
- [medium/S] Pre-launch recipient context: owner, account status, last contacted — catch "I'm about to cold-email a customer"

### 4. Launch flow — safer to hit send
- [high/M] A real pre-flight checklist on the final step: inbox has room, every email has copy, test-send to yourself first
- [high/S] Autosave the wizard (the drafts table already exists!)
- [high/S] "Launch to 412 people?" size-aware confirmation; warn before AI overwrites hand-edited copy
- [medium/S] Schedule a future start date (prep Friday, launch Monday); show the capped send rate in the input itself

### 5. Templates — write once, reuse well
- [high/M] Save wizard edits back to the template (today every campaign means rewriting the same emails)
- [high/S] Click-to-insert personalization tokens (no more memorizing double-brace syntax)
- [high/M] Search/filter/archive for the library; [medium/M] version history with revert (compliance-friendly)
- [medium] Duplicate action for custom templates; drag-to-reorder steps; usage stats inside Edit/Delete dialogs

### 6. Deliverability & safe rollout to the sales team
- [high/S] Enforce the inbox daily cap **on the server** (today it's a browser-only hint)
- [high/S] Send windows/days/timezone per campaign (today: hardcoded 9–5 Pacific M–F for national buyers)
- [high/S] "Pick for me" best-inbox recommendation; health badges *in* the dropdown, before choosing
- [high/M] Count follow-ups (not just new leads) in inbox load; admin sign-off on a rep's first few campaigns, then auto-graduate
- [medium/M] Per-rep send ceilings; automatic alert when an inbox's spam rate goes red

### 7. Reporting — know what's actually working
- [high/M] Per-person history drill-in; next-send countdown ("what's about to happen," not just what happened)
- [high/M] Monthly review: per-template rollups, month-over-month, export
- [high/M] Per-touch breakdown (is email 6 earning its send or burning reputation?)
- [high/M] Subject-line A/B testing (Smartlead supports it natively; planned twice, never built)
- [high/M] Richer personalization: send FTE count, industry, state, partner into Smartlead (4 fields used of 200 available)
- [medium/M] Campaign wrap-up summary when one completes

### 8. People table (campaign detail)
- [medium/S] Status filter chips; sortable columns; CSV export
- [medium/M] Bulk-select non-responders → re-engagement sequence; show the actual resolved email content; progress marker on the sequence strip

### 9. Trust, clarity & accessibility polish
- [high/S] Stop labeling everything "AI-written" when it isn't; standardize vocabulary (no "leads"/"enroll" jargon)
- [high/M] Error-vs-empty distinction everywhere (quiet failures currently render as "nothing here"); names for icon-only buttons; keyboard access to campaign cards
- [medium/S] Plain-English toasts with a next step; action-oriented inbox badges ("Ready to send," not "Warming well")

## B. Engine — reliability, compliance, scale, intelligence

### 10. Webhook & automation reliability
- [high/S] Authenticate webhooks by token lookup (removes a whole failure class); enforce one-enrollment-per-email at the database level
- [high/M] Dedupe replayed webhook deliveries; per-step sweep budgets with rotation; a real sweep run-log + admin health view; catch "job ran but request failed"
- [high/S] Check for replies every few hours, not once daily (a webhook-less campaign can send tonight to someone who replied this morning)
- [high/M] Per-campaign webhook health indicator with a one-click repair

### 11. Compliance & opt-out (the structural fix for Part 1's worst bugs)
- [high/M] **One central opt-out/bounce list** written by every source (webhook, sweep, CSV) and checked by every launch — fixes bugs #2, #3, and the bounce gap for good
- [high/M] Unsubscribe link + postal address as an on-by-default footer (currently a per-campaign option; CAN-SPAM requires it)
- [high/S] Lock legally-required suppressions against "Include anyway" (today an opt-out is overridable just like a business rule)
- [high/S] Re-check suppression daily mid-campaign (opting out on day 3 of 28 currently changes nothing)
- [high/M] Auto-pause on bounce/complaint spikes; [medium/M] separate "no marketing email" from "never contact" (one footer click currently kills phone follow-up too)

### 12. Launch honesty
- [high/M] Server-computed launch preview (the wizard's estimates can disagree with what actually happens); real-name merge preview before send ("Hi ," caught before 400 people see it)
- [high/S] Persist the launch report (who was suppressed/overridden/failed — today it lives in a toast and vanishes); block launch when a safety check itself errors (they currently fail open)
- [high/M] Idempotent launches (safe to retry a lost request)

### 13. Scheduling accuracy
- [high/M] Recompute task dates from stored data instead of nudging by deltas (compounding-error class)
- [medium] Holiday calendar (tasks currently land on July 4th); planned-vs-actual dates displayed; one shared scheduling calculation for wizard and server

### 14. Status controls & audit trail
- [high/S] Record who did every manual start/pause/stop (currently zero trace)
- [high/M] Concurrency-safe status changes; restore tasks on resume (the reverse of #8)
- [medium] Store Smartlead lead IDs at enrollment; per-enrollment sync status with retry; bulk pause/stop; "do Pulse and Smartlead agree?" line per campaign

### 15. Reply handling engine
- [high/M] Safe reply rendering (3-line plain-text teaser + sandboxed full view — reply bodies are raw HTML today); AI-drafted response suggestions
- [high/S] Trim quoted threads from previews — the single biggest readability win in the feed
- [medium/S] Promote "handled" to a real column → live "N replies need you" badge; fixed category vocabulary

### 16. Analytics & attribution
- [high/M] **Campaign → opportunity → revenue join** ("did this campaign make money?" is currently unanswerable, and all the data exists)
- [high/M] Per-touch stats; move browser-side counting into database queries
- [medium] Rep leaderboard; template trend-over-time; reply-quality rollups; weekly digest email

### 17. Speed & scale (walls, in order of arrival)
- [high/S] The handful of missing indexes (Replies feed, webhook lookup, month stats); auto-refresh for the tracker and Replies
- [high/M] Page/virtualize the people table (~1,000-person wall); centralized cache invalidation (kills the stale-screen bug class)
- [high/L] Move large launches to a background job (the synchronous request is the half-launched-campaign risk)
- [medium/S] Lazy-load campaign details; temporary launch-size cap until the background job exists

### 18. AI & CRM integration
- [high/S] Link campaign tasks to their contact/account (currently invisible on the Activity tab); manual "Get insights" button + auto-rerun at completion (fixes #20)
- [high/M] Real before/after diff when applying a suggestion; auto-prompt an Opportunity from an interested reply; campaign emails in the contact's synced email history
- [medium/M] Feed actual reply text (safely fenced) to the AI, not just counts; human approval before AI training notes become permanent rules

---

# Part 4 — What I'd fix first (the reviewer's priority call)

**Before any real sending at scale (compliance + honesty):**
1. Lowercase the suppression view (#1) — small fix, closes the critical hole
2. Make unsubscribe side-effects unconditional (#2) and build the central opt-out list (#3 + bounces + CSV people)
3. Check errors on status writes (#5) and fix partial-launch enrollment (#6)
4. Guard presets from AI Apply (critic #1) — one click away from clobbering shared templates

**Before flipping the gates for reps:**
5. Owner routing for tasks/replies (#4) — without it the team workflow doesn't work
6. Wizard autosave + launch confirmation + server-side inbox cap
7. Sweep observability: run log, watchdog registration, error checking (#16–18) — so failures stop being silent
8. Resume/re-pause task bugs (#8, #14, #15) — reps will hit these in week one

**Then the big experience wins, in rough order of daily payoff:** launch-from-a-list, needs-attention tracker, reply actions, per-touch reporting, revenue attribution.

---

## Appendix — method & numbers

- 33 independent reviewers (12 deep bug-hunters, 11 experience reviewers, 10 strategists) + 1 dedupe agent + 24 adversarial verifiers + 2 synthesis agents + 1 completeness critic = **61 agents**, ~7.8M tokens, 43 minutes.
- 232 raw findings → 171 after dedupe → top 24 adversarially verified → **22 confirmed, 1 plausible, 1 refuted**. The remaining 147 (38 high / 74 medium / 35 low) are credible but unverified — the full list is preserved and worth mining when fix work starts.
- 267 raw ideas → 129 kept across 18 themes after dedupe and ranking.
- Reviewers were seeded with the 8 already-docketed items and the July 22 audit fixes, so nothing above re-reports known work. Everything ran read-only against the Staging branch (all 313 tests green at time of review).
- Full technical detail (file:line traces for every confirmed bug) lives in the workflow journal: `~/.claude/projects/-Users-nathanagellatly-Desktop-AI---Work-Medcurity-Products-Pulse/127b90dc-45bc-49a6-92c0-040cef71fda1/subagents/workflows/wf_9764a833-0b9/journal.jsonl`
