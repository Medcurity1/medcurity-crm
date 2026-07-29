# Nexus "Your Day" — the plan

**Origin (Nathan, 2026-07-29):** the Medcurity compliance platform's dashboard is the inspiration —
greeting + score, a ranked "what to address today" strip, then component cards. Nexus was always
meant to be this for sales ("the dream of Nexus — it just has the foundation"). Home has real value
(KPIs, tasks, open opps, recent wins, recents, quick actions) but Nathan has never customized it and
it has never earned the top spot. Goal: ONE landing surface that tells each salesperson what to do
next, absorbs Home's value, and keeps Jordan M's widget work first-class.

**Status: Phase 1 engine build authorized (Nathan 2026-07-29, "you can build on nexus in the meantime"); widget UI waits on the look pick. Jordan M reviews defaults + wording before the flip.**

---

## 1. The heart: the Next-Best-Action queue ("Your Day")

A full-width anchor widget at the top of Nexus. A short ranked list (top ~7, expandable) where every
row is (1) a person/deal, (2) a plain-English reason, (3) one action button. Modeled on Medcurity's
"What to address today" strip but as a working queue, not three static cards.

### Signal sources — ALL already in the database, no new collection needed

| Signal | Source | Example row |
|---|---|---|
| Unhandled campaign reply | campaign_events (payload.handled null) + reply_category | "Reply from Dr. Chen (Interested) — yesterday, unanswered" |
| Campaign call/LinkedIn task due | activities (campaign_enrollment_id, due today/overdue) | "Call Sarah at Lakeview — Day 8 of your campaign" |
| Standard task due/overdue | activities (owner, due_date) | "Follow up with Riverside — due today" |
| Renewal window, no open deal | renewal_queue / v_renewal_audit + open-opp check | "Sunrise Health $14k renewal — 45 days out, no deal open" |
| Stale open deal | opportunities + last activity age by stage | "Riverside $9k proposal — no touch in 21 days" |
| Meeting booked (campaign pause) | campaign_enrollments paused_reason=meeting_booked | "Meeting booked with Northlake — prep" |
| Campaign needs-attention | needs-attention.ts signals (bounce, stale draft) | admin-leaning; include for admins only |
| Cold-call next-up (Summer) | cold-call list source (existing widget's query) | "Next 3 dials from your working list" |

### Ranking — transparent rules, no black box

Simple weighted score, every row shows its why: hot reply (interested/meeting) > overdue task >
renewal by $ and proximity > campaign task due today > meeting prep > stale deal by $ > cold-call
filler. Deterministic and explainable; tuning is a config table, not code.

### Implementation shape

- **One SQL view or RPC** `rep_day_queue(p_user_id)` (SECURITY INVOKER, RLS-honoring) that UNIONs
  the sources into a common row shape: `{item_key, kind, title, reason, urgency_score, amount,
  due_at, account_id, contact_id, opportunity_id, enrollment_id, task_id}`. One round-trip, fast,
  and testable in isolation (acceptance: run as each rep on staging, eyeball the ranking).
- **item_key** is deterministic per underlying thing (e.g. `task:<id>`, `reply:<event_id>`,
  `renewal:<account_id>:<year>`) so snoozes stick.
- **Snooze table** `day_queue_snoozes (user_id, item_key, until, created_at)` — "not today" hides a
  row until the chosen date; RLS per-user. "Done" is NOT stored — completing the underlying action
  (task done, reply handled, opp created) naturally removes the row on refetch. No second source of
  truth.
- **Client**: one new Nexus widget (`YourDayWidget`) rendering the queue with per-kind action
  buttons (open reply / log call via existing log-call flow / open account / open deal / snooze).
  Per-kind row components, shared shell. React-query with a short stale time; refetch on focus.
- **Greeting header** above the grid (Medcurity-style): "Good morning, Summer — 3 replies waiting,
  2 renewals need attention, 5 tasks today." Counts come from the same queue query — free.
- Optional later: a small "day progress" ring (items cleared today) as the posture-score analog.
  Explicitly NOT phase 1 (gimmick risk; validate the queue first).

## 2. Where Home's pieces land (nothing valuable dies)

| Home piece | Destination | Notes |
|---|---|---|
| My KPIs | Nexus MetricsWidget | already exists; ship per-role default pins |
| My Tasks | Nexus TasksWidget | already exists; Your Day shows only due/overdue slice |
| My Open Opportunities | Nexus PipelineWidget (or a small list widget if Jordan prefers a list) | |
| Recent wins / team feed | NEW small "Wins" widget — closed-won feed w/ names | coworker favorite; keep prominent in default layout |
| Recent Activities + Recent Records | NEW compact "Recents" widget | crm_recent_records localStorage already tracks visits |
| Quick actions | button row in the Nexus header (New task / contact / opportunity / log call) | |
| Pipeline Summary / Upcoming Renewals / Saved Report / My Accounts / Cold Call (off-by-default set) | already have Nexus equivalents or become widgets on demand | Cold Call widget = Summer's, pending ICP (existing thread) |

## 3. Defaults, roles, and Jordan's work

- Per-role default layouts: rep default = Your Day (full width) → Tasks + Wins → Metrics +
  Pipeline → Recents. Admin default adds Requests + campaign needs-attention. Stored like current
  Nexus layout config; users can still add/remove/reorder — Jordan's builder and custom widgets
  remain first-class citizens, Your Day is just the anchor.
- Jordan M reviews the default layouts and the queue's reason wording before anything ships.

## 4. Cutover (phased, reversible)

- **Phase 1 (build, staging):** queue view/RPC + snooze table + YourDayWidget + greeting header on
  Nexus. Home untouched. Team plays with it. (~1–2 days)
- **Phase 2 (absorb, staging):** duplicate EVERYTHING Home has onto Nexus while Home still exists
  (Nathan 2026-07-29: "turning off Home at the end does essentially nothing cause everything else
  would already be set up"). Wins widget, Recents widget, quick-action row, per-role defaults, KPI
  default pins, and the Home widget-config carry-over. Both tabs fully work in parallel;
  Phase 3 becomes a no-op removal. (~1 day)
- **Phase 3 (flip):** the landing route points at Nexus and **the tab keeps the name Nexus — Home
  is retired** (decided; see §5). Old /home routes redirect to Nexus with "looking for X? it's now
  here" pointers + an AnnouncementBanner cycle for a few weeks. This flip is the existing H2 watch
  item — Nathan's explicit call.
- Each phase: staging → Nathan/Jordan/Summer feedback → his prod word. Standard rails.

## 5. Decisions & open questions

DECIDED (Nathan, 2026-07-29):
- **The tab is NEXUS. Home is retired at the flip.** Nexus becomes the top tab and the landing page.
- **Transition notifications are REQUIRED at the flip** — "Looking for this? It's now here" pointers
  plus an announcement ("Nexus — a new landing zone for managing your busy days"). Use the existing
  AnnouncementBanner + contextual redirect hints from the old Home route.
- **Build without disruption:** the Your Day feature lands on Nexus FIRST (nobody's workflow
  changes); Home and tab order untouched until the team has reviewed. Look options + a
  non-technical one-pager produced 2026-07-29 (`nexus-look-options.html`,
  `nexus-transition-guide.html`) — Nathan is socializing the plan while the engine gets built.

DECIDED (Nathan, 2026-07-29, round 2):
- **Look = the Briefing (Option A)**, refined. Hero greeting + counts, top-3 strip, then the
  existing customizable widget grid. Users' CURRENT widget setups carry over beneath the briefing
  (Phase 2 includes a config import so below-the-briefing barely changes for anyone).
- **Copy rules for the Nexus tab: NO em dashes, no filler, no AI-flavored fluff.** Counts and plain
  phrases only ("Good morning, Summer." + "3 replies waiting · 2 renewals in window"), never
  "strong start" style padding. The queue's reason strings are UI copy and follow the same rule
  (20260729150000 re-emitted them dash-free).
- **The briefing must serve non-sales users as well as Home did or better.** It shows whatever work
  the user actually has: product folks lead with waiting Requests + due tasks (Rachel), assessment
  folks with tasks/deadlines; no deals = no deal rows. Queue engine gains a requests branch for
  this (build item). Role-based default layouts under the briefing (Rachel's leads with metrics).
- **Metrics: no new top-level tab.** The 16 key metrics boil into the compact My Numbers widget on
  Nexus (user picks favorites); the FULL metrics catalog lands under Reports, where deep numbers
  already live. Home's removal does not open a Metrics tab seat.

FLIP PREREQUISITE noted 2026-07-29 (goes with docket I34): the briefing's reply rows route to
/playbook, which is admin-gated. Fine today (campaigns are admin-only), but the rep rollout must
either ungate a replies view or reroute rep clicks to the contact record.

DECIDED (Nathan, 2026-07-29, round 3):
- **Step 1 completeness is a CHECKLIST** of all 11 Home pieces + quick actions; every one must have
  a Nexus (or other-tab) home before any swap. **Existing user layouts carry over automatically.**
  **Role defaults decided BEFORE the swap** (Jordan owns the sales default; product/analyst defaults
  differ). Usage-tracking for the Home retirement call: unnecessary, skip it.
- **The tour**: exactly ~3 popup squares, rounded corners, gradient, beautiful, precisely anchored
  to the element they describe, genuinely fun. **No skip button** (small team, it's short); shows
  once per user, never again after click-through.
- **The feedback line**: "Something missing?" one-click link (prefilled CRM request) lives in the
  announcement/transition period only; REMOVE it once the Home tab is retired.

RESOLVED by code investigation (2026-07-29): the cold-call question dissolves. Summer's own Q8
answer (2026-07-15) already made the widget LIST-DRIVEN: it pulls dials from a call list the user
curates, and her lists superseded the never-defined ICP config. So: the Cold Call widget ports to
Nexus as a normal add-it-if-you-want widget (default for nobody; Summer's setup carries over via
the layout import), and the briefing's future cold-call filler branch only produces rows for users
who have a call list with members. No list, no cold-call content. Role never enters into it, and
nobody has to define an ICP.

DECIDED (Nathan, 2026-07-29, round 4 — the layout + polish program):
- **Two-stack layout replaces the row-aligned grid.** Left and right independent stacks, natural
  widget heights, small vertical gaps, never more than 2 columns (1 on narrow/mobile). Kills the
  dead-space-under-short-widgets problem. No resize handles ever; "rows shown" stays the only size
  knob.
- **Briefing cycles instantly.** Acting on a card swaps the next-ranked item in optimistically;
  "Not today" re-ranks tomorrow; old items keep outranking new small stuff until handled; empty
  state only when the pool is truly empty.
- **Metrics program (team loves Home's KPIs — must be BETTER, never worse):** (a) unlimited stat
  tiles in one Metrics widget (big number, delta arrow, mini trend where history exists);
  (b) FEATURED PINS (Nathan's idea): via Customize, pin 1-2 widgets ABOVE the "Your widgets" line
  into the top area — pin Metrics and you get Home's KPI band, but with your chosen numbers;
  (c) Reports' Dashboard Metrics page audited 16-for-16 and gaps filled.
- **One Customize button replaces Add a Widget**: phone-home-screen edit mode (drag between stacks,
  X to remove, visual add gallery with live mini-previews), plus pinning and the hero look, all in
  one place.
- **Hero gradient presets**: the demo's richer teal-navy becomes the default; 4-5 curated looks
  pickable in Customize. No free color pickers.
- **High-five parity**: Home's Recent Wins high-five interaction is USED; the Nexus Wins widget
  must carry it (investigate deal_wins mechanics during the build). Not-worse rule applies.

BUILD ORDER (round 4): 1 two-stack layout → 2 briefing instant cycling → 3 metrics tiles +
16-for-16 Reports audit → 4 Customize mode (gallery + pins + hero presets) → 5 wins high-five
parity. All staging, all beneath the dormant flip.

STILL OPEN (Nathan + Jordan):
1. Ranking defaults: money-first vs time-first blend.
2. Day-progress / streak element: v2 at most.

## 6. Explicit non-goals (for now)

- No AI ranking in v1 (rules first; the G2 AI layer can reshape the day later — "ask Pulse to
  rebuild my afternoon" builds naturally on this).
- No mobile-specific work.
- No removal of any Nexus widget Jordan built.
