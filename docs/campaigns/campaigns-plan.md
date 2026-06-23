# Campaigns — Product Plan & Architecture

The plan to turn the renamed **Campaigns** tab (formerly Playbook) into a best-in-class,
mixed-channel **sequence builder**: editable preset templates (8-Touch, Warming, …), one-click
enrollment, AI-written steps, and rep task reminders that show up in "Up Next" — that **always
works**, for sales people who don't know the tools.

Generated 2026-06-23 from a 7-agent research pass (findings cross-checked against the live
schema; see "Corrections to the research" at the bottom). Audience: Nathan (decisions) + future
Claude Code sessions building it.

---

## 1. Vision

Campaigns becomes the **one place to run outreach** — not "email here, calls in a spreadsheet,
LinkedIn in your head." A rep (or admin) picks a template, chooses contacts, lets AI write the
emails (and edits them right there), assigns an owner, and hits go. From that single action:

- the **automated emails** go out through Smartlead at a safe pace,
- the **calls and LinkedIn touches** appear as tasks in that rep's **Up Next** on exactly the
  right day, and
- the whole thing **pauses itself** when someone replies, books a meeting, or unsubscribes.

It's a builder you can edit (add/remove/reorder steps, AI-draft any step using the rest of the
sequence as context), beautiful and dead-simple, and engineered so a non-technical rep can't
break it or accidentally email the wrong person.

---

## 2. The one big architectural idea (and the lesson from history)

**No single tool owns a sequence. Campaigns is an orchestrator.**

We removed a native "Sequences" feature in June (commit 487c4fe, 1,721 lines, tables dropped) for
a clear reason: **don't build an email-sending engine that competes with Smartlead.** That lesson
is the spine of this design:

| Step type | Who runs it | Mechanism |
|---|---|---|
| `EMAIL_AUTO` (Days 1, 5) | **Smartlead** | a campaign + email sequence with a throttle |
| `EMAIL_HYBRID` (Days 15, 26) | **CRM task** (+ optional AI draft the rep approves & sends) | `activities` row |
| `CALL` (Days 8, 19) | **CRM task** in Up Next | `activities` row |
| `LINKEDIN` (Days 12, 23) | **CRM task** in Up Next | `activities` row |
| Pause/stop (reply, meeting, unsub) | **CRM trigger engine** | daily Smartlead sync + opp/contact watchers |

Smartlead is **email-only** — it cannot do calls, LinkedIn, or tasks, confirmed. So those steps
are `activities` rows assigned to the contact's owner, surfaced by the **existing** reminder
engine + Up Next widget. We are NOT rebuilding delivery; we are scheduling and coordinating.

---

## 3. Information architecture

The rename is **done** (shipped to staging): sidebar **Campaigns** (Megaphone icon, route stays
`/playbook`), sub-tabs **Campaigns · Playbook · Newsletters** (Campaigns first + default).

Final intended layout of the **Campaigns** sub-tab:

- **Templates gallery** (top) — preset cards (8-Touch, Warming, Post-Demo, Re-Engagement, Event
  Follow-Up) + a blank "Custom" card. Admin builds/edits templates here.
- **Active campaigns** (the working list) — every running sequence, who's at which step, health,
  pause/stop. Sorted **newest first** (fixes Bug #4).
- **Build / Enroll flow** — opens from a template or "New Campaign."

"Playbook" sub-tab = the weekly AI ideas (unchanged). "Newsletters" = Mailchimp (unchanged).

---

## 4. Data model (all NEW tables — the old `sequences`/`sequence_enrollments` are gone)

> Correction to the research: two agents assumed the old `sequences` / `sequence_enrollments` /
> `playbook_sequences` tables still exist. They were **dropped** by `20260613000005_remove_sequences.sql`.
> Everything below is net-new. `playbook_campaigns` (the Smartlead execution tracker) stays as-is.

**`campaign_templates`** — the seedable, editable template library.
- `id`, `name`, `description`, `category` (flagship|warming|post_demo|re_engagement|event|custom),
  `is_preset bool`, `owner_user_id` (NULL for shared presets), `duration_days`, `step_count`,
  `steps jsonb` (array, shape below), `domain_rules jsonb` (e.g. `{start_anchor:"nearest_monday",
  call_days:["TUE","FRI"]}`), timestamps.

**Step shape (in `steps` jsonb):**
```json
{ "order":1, "day_offset":1, "channel":"EMAIL_AUTO|EMAIL_HYBRID|CALL|LINKEDIN",
  "weekday_target":"MON|TUE|...", "send_window_start":"10:00", "send_window_end":"11:00",
  "automation":"AUTO|HYBRID|MANUAL", "subject_template":"...", "body_template":"...",
  "content_ai_draft":true, "pause_on_reply":true, "stop_on_unsubscribe":true,
  "manual_task_title_template":"Call {{first_name}} @ {{company}}",
  "manual_task_priority":"high", "task_note_template":"Day 8 call — reference Day 5 email." }
```

**`campaigns`** — a launched instance (a template snapshot + its Smartlead link).
- `id`, `name`, `template_id` (origin), `steps jsonb` (deep copy — immutable once launched, because
  Smartlead campaigns can't be edited after launch), `owner_user_id`, `sending_email_account_id`
  (Smartlead inbox), `smartlead_campaign_id bigint unique`, `status` (draft|active|paused|completed),
  `leads_per_day int`, `anchor_date`, settings jsonb (pause_on_reply, exclude_dnc, …), timestamps.

**`campaign_enrollments`** — one row per contact in a campaign.
- `id`, `campaign_id`, `contact_id`, `account_id` (denorm), `owner_user_id`, `enroll_position int`
  (the Nth lead — drives the throttle math, §5), `first_send_at` (computed, then reconciled from
  Smartlead), `current_step int`, `status` (active|paused|completed|stopped|replied|bounced),
  `paused_reason`, `enrolled_at`, timestamps. Indexes on `(contact_id,status)` and
  `(owner_user_id,status)`.

**Extend `activities`** (the task table) so a manual step traces back to its enrollment:
- `add column campaign_enrollment_id uuid`, `campaign_step_number int`, `is_campaign_generated bool`.
  When a sequence pauses/stops, we cancel that enrollment's **incomplete** campaign-generated tasks
  (so no "call them" reminder fires for someone who already replied).

Manual step → task uses the **existing, verified recipe**: insert `activities` with
`activity_type:'task'`, `owner_user_id` = contact owner, `subject`, `due_at`, `priority:'high'`,
`reminder_schedule:'once'`, `reminder_at`, `reminder_channels:['in_app','email']`. The
**task-reminders** edge function (runs every 5 min) + **Up Next** widget already do the rest.

---

## 5. The send-rate problem — the heart of "always works" (Nathan's question)

The real bottleneck is **the sending mailbox**, not the campaign. A cold-email inbox can safely
send ~20–40/day; that limit is **shared across all of that rep's campaigns**, so a per-campaign
size cap doesn't solve it (correct instinct).

**Key realization: the sequence timeline is per-PERSON, not per-campaign.** Smartlead doesn't
blast all Day-1 emails at once; you give it `max_new_leads_per_day` and it trickles people in.
Each person then walks the sequence on **their own clock, starting the day their first email
actually sends.** So "Day 8 = call" means *8 days after that person's intro email* — which is a
**different calendar date for each person.**

> ⚠️ This is exactly where the naive design breaks (and where the research synthesis was wrong):
> if we anchor every contact's call tasks to one campaign "start Monday," then contact #45 — who
> won't get their intro email until day 2–3 because of the throttle — gets a **call task scheduled
> before their email even goes out.** That's the bug Nathan foresaw.

**The fix — per-lead anchoring, computed deterministically from the throttle:**
1. We control the pace (`leads_per_day`), so each enrollment's first send is predictable:
   `first_send_at(lead n) = anchor + floor((n-1) / leads_per_day)` days (snapped to a send day).
2. Every step's date — including call/LinkedIn tasks — is computed off **that lead's**
   `first_send_at`, not a global anchor.
3. A **daily reconciliation** job reads Smartlead's actual sent counts and corrects any drift
   (a delayed/bounced send shifts that lead's downstream tasks). Tasks ride the real send.
4. (Later upgrade) a Smartlead **webhook** (`EMAIL_SENT`) makes it real-time instead of daily —
   but we don't need it for v1; deterministic + daily reconcile is robust.

**Make the throttle visible, not magic.** At setup we show a plain-English projection from the
inbox's *remaining* headroom:

> *"Your inbox safely sends ~25/day. Your 2 other campaigns use ~15. So this 50-person campaign
> starts ~10/day — everyone's first email is out within ~5 days, and your first call tasks land in
> Up Next around Jul 2."*

**Cross-campaign coordination.** Because the mailbox is the shared pool, the setup screen sums the
rep's active `leads_per_day` across campaigns on that inbox and warns before they oversubscribe.
(Open item the army couldn't fully confirm: exactly how Smartlead divides one mailbox across
multiple campaigns — fair-share vs first-come. If it's not fair, we add a small CRM-side enrollment
meter. Either way per-lead anchoring holds.)

Answers to the specific questions:
- *Plenty of time before the call?* — per-template, but anchored to the person's real email
  progress, so it's automatically correct regardless of throttling.
- *Size limit per campaign?* — no hard cap needed; the mailbox meters it. We just **show** the ramp.
- *50 separate campaigns?* — they share the inbox pool; we surface remaining headroom before launch.

---

## 6. Reply / pause / stop handling (no webhooks today)

Smartlead exposes replies/unsubscribes via **daily metric polling**, not real-time webhooks (the
existing 12:30 UTC sync). v1 trigger engine, run in the daily job:
- **Reply** (reply_count up) or **meeting booked** (opp created on the account) → pause that
  enrollment, notify owner, cancel its pending campaign tasks.
- **Unsubscribe / bounce** → stop enrollment, set `contact.do_not_contact = true`.
- **Rep logs "Not Interested"** on a task → stop enrollment.
- 24h lag is acceptable for v1; add the `EMAIL_SENT`/`EMAIL_REPLY` webhook later for real-time.

---

## 7. Key flows

- **Build/edit a template (admin):** Templates gallery → New/Edit → visual vertical timeline (drag
  to reorder, + to insert, per-step editor with AI draft) → save.
- **Enroll a list (the 8-Touch):** pick template → pick list/contacts (preview enrollees, auto-exclude
  Do Not Email) → pick sending inbox → AI-draft & edit emails → choose owner (defaults to self) →
  pre-flight check (all steps valid, recipients valid, inbox selected, projected ramp shown) → Go.
- **Fast path (rep, from a Contact/Lead page):** "Run Campaign" button → pick template (e.g. Warming)
  → "From which inbox?" → auto-fills the contact's info → optionally add peers → Start.
- **Rep's day:** call/LinkedIn/hybrid steps appear in Up Next on the right day with a script/note;
  rep acts, checks the box, logs outcome; sequence continues.
- **Reply/meeting:** auto-pause + a "Reply from X — review" task for the owner; pending tasks cancelled.

---

## 8. AI touchpoints (reuse the existing `playbook-ai` patterns)

- **Per-step draft** — "AI: write this step using the rest of the sequence as context" (reads the
  whole cadence + the account's industry/FTE/local-customer signals). Rep edits in place.
- **Subject A/B** — generate 2 variants, optional 50/50 split, winner badge after.
- **Send-time hint** — suggest best windows (the spec's 10–11am / Tue·Fri rationale, tunable).
- **"Optimize this sequence"** — audit the whole cadence against `playbook_training` and suggest
  edits ("Email 1 too long for mobile", "Call 2 same day as Email 2").
- **Personalization caveat:** Smartlead only merges `first_name`/`last_name`/`company_name`/`email`.
  Deeper AI personalization must be **pre-rendered per lead** before upload (a real constraint).

---

## 9. Template library (seed as presets)

1. **8-Touch Sales** (flagship) — the spec, verbatim: 28d, Days 1/5 email-auto, 8/19 call, 12/23
   LinkedIn, 15/26 hybrid email; Monday anchor; pause on reply/meeting; → Nurture after, re-enroll
   90d. (Molly's now; Summer's variant to follow — templates support per-rep variants.)
2. **Warming / Nurture** — *undefined in any doc; proposed default:* gentler 14-day, 3-touch,
   all HYBRID (rep reviews) for post-8-Touch re-engagement. **Needs Nathan's confirmation** of the
   actual cadence (this is an open decision).
3. **Post-Demo** — fast follow-up for demo attendees.
4. **Re-Engagement** — dormant accounts (60+ days quiet).
5. **Event / Webinar Follow-Up** — the use case from today's webinar-list workflow.

---

## 10. The 5 current bugs (Phase 0 — fix first; they're what makes it hard to use today)

| # | Bug | Root cause (from research; verify before fix) | Fix |
|---|---|---|---|
| 1 | Newsletter text underlined | stray `<u>` from the model, or the preview iframe underlining links | strip `<u>` in the parser + ensure link styling uses color/weight, not underline |
| 2 | No Mailchimp audience on push | `pushToMailchimp` copies `list_id` but not always the segment; if the source campaign's recipients are empty it silently makes an audience-less draft | validate recipients exist; copy `list_id` **and** `segment_opts`; throw (don't silently create) if absent |
| 3 | Subject formatting not followed | `parseDraftResult`/`parseReviseResult` run `stripEm`/`fixSpacing` on the **subject**, mangling it | stop post-processing the subject; let the AI's formatting stand (rules already in the prompt) |
| 4 | Smartlead campaigns oldest-first | the list isn't reliably sorted newest-first (bulk-import ties on `created_at`) | sort by Smartlead campaign id / created desc with a stable tiebreaker |
| 5 | MC ingest failed on PROD | most likely **`MAILCHIMP_API_KEY` not set on the prod Supabase project**, or ingest exceeds the 150s edge limit on a large account | confirm the prod secret; make ingest resilient (cap per run, per-fetch timeout, partial-success, less frequent) |

(These need confirmation against the live code/prod before fixing — same verify-first discipline as always.)

---

## 11. Phased build plan

- **Phase 0 — Rename (done) + 5 bug fixes.** Makes today's tool trustworthy. ~Small.
- **Phase 1 — Template + Enrollment MVP.** Tables; seed 8-Touch; template gallery + read-only
  timeline; enroll a list; **per-lead throttle math**; push email steps to Smartlead; spawn manual
  tasks into Up Next; active-campaigns list. The core loop. ~Large.
- **Phase 2 — Trigger engine.** Daily reply/meeting/unsub detection → pause/stop + cancel tasks;
  the fast-path quick-enroll from a contact; the mailbox-headroom projection UI. ~Medium.
- **Phase 3 — AI drafting + optimize.** Per-step AI with whole-sequence context, subject A/B,
  optimize-sequence. ~Medium.
- **Phase 4 — Editable builder.** Drag/reorder/insert steps, custom templates, clone. ~Medium.
- **Phase 5 — Self-serve (non-admin).** RLS for reps; guardrails so reps can't oversend or email
  suppressed contacts; the per-rep "sending capacity" view. ~Medium.
- **Phase 6 — Real-time webhooks, analytics, mobile.** Later polish.

---

## 12. "Make it special" (the best of 15)

Quick-enroll button on every contact/lead; **per-rep sending-capacity dashboard** (see your inbox
headroom + every campaign drawing on it); preview-as-recipient; sequence health cards + low-reply
alerts; one-click **pause-all-my-campaigns**; batch re-enroll from a tag; template versioning so an
edit doesn't disturb running campaigns; AI "coaching" notes from what's working; calendar-aware send
times (skip holidays/PTO); and a guardrailed **pre-flight check** before every launch.

---

## 13. Risks & guardrails (how it "always works")

- **Never email a suppressed contact** — filter enrollment through the hardened **Do Not Email**
  suppression view (customers, partners, DNC, unsubscribed). On by default, shown as
  "50 selected → 47 eligible (3 suppressed)."
- **Never double-enroll** — block a contact already in an active enrollment.
- **Idempotent enrollment + launch** — re-running never double-creates leads or tasks (a
  `campaign_enrollment_id` uniqueness guard).
- **Pause cancels pending tasks** — no "call them" reminder for someone who replied.
- **Immutable launched campaigns** — edits clone a new version (Smartlead can't edit post-launch).
- **Pre-flight gate** — launch disabled until every check is green.

---

## Corrections to the research (for the record)
- Old `sequences`/`sequence_enrollments`/`playbook_sequences` tables **do not exist** (dropped
  June 15). All sequence tables here are new. (Two agents missed the drop migration.)
- Smartlead reply/unsub detection is **daily polling, not webhooks** — v1 uses the daily job; the
  naive single-anchor date math would mis-schedule throttled leads, so we anchor **per-lead** (§5).
- "Warming sequence" is **undefined** in any doc — §9 proposes a default; needs Nathan's real cadence.
