# Converting the Platform AI Coach into "Meddy Support" — Handoff Spec

**For:** Joe + whoever owns the `app.medcurity.com` platform codebase
**From:** the Pulse / Meddy side (this is the CRM-side spec; the Coach side is the platform team's to implement)
**Status:** design handoff — nothing here has been built yet on the platform side
**Last updated:** 2026-06-29

---

## 0. Why this doc exists

The Medcurity **platform (app.medcurity.com)** already has an **AI Coach** — a chatbot trained with all the *actions* it can take inside the platform. Joe wants to turn that Coach into a Meddy experience by adding, on top of what it already does:

1. **Meddy branding**
2. **Meddy knowledge** (the same knowledge base the website Meddy uses)
3. **The ability to escalate a chat into Pulse** (so a human on the team can take over)

…while keeping it **separate / walled off** from the public **website Meddy** (the marketing-site widget). On the back end it can be called **"Meddy Support,"** so platform chats can route to the **support team** while website Meddy chats route to **sales**.

The good news: **Meddy was already built to support exactly this.** Most of the heavy infrastructure (multi-source conversations, escalation, a human-takeover dashboard, a crawled knowledge base, team notifications) already exists in Pulse. This spec explains what to reuse, the exact API contract to call, and the small set of Pulse-side changes needed to light it up.

---

## 1. TL;DR

- **Keep the Coach as-is** (its own UI, its own engine, its platform-action superpowers). Do **not** replace it with the website Meddy widget — that would throw away the actions.
- **Layer Meddy on top:** apply Meddy branding, give it Meddy knowledge, and wire an **"escalate to a human"** path.
- For escalation, the Coach **calls the existing Meddy backend** (`meddy-chat` Supabase edge function) to register the conversation and request a human. That conversation then shows up in the **Pulse staff dashboard** (`/meddy`) tagged with its source.
- Tag platform conversations with a **distinct source** (e.g. `source = "support"`). That single tag is what keeps it walled from the website Meddy *and* lets support-vs-sales routing work.
- A **small amount of Pulse-side work** is required (an explicit `source` field on the API + source-based team routing + a dashboard label). Listed in §9.

---

## 2. The core principle: *layer, don't replace; keep it walled*

There are two different Meddys to keep straight:

| | **Website Meddy** (exists) | **Platform "Meddy Support"** (this project) |
|---|---|---|
| Where it lives | marketing site + embedded widget | inside the app.medcurity.com platform |
| Engine | `meddy-chat` edge function (sales/marketing persona + KB) | the **platform's own AI Coach** (knows platform actions) |
| Superpower | answers prospect questions, captures leads | **takes actions inside the platform** |
| Audience | anonymous visitors / prospects | logged-in customers |
| Routes to | **Sales** | **Support** |

They should **share** infrastructure (escalation, staff dashboard, knowledge base, branding) but stay **separate conversation streams**. The mechanism that keeps them separate is the **`source` tag** on each conversation — Meddy already distinguishes sources today (`main`, `app`, `test`), so adding `support` is the natural extension.

---

## 3. What already exists (the Meddy system you'll plug into)

All of this is live in Pulse today and is reusable:

- **A conversation model.** Every chat is a row in `meddy_conversations` (Supabase/Postgres), with messages in `meddy_messages`. Key fields: `visitor_id` (the session id — conversations are found-or-created by it), `source_site`, `visitor_name/email/company/phone`, `crm_contact_id`, `is_human_requested`, `is_human_takeover`, `assigned_to`, `status`.
- **A public chat endpoint:** the `meddy-chat` edge function (`POST /functions/v1/meddy-chat`). It handles normal chat turns, identity capture, and **human escalation** (see §6).
- **A staff dashboard inside Pulse** at `/meddy`: live list of conversations (Active / Recent / Saved), with **take over**, **whisper**, quick replies, and history. New activity is pushed in real time (Supabase Realtime broadcast on `meddy:dashboard`).
- **Escalation + notifications:** when a visitor asks for a human (or the model decides to escalate), the conversation is flagged `is_human_requested`, the dashboard lights up, and a **Pushover** alert fires to the team. Today the alert is labeled by source (e.g. *"Human Requested – App / Main Site"*).
- **A knowledge base:** the `meddy-crawl` job crawls Medcurity content into a KB that `meddy-chat` injects into its system prompt. This is the "Meddy knowledge."
- **An embeddable widget** (`/widget/meddy-widget.js`) — this is the *website* Meddy UI. **You probably won't embed this on the platform** (you're keeping the Coach's own UI), but it's a working reference for how a client talks to `meddy-chat`.
- **Brand assets** already in the repo: `public/widget/meddy-logo.png`, `meddy-logo-header.png`, `meddy-on-phone.png`. Brand colors in use: primary `#C8102E` (Medcurity red), dark `#1B3A5C`.

---

## 4. Target architecture

```
┌─────────────────────────────────────┐         ┌────────────────────────────────┐
│  app.medcurity.com (platform)        │         │  Pulse / Supabase (CRM backend)│
│                                      │         │                                │
│  ┌────────────────────────────────┐  │  HTTPS  │  ┌──────────────────────────┐  │
│  │  AI Coach (keeps its actions)  │──┼─────────┼─▶│  meddy-chat edge function │  │
│  │  + Meddy branding              │  │ POST    │  │  (escalation + KB)        │  │
│  │  + Meddy knowledge             │  │/meddy-  │  └────────────┬─────────────┘  │
│  │  + "Talk to a human" button    │  │ chat    │               │                │
│  └────────────────────────────────┘  │         │     meddy_conversations        │
│                                      │         │     (source = "support")       │
└─────────────────────────────────────┘         │               │                │
                                                 │   ┌───────────▼────────────┐   │
                                                 │   │ Pulse staff dashboard  │   │
                                                 │   │  /meddy  (take over)   │   │
                                                 │   │  → routes to SUPPORT   │   │
                                                 │   └────────────────────────┘   │
                                                 └────────────────────────────────┘
```

The Coach keeps answering normal turns itself (it has to — that's where the platform actions live). It calls into the Meddy backend for the **escalation/handoff** (and optionally for **KB-backed answers**). Escalated chats land in the **same Pulse dashboard** the team already watches, just tagged `support`.

---

## 5. The three asks — how to do each

### 5.1 Meddy branding

- Swap the Coach's name/avatar/colors to Meddy. Assets and the palette are in §3. Use the name **"Meddy"** in the UI; **"Meddy Support"** is the internal/back-end label for routing (the customer just sees "Meddy").
- Give it a Meddy persona in the Coach's system prompt (friendly, helpful, Medcurity-savvy). The website Meddy's prompt lives in `supabase/functions/_shared/meddy-prompt.ts` — **read it for tone/voice**, but the platform Coach should keep its **own** prompt (different job: in-app help + actions, not prospect sales). See §7 on keeping them separate.

### 5.2 Meddy knowledge

Two options, pick one:

- **(A) Share the KB (recommended for consistency).** The same content Meddy is trained on (the crawled KB) should back the Coach's answers so customers get consistent information. The simplest path: for knowledge questions, the Coach calls `meddy-chat`'s `chat` action and uses the answer; for action requests, the Coach handles them itself. (i.e., the Coach decides: "is this a "how do I…/what is…" question → ask Meddy; is this a "do X for me" → run the action.")
- **(B) Separate, platform-specific KB.** If platform help content differs a lot from marketing content, give the Coach its own KB and just *add* the relevant Meddy knowledge. More control, more maintenance.

> **Decision needed (Joe):** shared KB vs. separate. Recommendation: **shared**, plus a small set of platform-specific help docs layered on.

### 5.3 Escalation to Pulse (the important one)

When the customer wants a human — or the Coach can't help — the Coach hands the conversation to Pulse so a real person can take over:

1. The Coach has a **session id** for the chat (use the platform user's session/user id). This becomes the Meddy `visitor_id` (conversations are found-or-created by it — idempotent).
2. The Coach **registers the conversation + recent messages** with `meddy-chat` and calls the **`request-human`** action, tagging `source = "support"` and passing the known **identity** (logged-in user's name/email/company — see §10).
3. That flips the conversation to `is_human_requested`, pushes it to the Pulse `/meddy` dashboard in real time, and fires the team notification (routed to **support** — see §8).
4. A team member takes over in Pulse; their replies flow back to the customer. (For the reply path you either poll `meddy-chat` for new human messages, or subscribe to the same Supabase Realtime channel the website widget uses — `meddy:conv:<visitor_id>`. Polling is simplest to start.)

---

## 6. The Meddy backend API contract (what the Coach calls)

**Endpoint:** `POST https://<supabase-project>.supabase.co/functions/v1/meddy-chat`
**Headers:** `Content-Type: application/json`, `apikey: <supabase anon key>`, `Authorization: Bearer <supabase anon key>`
**Body:** always includes an `action`; other fields depend on the action.

Confirmed actions today:

| `action` | Payload (key fields) | What it does |
|---|---|---|
| `"chat"` | `sessionId`, `message`, `clientMsgId`, `pageUrl`, `pageContext` | Normal turn → **streams** the Meddy AI reply (KB-backed). Auto-escalates if the model/visitor asks for a human. |
| `"contact"` | `sessionId`, `name`, `email`, `organization`/`company`, `phone` | Attaches identity to the conversation (shows in the dashboard). |
| `"request-human"` | `sessionId`, `pageUrl` | Explicit "talk to a human" → flags `is_human_requested`, notifies the team, returns whether an agent is available. |

Notes for the platform team:
- **Conversations are keyed by `sessionId`** (= `visitor_id`); calling again with the same id continues the same conversation (no duplicates).
- **`source` is currently *derived* from `pageUrl`** (`app.medcurity.com` → `app`, else `main`). For a clean `support` tag you should pass source **explicitly** rather than rely on URL sniffing — that's the main Pulse-side change (see §9, item 1).
- For Joe's use case you likely only need **`contact`** (to attach the logged-in identity) + **`request-human`** (to escalate). You can keep using the Coach's own engine for normal turns, and optionally call **`chat`** when you want a Meddy-KB answer.

---

## 7. Keeping it walled from the website Meddy

- **Different source tag** (`support`) → it's a separate stream in the dashboard, never mixed with website (`main`) chats. This is the wall.
- **Different system prompt / persona.** The website Meddy is prospect/sales-leaning ("book a demo", "contact sales"). Platform Meddy Support is for **existing customers** doing in-app tasks — it should *not* push sales CTAs. Keep the Coach's prompt separate; only borrow tone.
- **Do not embed `meddy-widget.js` on the platform.** That script *is* the website Meddy and would bring the wrong persona + lose the Coach's actions. Reuse the **API**, not the widget.

---

## 8. Team routing — support vs sales

The end goal: platform ("Meddy Support") escalations notify the **support team**; website Meddy escalations notify **sales**.

- Today escalations notify the team via **Pushover**, labeled by source. The routing-by-source extension is small: map `source = "support"` → support team recipients, other sources → sales. (Pulse already has a "requests routing" concept that routes different request types to different people — the same idea applies here.)
- In the Pulse `/meddy` dashboard, add a **`Support` source label + filter** so the support team can see just their queue. (The dashboard already shows per-conversation source labels.)

---

## 9. Pulse-side changes needed to enable this (small, on us)

These are the changes the **Pulse/Meddy side** (us) would make so the platform Coach can plug in cleanly:

1. **Explicit `source` on the API.** Accept an optional `source` (e.g. `"support"`) on the `chat` / `contact` / `request-human` actions and store it on `meddy_conversations.source_site`, instead of only deriving it from `pageUrl`. *(Small.)*
2. **Source-based escalation routing.** Route `source = "support"` notifications to the support team; keep others on sales. *(Small.)*
3. **Dashboard label + filter for `support`.** So the support team sees their queue distinctly. *(Small.)*
4. *(Optional)* **A scoped auth path** if we don't want the platform calling with the public anon key — e.g. a dedicated key or a thin proxy. *(Decide during build.)*

None of these are large; the architecture already supports multiple sources.

---

## 10. Identity advantage (logged-in users)

The website Meddy talks to **anonymous** visitors, so it has to *ask* for name/email. The platform Coach talks to **logged-in customers** — so it already knows who they are. Pass that identity via the `contact` action (name, email, **company**) when escalating. The escalated chat then shows the **real company name** in the Pulse dashboard immediately (Pulse just shipped company-name display in the Meddy chat view — this dovetails with it), which is a big quality-of-life win for whoever takes the chat.

---

## 11. Open decisions (for Joe / the team)

1. **Shared KB or platform-specific KB?** (Recommend shared + a few platform docs.) — §5.2
2. **How much goes through Meddy vs. the Coach's own engine?** Recommend: Coach handles actions + normal turns; Meddy backend handles escalation (+ optionally KB answers). — §4
3. **Reply delivery to the customer after a human takes over:** poll vs. Realtime subscription. (Start with polling.) — §5.3
4. **Auth model** for the platform→Meddy calls (anon key vs. dedicated key/proxy). — §9.4
5. **Support team membership + notification channel** (who gets the Pushover/alert for `support`). — §8

---

## 12. Suggested build phases

- **Phase 1 — Branding + persona.** Re-skin the Coach as Meddy; give it a Meddy-flavored prompt (keep its actions). Visible win, no backend dependency.
- **Phase 2 — Knowledge.** Wire KB answers (shared KB call, or load platform help docs).
- **Phase 3 — Escalation MVP.** Pulse adds the explicit `source` field (§9.1); the Coach calls `contact` + `request-human` with `source = "support"`; chats appear in the Pulse dashboard; a human can take over (polling for replies).
- **Phase 4 — Routing + dashboard polish.** Source-based routing to the support team (§9.2) + dashboard label/filter (§9.3).
- **Phase 5 — Hardening.** Auth model, reply-path via Realtime, analytics.

---

## Appendix — where the reference code lives (Pulse repo)

- `supabase/functions/meddy-chat/index.ts` — the chat/escalation endpoint (the contract in §6).
- `supabase/functions/_shared/meddy-prompt.ts` — Meddy persona/voice (reference for tone).
- `supabase/functions/meddy-crawl/` — the KB crawler.
- `supabase/migrations/20260612000002_meddy_foundation.sql` — the `meddy_conversations` / `meddy_messages` schema.
- `src/features/meddy/` — the Pulse staff dashboard (conversation list, take-over, whisper).
- `public/widget/meddy-widget.js` — the **website** widget (reference client; don't reuse on the platform).
- Brand assets: `public/widget/meddy-logo*.png`, `meddy-on-phone.png`. Colors: `#C8102E` / `#1B3A5C`.
