# Nexus "Your Day" — the plan

**Origin (Nathan, 2026-07-29):** the Medcurity compliance platform's dashboard is the inspiration —
greeting + score, a ranked "what to address today" strip, then component cards. Nexus was always
meant to be this for sales ("the dream of Nexus — it just has the foundation"). Home has real value
(KPIs, tasks, open opps, recent wins, recents, quick actions) but Nathan has never customized it and
it has never earned the top spot. Goal: ONE landing surface that tells each salesperson what to do
next, absorbs Home's value, and keeps Jordan M's widget work first-class.

**Status: PLANNING ONLY — nothing built. Jordan M is a stakeholder; review this with her before building.**

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
- **Phase 2 (absorb, staging):** Wins widget, Recents widget, quick-action row, per-role defaults,
  KPI default pins. (~1 day)
- **Phase 3 (flip):** the landing route points at Nexus; the tab takes the name **Home** (one
  landing tab, powered by the Nexus grid — avoids two-homes confusion; "Nexus" survives as the
  internal/engine name unless the team wants it kept visible). Old Home reachable during a grace
  window, then retired. This flip is the existing H2 watch item — Nathan's explicit call.
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
  `nexus-transition-onepager.html`) — Nathan is socializing the plan while the engine gets built.

STILL OPEN (Nathan + Jordan):
1. Which look (A Briefing / B Queue / C Cockpit / a mix).
2. Ranking defaults: money-first vs time-first blend.
3. Cold-call source: everyone or Summer-specific.
4. Day-progress / streak element: v2 at most.

## 6. Explicit non-goals (for now)

- No AI ranking in v1 (rules first; the G2 AI layer can reshape the day later — "ask Pulse to
  rebuild my afternoon" builds naturally on this).
- No mobile-specific work.
- No removal of any Nexus widget Jordan built.
