# Meddy Support — Connection Guide for the Platform Coach

How the platform Coach ("Meddy") connects to our side for human handoff.
One endpoint, five actions, JSON in and out. Our side is live; plug in
whenever you're ready.

---

## Endpoint

```
POST https://igmwomnkbbsytihtvhbp.supabase.co/functions/v1/meddy-support
```

Headers on every call:

```
Content-Type: application/json
X-Support-Key: <the key we send you separately>
```

Wrong or missing key returns 401. Call this from your backend only — never
ship the key to the browser.

A test environment is also available (same contract, separate data):
`https://baekcgdyjedgxmejbytc.supabase.co/functions/v1/meddy-support` with its
own test key.

---

## The model in one paragraph

Every chat is keyed by **your** `sessionId` (your session or user id —
calling again with the same id always continues the same conversation, no
duplicates). You sync the transcript to us as the chat happens. When the
customer wants a human, you call `request-human`; our team is alerted and
someone takes over from Pulse. You **poll `status`** a few seconds apart
during active chats: while `isHumanTakeover` is `true`, your AI stays
silent and you render the agent messages that come back; when it flips back
to `false` (the agent handed the chat back), your AI resumes — same
conversation, no refresh, no starting over.

---

## Actions

Every request body includes `action` and `sessionId`.

### 1. `upsert-conversation` — register the chat + who's chatting

Call once at chat start (and again any time identity improves).

```json
{
  "action": "upsert-conversation",
  "sessionId": "platform-user-8842-chat-3",
  "user": { "id": "8842", "name": "Dana Wells", "email": "dana@clinic.com", "company": "Riverside Clinic" }
}
```

Response: `{ "ok": true, "conversationId": "…", "status": "active", "isHumanRequested": false, "isHumanTakeover": false, "agentName": null }`

Identity is what our agents see when they pick up the chat — the more you
pass, the better the handoff.

### 2. `post-messages` — sync the transcript

Send new lines as they happen (batch up to 50). `clientMsgId` makes resends
safe — we drop duplicates.

```json
{
  "action": "post-messages",
  "sessionId": "platform-user-8842-chat-3",
  "messages": [
    { "role": "customer",  "content": "How do I share a policy?", "clientMsgId": "m-101" },
    { "role": "assistant", "content": "Open the policy and use the Public View link…", "clientMsgId": "m-102" }
  ]
}
```

Roles: `customer` (the person) and `assistant` (your AI). Response:
`{ "ok": true, "inserted": 2 }`.

Keep syncing **while a human has taken over** too — that's how our agent
sees what the customer types.

### 3. `request-human` — escalate

```json
{ "action": "request-human", "sessionId": "platform-user-8842-chat-3" }
```

Flags the chat, alerts our team (dashboard + phones), returns the current
state. Idempotent — safe to call twice.

### 4. `status` — the poll (the heart of the handoff)

```json
{ "action": "status", "sessionId": "platform-user-8842-chat-3", "sinceMessageId": 0 }
```

Response:

```json
{
  "ok": true,
  "conversationId": "…",
  "status": "active",
  "isHumanRequested": true,
  "isHumanTakeover": true,
  "agentName": "Rachel Kunkel",
  "messages": [
    { "id": 17, "role": "system", "content": "agent_joined", "senderName": "Rachel Kunkel", "at": "…" },
    { "id": 18, "role": "agent",  "content": "Hi Dana! Happy to help with that policy.", "senderName": "Rachel Kunkel", "at": "…" }
  ]
}
```

- Keep `sinceMessageId` = the highest `id` you've seen; you only get new ones.
- **Your AI gate:** answer with your own AI only while `isHumanTakeover` is
  `false` AND `status` is `"active"`. When takeover is `true`, stay silent
  and render `agent` messages. When `status` is `"closed"`, treat the thread
  as ended (a new customer message reopens it automatically).
- `system` rows tell you the control changes to show in the UI:
  `agent_joined` ("You're now chatting with Rachel"), `handed_back`
  ("You're chatting with Meddy again" — resume your AI), `closed`.
- Polling a session you never registered returns `status: "none"` (and
  creates nothing) — call `upsert-conversation` first.
- Suggested cadence: every 3–5 s while the chat is open or a human is
  requested/active; stop when idle. The budget is per conversation
  (~900 calls / 15 min each), so concurrent chats don't compete.

### 5. `close` — the customer/platform ended the chat

```json
{ "action": "close", "sessionId": "platform-user-8842-chat-3" }
```

A new customer message after close automatically reopens the same
conversation.

---

## The full lifecycle, end to end

```
chat starts        → upsert-conversation (+ identity)
each turn          → post-messages (customer + assistant lines)
"talk to a human"  → request-human            → our team is alerted
you poll status    → isHumanTakeover: true    → your AI mutes; show "Rachel joined"
customer types     → post-messages            → Rachel sees it live in Pulse
Rachel replies     → arrives in your status poll as role "agent"
Rachel hands back  → isHumanTakeover: false + system "handed_back"
                   → your AI resumes, same conversation
chat ends          → close
```

The human can jump in and hand back any number of times in one
conversation.

---

## Isolation guarantee (what we built on our side)

Platform chats live in their own storage, fully separate from the website
Meddy — different tables, different staff screen, nothing shared. Our team
works these chats in a dedicated Support console that only ever sees the
platform side. Agent identities are shared with you as display names only.

## Limits & behavior notes

- `sessionId` max 80 chars (longer is rejected with 400, never truncated);
  message content max 8,000 chars; max 50 messages per `post-messages`
  call; `status` returns up to 100 new rows.
- Duplicate `clientMsgId`s are dropped — enforced at the database level,
  so even racing retries can't double-insert.
- All timestamps UTC ISO-8601.
- 401 = bad key · 400 = bad input · 413 = body too large ·
  429 = slow this conversation down · 503 = our side not configured yet.
