# AI ↔ Human Handoff — Design & Edge Cases

How a Meddy/Coach conversation moves between the AI and a live human in Pulse,
and how to make it seamless. Grounded in how our website Meddy already works,
then extended for the platform Coach (where the same conversation may bounce
between AI help and human help several times).

Scope note: per Joe, the platform handles its own data isolation (a customer's
content stays with that customer). This doc is only about the **conversation
control handoff** — who is "driving" the chat at any moment, and how control
passes back and forth cleanly.

---

## 1. How our Meddy does it today (the baseline)

State lives on the conversation row. The fields that matter:

| Field | Meaning |
|---|---|
| `assigned_to` | the human agent who owns it (null = no human) |
| `is_human_takeover` | true once a human has taken over |
| `is_human_requested` | the visitor asked for a human (pending) |
| `status` | `active` or `closed` |

**The single most important rule:** the AI only responds when `assigned_to` is
null. The moment a human takes over, the backend sees `assigned_to` is set and
**suppresses the AI** (it tells the widget "taken_over" and stays silent). So
the AI and a human can never both answer the same message — the assignment is
the gate.

**States today:**
1. **AI active** — `assigned_to` null. AI answers.
2. **Human requested (pending)** — visitor clicked "talk to a human" or used a
   request phrase. The request is flagged and staff are alerted, but until a
   human actually claims it, the AI can still help.
3. **Human active** — a staff member took over. `assigned_to` set,
   `is_human_takeover` true. AI suppressed; the human drives.
4. **Closed** — `status` closed.

**Collision-safe:** taking over uses an atomic "claim only if unassigned"
(`assigned_to IS NULL`). If two agents click at once, the second gets a clean
"already taken over by another agent." No double-ownership.

**Realtime:** the widget is told live when it's "taken-over" (with the agent's
display name), when new messages arrive, and when the chat is closed. The visitor
sees who they're talking to without refreshing.

**The gap (the crux of your question):** there is **no "hand back to AI" action**
today. Once a human takes over, `assigned_to` stays set for the life of the
conversation. Closing doesn't clear it; reopening doesn't clear it. So **the AI
never resumes in that same conversation** — it only takes the next *new*
conversation. For our marketing site that's fine (a human who jumps in usually
owns it to the end). **For the platform Coach it's not enough** — a customer
often needs a human for one thing, then wants to keep self-serving with the AI.

---

## 2. The seamless model for the platform (recommended)

The fix is small because the architecture already keys everything off
`assigned_to`. Add one missing piece: **a "release / hand back to Meddy" action.**

Target lifecycle:

```
        ┌───────────── visitor message ─────────────┐
        ▼                                            │
   AI ACTIVE ──visitor asks for human──► HUMAN REQUESTED (AI still helps)
        ▲                                            │
        │                                  agent takes over
   release / hand back                              ▼
        │                                     HUMAN ACTIVE (AI muted)
        └──────────agent clicks "Hand back to Meddy"──┘
                                                     │
                                              agent ends chat
                                                     ▼
                                                  CLOSED
```

**How the seamless return works, with no refresh and no new chat:**
- "Hand back to Meddy" simply clears `assigned_to` (and `is_human_takeover`).
- Because the AI's only gate is "respond when `assigned_to` is null," the very
  next visitor message is answered by the AI again — automatically, same
  conversation, no page reload.
- A realtime event flips the widget header back ("You're chatting with Meddy
  again") and, ideally, the AI posts a short bridge line so the switch is obvious
  ("I'm back — how else can I help?").

That single action turns the sticky one-way takeover into clean two-way control.
Everything else (the suppression gate, the collision lock, the realtime
channel) already exists.

---

## 3. Scenario brainstorm (the situations to design for)

| # | Situation | Desired behavior |
|---|---|---|
| 1 | Visitor chats, AI handles it fully | AI active throughout. No human involved. |
| 2 | Visitor asks for a human, none claims yet | Stay "requested"; AI keeps helping (don't leave them in dead air) and reassures a person is being pulled in. Capture name/email so the team can follow up if nobody's available. |
| 3 | Agent takes over | AI goes silent immediately (assignment gate). Visitor sees "Now chatting with [name]." A system line marks the handoff. |
| 4 | Visitor keeps typing during takeover | Only the human answers. AI must never chime in while `assigned_to` is set. (Already enforced.) |
| 5 | Human resolves the issue and hands back | Agent clicks "Hand back to Meddy" → `assigned_to` cleared → **AI resumes on the next message, same chat, no refresh.** This is the new action to build. |
| 6 | Human steps away WITHOUT handing back | Conversation stays human-owned (AI muted). Decide: an idle timeout that auto-hands-back to the AI after N minutes of agent silence, or leave it parked until the agent acts. Recommend an auto-release timeout so a distracted agent can't strand a visitor with a muted AI. |
| 7 | Two agents try to take over at once | First wins (atomic claim); second gets "already taken over." A second agent can still *join* to collaborate. (Already handled.) |
| 8 | Visitor leaves and comes back later | Same conversation is found by their session id. If still human-owned, they land back with the human; if released/closed, the AI greets them. No duplicate chat. |
| 9 | The Coach was mid-action (a platform task) when a human took over | The AI is suppressed, so it won't fire more actions. The human should see what the Coach was doing / had queued. On hand-back, the AI resumes from current state, not a stale plan. **Open question for your side: do in-flight Coach actions pause, cancel, or complete?** |
| 10 | Escalation is sales vs support | Tag the conversation's intent on the request so it routes to the right Pulse team (support vs sales). Our side already supports team routing. |
| 11 | After hand-back, the visitor asks something only a human can do again | Loops back to #2 → re-request a human in the same conversation. The cycle (AI ↔ human) can repeat any number of times. |
| 12 | Agent ends the chat | `status` closed; widget shows "conversation ended." A later new message can start a fresh AI conversation. Decide whether "closed" also implies hand-back-to-AI for any straggler message before close. |

The two genuinely new decisions are **#5 (build the hand-back action)** and
**#6 (auto-release timeout)**. #9 is the one that's specific to the Coach
(because it takes actions, unlike our chat-only Meddy) and is yours to answer.

---

## 4. What Pulse provides for the integration

- **Escalation in:** the Coach calls a Pulse endpoint to (a) create/locate the
  conversation, (b) post the running transcript, and (c) flag "human requested."
  Logged-in platform users mean the escalation can carry real identity (company,
  user) into Pulse — richer than anonymous web visitors.
- **Staff dashboard:** the conversation appears (and pulses "urgent" when a human
  is waiting and unassigned); a staff member takes over, sends messages, can add
  internal notes, can have a second agent join, and ends the chat. All of this
  already exists for website Meddy and is reused.
- **Control signals out:** realtime events tell the Coach/widget who's driving —
  `taken-over` (with agent name), new human messages, **`handed-back`** (the new
  one), and `closed`. The Coach uses "is `assigned_to` set?" as its own gate to
  decide whether to answer.

The escalation API shape itself is in the companion spec
(`ai-coach-to-meddy-handoff.md`); this doc is specifically the control-handoff
behavior layered on top.

---

## 5. Open decisions for the team

1. **Hand-back trigger** — manual button only, or also auto-release after agent
   idle (recommended: both). What's the idle window?
2. **In-flight Coach actions on takeover** (#9) — pause / cancel / let finish?
3. **What the AI says on resume** — a short bridge line, or silently resume?
4. **Close behavior** — does ending the chat also drop the visitor back to the AI
   for any further message, or end the session entirely?
5. **Routing** — should the platform Coach's escalations always go to a support
   queue (vs the website Meddy's sales-leaning queue)?

None of these block a prototype; they shape the polished version.
