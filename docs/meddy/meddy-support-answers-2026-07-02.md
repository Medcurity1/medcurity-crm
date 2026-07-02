# Answers to the platform handoff doc (2026-07-02)

Keyed to your sections. Attach this WITH the connection guide
(meddy-support-api.md) — it documents every action below in full. Your
probe list missed the two actions you need because they have different
names: **`upsert-conversation`** and **`post-messages`**.

## §2 — The "blocker" already exists: `post-messages`

The customer→agent message action is **`post-messages`** (batch, idempotent):

```json
{ "action": "post-messages", "sessionId": "...",
  "messages": [
    { "role": "customer",  "content": "customer's typed text", "clientMsgId": "uuid" },
    { "role": "assistant", "content": "your AI's reply",        "clientMsgId": "uuid" }
  ] }
-> { "ok": true, "inserted": 1 }
```

Roles are `customer` and `assistant` (not `visitor`). Max 50 per call,
8,000 chars per message, duplicates by `clientMsgId` dropped at the
database level. Keep syncing during a takeover — that is exactly how the
agent sees what the customer types, live.

## §1 addendum — identity: call `upsert-conversation`

You're passing `name/email/company` on `request-human`; those fields are
ignored there. Register identity with:

```json
{ "action": "upsert-conversation", "sessionId": "...",
  "user": { "id": "8842", "name": "Dana Wells", "email": "dana@clinic.com", "company": "Riverside Clinic" } }
```

Call it at chat start (idempotent). `source:"support"` isn't needed —
this endpoint is a fully separate system from website Meddy (own storage,
own staff screen: the **Platform** stream inside Pulse's Meddy tab), so
nothing you send can land on the website stream. Escalation notifications
alert the whole staff team with a distinct "Support" notification type.

## §3 — `status.messages[]` shape (real observed output)

Only `agent` and `system` rows come back — never the customer's or your
assistant's own messages, so no double-render risk. Real sample from our
end-to-end test:

```json
"messages": [
  { "id": 4, "role": "system", "content": "agent_joined",
    "senderName": "Nathan Gellatly", "at": "2026-07-02T03:06:08.569126+00:00" },
  { "id": 5, "role": "agent",
    "content": "Hi! This is a real human reply from the Pulse Support console.",
    "senderName": "Nathan Gellatly", "at": "2026-07-02T03:06:10.687953+00:00" }
]
```

`id` is a stable integer — pass your highest seen as `sinceMessageId` to
get only new rows. `system` contents to render as UI state lines:
`agent_joined`, `handed_back`, `closed`.

## §4 — Transcript on escalation

Push it via `post-messages` (the last ~10 turns is perfect), then call
`request-human`. Order doesn't strictly matter — the conversation is
keyed by `sessionId` — but backlog-then-escalate means the agent has
context the moment the alert fires. Recommended chat-start sequence:
`upsert-conversation` → `post-messages` as the chat happens →
`request-human` when needed.

## §5 — Hand-back / auto-release

- The agent's manual **"Hand back to Meddy"** is live: it clears the
  assignment; your next `status` poll sees `isHumanTakeover:false` plus a
  `handed_back` system row. Nothing for you to build.
- **Auto-release on agent idle: we own it** (your preferred option). It's
  on our list as a follow-up; when it ships it will look identical to a
  manual hand-back from your side. No platform action needed either way.

## §6 — Polling vs realtime

Keep polling. Your 8s cadence is comfortably inside the per-conversation
budget (~900 calls / 15 min each). Our support channels are private
(staff-only) by design, so there is no platform-subscribable realtime
channel — polling IS the contract.

## §7 — Close semantics

Call `close` only on an explicit customer "end chat." Do NOT close on
navigate-away — the conversation is found by `sessionId`, so a returning
customer resumes it, and any new `post-messages` after a close auto-
reopens it (our team gets a "chat reopened" heads-up). Agents can also
end chats from the dashboard; you'll see `status:"closed"`.

## §8 — Auth

Confirmed: `x-support-key` is the header; test and prod each have their
own key; rotations will come through Joe ↔ Nathan. One nit: a `status`
poll for a never-registered sessionId returns `status:"none"` (and
creates nothing) — call `upsert-conversation` first.
