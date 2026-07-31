# MSD-957 — Client-impact gating for Pulse bug requests

**Status:** plan, ready to build · **Assignee:** Makena Dashiell · **Written:** 2026-07-30
**Ticket:** https://medcurity.atlassian.net/browse/MSD-957
**Repos touched:** `medcurity-crm` (Pulse) · `helm` · Jira MSD board config
**Not touched:** `medcurity` (Laravel). See §1.1.

---

## 0. Executive summary

Rachel asked for one thing, in one sentence, on 2026-07-29 at 1:32 PM:

> "I would still want them gated first by client-facing or not and have that decision in the email."

Two of the three pieces implied by that sentence are **already done and live in prod as of today (2026-07-30)**. The one genuinely missing piece is the client-facing gate itself.

| Piece | Owner | State |
|---|---|---|
| Bug submissions email the routed reviewers at all | Nathan | ✅ **Live in prod** — commit `d9f9625`, promoted today in `6fd4e58` |
| Bugs are visible somewhere for Rachel | — | ⚠️ Partial — visible in Jira "Nexus Drops", **not** in Pulse's Nexus Requests widget |
| The client-facing determination, in the email and gating review | **Makena (this ticket)** | ❌ **Does not exist anywhere** |

This plan builds the third row. It also corrects five factual errors in the ticket's auto-generated spec (§1), which if followed would send the work into the wrong repo entirely.

---

## 1. The ticket's auto-spec is wrong — read this before anything else

MSD-957's description was written by Helm's auto-spec writer on 7/29 and self-graded **62/100 (D, needs_work)**. That grade was accurate. Do **not** build from it. Specifically:

### 1.1 `app/Services/JunoService.php` is irrelevant — do not touch it

The spec names this as the primary affected file. **"Juno" is Juno Live (`medcurity.junolive.com`), a third-party virtual-event/LMS SaaS Medcurity used in 2023–2024.** It has nothing to do with Helm. Evidence:

- Last modified `2023-12-08` (commit `b5823f9c4`, Brandon Perdue). Untouched for 20 months.
- `JUNO_URL_LIVE` / `JUNO_KEY_LIVE` are **blank** in `.env`; there is no `config/services.php` entry.
- Its tenant is hardcoded: `"site" => "medcurity.junolive.com"` in `magicLinkCreate()`.
- It was superseded by the first-party `app/Services/MedcurityLMSService.php`.
- Its debug route `junoapitest` was deleted in the 2026-06-24 break-glass security commit `8e14a9f00`.

The spec writer pattern-matched "generic authenticated HTTP client to an external service" and picked the wrong one. **No change is needed in the `medcurity` Laravel repo for this ticket at all.**

### 1.2 "Nexus" is in Pulse, not Helm

The spec says the Nexus Requests tab lives in Helm. It does not. Nexus is `src/features/nexus/` in **medcurity-crm**. Helm contains zero Nexus UI — its only knowledge of the word is the Jira status string `'Nexus Drops'` in three constants (`src/lib/board-view.ts:35`, `src/app/api/dev/flow/route.ts:34`, `src/app/api/daily-quests/suggest/route.ts:39`).

### 1.3 "Nexus Drops" is a Jira column, not a Pulse UI column

The spec's acceptance criterion "the request appears in the Nexus Drops column" reads as though Drops is a lane in Pulse. It isn't. **Verified live via the Jira API today:** transition id `12` → name `"Nexus Drops"` → status id `10087`, category `indeterminate`. It is a column on the MSD board. Pulse reaches it via `JIRA_TRANSITION_ID` (default `"12"`) in `supabase/functions/product-request-action/index.ts:108`.

There is no Drops concept in the Pulse DB. Pulse's request statuses are exactly `pending | completed | approved | denied | cancelled`.

### 1.4 Pulse does not call Helm — both call Jira independently

The spec assumes a Pulse→Helm call exists or is trivially added to an existing client. It doesn't exist. Today:

```
Pulse (Supabase edge fn) ──REST──> Jira MSD ──60s sync──> Helm
```

Helm has **zero** references to Pulse, the CRM, or Supabase in `src/`. There is no endpoint for Pulse to post to. Building one is real work (§6.1), not a one-line addition to an existing service.

### 1.5 "Send an email on every bug submission" is already done

Spec item 4 and its acceptance criterion shipped today. See §3.

---

## 2. How the system actually works today (verified, with file paths)

### 2.1 Submission

`src/features/requests/RequestsPage.tsx` → `ProductForm()`. Fields collected: **category** (`bug` | `enhancement`, required), **title**, **description**, **attachments** (≤5, 25 MB), **priority** (`low` default). That is the complete field set. There is no client-impact input of any kind — `grep -ri "client.facing\|client_facing\|client impact"` across the whole medcurity-crm repo returns **zero hits**.

Category is stored untyped in the `details` JSONB as `details.category`. There is no column, no enum, no check constraint. Migration `20260717000001_request_bug_category_notify.sql` — the only DB artifact of the Bug/Enhancement split — changes **only the in-app bell label**. Its own header says so.

### 2.2 The bug fast-path

`src/features/requests/api.ts` → `useCreateRequest()`:

```ts
if (input.type === "product" && input.details?.category === "bug") {
  const res = await invokeRequestAction({ action: "file_bug", requestId: data.id });
  if (res.filed) bugFiled = { jiraKey: res.jiraKey, jiraUrl: res.jiraUrl };
}
```

`supabase/functions/product-request-action/index.ts`, `action: "file_bug"`:

1. CAS-claims the row: `.update({ status: "completed", decision_note: "Bug report — filed straight to Jira (no approval step)", completed_at, completed_by }).eq("status", "pending")`
2. `fileRequestToJira()` → `createJiraIssue` (issue type from `JIRA_ISSUE_TYPE_BUG`, default `Bug`) → `transitionJiraIssue` (id `12` = Nexus Drops) → `moveToBoard` → upload attachments
3. On failure, rolls back to `pending` so manual approve remains available

Auth carve-out: `file_bug` is the one action a non-admin may invoke, and only on their own request.

### 2.3 Why Rachel can't see them

`src/features/nexus/widgets/RequestsWidget.tsx` queries with **`pendingOnly: true`**. A bug is set to `completed` within ~1–11 seconds of submission. It is therefore *never* in a state the widget renders. This is working-as-designed, not a bug in the widget.

### 2.4 Prod evidence (queried live, 2026-07-30)

Every product bug request ever submitted:

| Created | Requester | Title | Pri | Jira | Emailed | Time to "completed" |
|---|---|---|---|---|---|---|
| 07-20 | Jordan Scherich | BAA Module Not Working | high | MSD-922 | ❌ | 2.0s |
| 07-21 | Summer Hume | Upgrade / Bug Bix | med | MSD-924 | ❌ | 7.9s |
| 07-22 | Jordan Scherich | Policies | high | MSD-926 | ❌ | 0.7s |
| 07-23 | Jordan Scherich | Policy Intake | high | MSD-927 | ❌ | 2.3s |
| 07-23 | Jordan Scherich | Worklist Issues | high | MSD-930 | ❌ | 0.7s |
| 07-24 | Jordan Scherich | Facility Policy | med | MSD-934 | ❌ | 11.6s |
| 07-29 | Johnny Warren | Disparity in training courses assigned vs shown | low | MSD-951 | ❌ | 2.3s |
| 07-29 | Rachel Kunkel | Upgrade bug/enhancement policy approve button | med | MSD-954 | ❌ | 1.3s |
| 07-29 | Rachel Kunkel | Upgrade bug — editing an already approved policy | med | MSD-956 | ❌ | 1.9s |
| 07-30 | Rachel Kunkel | Upgrade bug — unnecessary buttons / wrong wording | med | MSD-966 | ✅ | 1.3s |
| 07-30 | Rachel Kunkel | Upgrade bug — can't change uploaded title | med | MSD-983 | ✅ | 1.3s |

**9 of 11 bugs reached Jira with no email to anyone.** Three of them (MSD-922, 924, 926) were later independently re-triaged as client-facing production issues by the hourly Nexus Drops task and emailed to Makena — days after submission, and only because a separate automation happened to catch them. That gap is the actual business cost of this ticket.

The last two emailed because Nathan's fix went live earlier today. Note the pattern change: **Rachel herself is now the top bug submitter** (5 of the last 6). She is submitting bugs and getting no confirmation that anyone with authority saw them.

---

## 3. What already shipped (do not rebuild it)

Commit `d9f9625` "Requests: send an email notice for auto-filed bug reports" (Nathan, 7/29 13:23) was promoted to prod today in `6fd4e58`. It:

- removed the `if (!bugFiled)` guard in `useCreateRequest()`, so `request-email-notify` now fires for every submission
- added an `isFiledBug` branch in `supabase/functions/request-email-notify/index.ts` with its own subject (`New bug report: …`) and body pointing to Helm/Jira rather than back into Pulse

This plan **extends** that branch rather than replacing it. The `detailRows` table and the `isFiledBug` fork are the exact insertion points for the Client-facing line.

⚠️ **Merge-conflict warning:** `origin/Staging` currently carries the full Nexus revamp (≈6,200 lines across 49 files, including six new migrations dated `20260729*`). Branch from `origin/main`, not `Staging`, and rebase before merging.

---

## 4. The defect, stated precisely

> A product request submitted as a Bug is transitioned to `status = 'completed'` in `public.requests` within seconds of insert, by the `file_bug` action in `supabase/functions/product-request-action/index.ts`, before any human has assessed whether the bug affects clients. Because `RequestsWidget` filters `pendingOnly: true`, the request is structurally invisible to Rachel in Pulse from the moment it exists. No client-impact signal is captured at submission, stored on the row, carried onto the Jira ticket, or stated in the notification email — so neither Rachel nor the dev pipeline can distinguish a cosmetic copy bug from a production incident affecting a paying client, and both are indistinguishable in Nexus Drops, ordered only by created-date.

---

## 5. Design decisions (confirmed with Makena, 2026-07-30)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Helm** performs the client-facing classification, using repo-grounded AI. Not Pulse. | Rachel's submitters (Jordan, Summer, Johnny) cannot reliably judge client impact. A text-only classifier can't either. Helm already reads the live Medcurity repo — §6.1. |
| D2 | The submitter sees the AI verdict on the form and **can override it**. | Human-in-the-loop; the submitter often knows a client called them. |
| D3 | The Jira ticket is **filed immediately in every case**. Client-facing bugs are *flagged* for Rachel, not *blocked* on her. | The client-facing case is precisely the one where a filing delay hurts most. Blocking would have meant MSD-922 (BAA module broken, high) sat unfiled. |
| D4 | The gate lives on the **Pulse request status**: client-facing bugs stay `pending` (so they appear in Rachel's Requests widget); non-client-facing bugs auto-`complete` as today. | Directly answers Nathan's original question — "should bugs show somewhere in Nexus too?" — for exactly the bugs that warrant it, without flooding the widget. |
| D5 | Ship to **staging** and hold for Rachel's sign-off before prod. | Same gate Nathan applied to the email copy. |

### 5.1 Divergence from the ticket's written acceptance criteria

D3 deliberately contradicts MSD-957 AC #1 ("does not file it to Jira until Rachel approves"). That AC came from the auto-spec's reading, not from Rachel. Rachel's actual words were "gated… and have that decision in the email" — she asked for *review and visibility*, not for a filing block. **The ticket description must be updated to match D3 before this is built**, and Rachel should confirm. See §10.

---

## 6. Implementation

### 6.1 Helm — new repo-grounded classifier + Pulse ingest endpoint

**Why Helm, not Pulse.** Helm's AI features get codebase grounding through agentic tool-use backed by **Bitbucket Cloud REST** — Helm never checks the repo out. `src/jobs/pm-spec-tools.ts` exposes five read-only tools (`read_codebase_map`, `search_code`, `grep_repo`, `read_file`, `list_dir`) wired to `src/lib/bitbucket.ts`, defaulting to the `production` ref. Five existing features ride this, including `dev-code-change` which ships real merged code. Pulse has no equivalent and can't get one cheaply. This is the mechanism behind "needs repo access like Helm."

#### New file: `src/lib/bug-classify.ts`

```ts
import { callClaudeWithTools } from '@/lib/anthropic';
import { PM_SPEC_TOOLS, makeToolExecutor } from '@/jobs/pm-spec-tools';

export interface BugClassification {
  clientFacing: boolean;
  confidence: number;        // 0..1, clamped
  reasoning: string;         // ≤ 400 chars, shown to submitter AND in Rachel's email
  affectedAreas: string[];   // confirmed file/module paths, ≤ 5
  model: string;
}

export async function classifyBug(input: {
  title: string; description: string; priority: string; requesterName: string | null;
}): Promise<BugClassification>
```

- `CLASSIFY_SYSTEM` prompt must define client-facing concretely for Medcurity: *does a paying customer, on `app.medcurity.com` or `training.medcurity.com`, encounter this in normal use?* Internal Nova/admin-only surfaces, dev/staging-only defects, and cosmetic issues on internal tooling are **not** client-facing. Anything touching SRA, BAA, Policies, Training, PhishRx, or the customer dashboard is client-facing until proven otherwise.
- Instruct: call `read_codebase_map` **first** (cheap orienting move mandated by `SPEC_SYSTEM`), then at most 2–3 `grep_repo`/`read_file` calls to confirm which surface the report touches.
- `maxRounds: 6`, **`deadlineMs: 60_000`** (mandatory — Azure App Service's ARR gateway kills at ~230s; an unscoped `grep_repo` costs ~18s), `maxTokens: 900`.
- Coerce with a never-throws `coerceClassification()` modelled on `coerceTriage` in `src/lib/ticket-triage.ts`.
- **Fail-safe default: `clientFacing: true`, `confidence: 0`, reasoning `"Classifier unavailable — defaulted to client-facing for review."`** Failing closed sends an extra item to Rachel; failing open silently drops a client incident. Never the latter.

#### New file: `src/app/api/nexus/bug-intake/route.ts`

```ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
```

Auth: copy the bearer-or-session pattern verbatim from `src/app/api/daily-quests/ingest/route.ts` — new env var **`PULSE_API_KEY`**, falling back to `AUTOMATIONS_API_KEY` (precedent: `WEBHOOK_TOKEN ?? AUTOMATIONS_API_KEY`). Do **not** top-level-import `@/lib/auth`; use the lazy `await import('@/lib/auth')` inside try/catch, as the existing M2M routes do.

Request (zod):
```ts
{
  requestId: string().uuid(),          // Pulse requests.id — idempotency key
  title: string().min(1).max(250),
  description: string().max(20_000).optional(),
  priority: enum(['low','medium','high']),
  requesterName: string().max(120).nullable().optional(),
  submitterClientFacing: boolean().optional(),   // D2 override; absent = trust AI
  attachmentCount: number().int().min(0).max(5).optional(),
}
```

Response:
```ts
{
  ok: true,
  jiraKey: string, jiraUrl: string,
  clientFacing: boolean,
  classification: { aiVerdict: boolean; confidence: number; reasoning: string;
                    overridden: boolean; affectedAreas: string[] },
  disposition: 'held_for_review' | 'auto_completed'
}
```

Handler flow:
1. **Idempotency first.** `db.ticket.findFirst({ where: { pulseRequestId } })` → if present, return the stored result with `200`. Pulse's client can retry; a double-file would create duplicate Jira tickets.
2. `classifyBug(...)` → `aiVerdict`.
3. `clientFacing = submitterClientFacing ?? aiVerdict.clientFacing` (submitter wins).
4. `createIssue({ summary: title, description: composed, issueTypeName: 'Bug', labels, priority })`.
   - `composed` description stamps provenance in the style of `composeTicketDescription` in `src/lib/email-intake.ts`: requester, priority, source `Pulse request <id>`, **`Client-facing: Yes|No`**, the AI reasoning, and whether the submitter overrode.
   - `labels`: `['needs-spec', 'pulse-bug', clientFacing ? 'client-facing' : 'internal-only']`. `needs-spec` is mandatory in every Helm ticket-creation path and triggers the auto-spec writer.
5. `transitionIssue(key, '12')` → Nexus Drops. ⚠️ **`'Nexus Drops': '12'` is currently MISSING from `TRANSITION_IDS`** in `src/app/api/tickets/create/route.ts:29`. It must be added there **and** in the duplicate map at `src/lib/captain.ts:62` (which carries a "Keep in sync" comment). Verified live: transition `12` → status `10087`.
6. `moveIssueToBoard(key)` — non-fatal, pulls it out of the Kanban backlog.
7. If `clientFacing`, assign to Rachel (`accountId 5f7ba88d459d4200699631a5`) via `updateIssue`; otherwise leave unassigned for the Nexus Drops triage task to claim.
8. `db.ticket.upsert` + `db.ticketEvent.create({ kind: 'pulse.bug.created' })` + `audit({ action: 'ticket.create.pulse-bug' })`.
9. Return.

#### Schema: `prisma/migrations-manual/058_pulse_bug_intake.sql`

Next free number is **058** (057 is `057_arcade_sessions.sql`). Add to `Ticket`:

```sql
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS pulse_request_id UUID;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS client_facing BOOLEAN;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS classification JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS tickets_pulse_request_id_key
  ON tickets (pulse_request_id) WHERE pulse_request_id IS NOT NULL;
```

Mirror in `prisma/schema.prisma` — **required**, or `prisma db push` will try to drop the columns (see the `ManualMigration` comment at `schema.prisma:81`). The runner `src/lib/migrate.ts` applies it at boot and records the filename in `_manual_migrations`.

#### `src/proxy.ts`

Add a **narrow** exemption at line 25 — follow the `'/api/daily-quests/ingest'` precedent, not a broad tree:

```ts
|| pathname.startsWith('/api/nexus/bug-intake')
```

#### Env (Azure App Service, `app-helm-prod-ad7881`)

`PULSE_API_KEY` — a new random 32-byte hex. Per Helm's CLAUDE.md gotcha #12, set it as a **plain app setting**, not a Key Vault ref, so it takes effect on the next request rather than after a 24h cache. And per the critical deploy rule: **push first, wait for the deploy to finish, then set config** — never both at once.

---

### 6.2 Pulse — form, edge function, review surface

#### `supabase/functions/product-request-action/index.ts`

Replace the body of `action: "file_bug"`. It currently owns the Jira call; it becomes a thin proxy to Helm.

- New secrets: `HELM_BUG_INTAKE_URL` (`https://app-helm-prod-ad7881.azurewebsites.net/api/nexus/bug-intake`), `HELM_API_KEY`.
- Keep the existing CAS claim, but make the target status conditional:

```ts
const helmRes = await fetch(HELM_BUG_INTAKE_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${HELM_API_KEY}` },
  body: JSON.stringify({ requestId, title, description, priority, requesterName,
                         submitterClientFacing, attachmentCount }),
});
// clientFacing  -> stay 'pending'  (Rachel reviews it in the Requests widget)
// !clientFacing -> 'completed'     (unchanged from today)
```

- Persist `jira_issue_key` / `jira_issue_url` from Helm's response, and write the verdict into `details`:
  `details.client_facing`, `details.client_facing_source` (`'ai'|'submitter'`), `details.client_facing_reasoning`, `details.client_facing_confidence`.
- **Retain the existing rollback-to-pending on failure.** If Helm is unreachable, the request must stay `pending` and fall through to the normal reviewer email — the current code already does this and it is the reason nothing has ever been silently dropped. Do not weaken it.
- **Attachments.** Today `fileRequestToJira` downloads from the `request-attachments` bucket and multipart-uploads to Jira. Helm cannot reach that private bucket. Simplest correct answer: keep the attachment upload **in the edge function**, running after Helm returns the key. Pass `attachmentCount` to Helm so the ticket body can say "3 attachments follow."

#### `supabase/migrations/2026073000000_request_client_facing.sql`

No new columns — `client_facing` rides in `details` JSONB, consistent with how `category` was done in `20260717000001`. This migration only:

- extends `requests_sanitize_insert()` so a submitted row cannot arrive with a pre-filled `details.client_facing_source = 'ai'` (a submitter could otherwise forge a verdict). Strip any `client_facing*` keys except a plain boolean `client_facing` (the D2 override) on insert.
- extends `notify_request_recipients()` so the bell label for a client-facing bug reads **`client-impacting bug report`** rather than `product bug report`.
- adds `create index if not exists idx_requests_client_facing on requests ((details->>'client_facing')) where type = 'product';`

#### `src/features/requests/RequestsPage.tsx` — `ProductForm`

New component `ClientImpactPicker`, rendered only when `category === 'bug'`, between description and attachments:

1. On description blur (≥40 chars) or on submit, call a lightweight classify-preview. **Recommendation: classify on submit, not on blur** — a `grep_repo` round trip is ~10–40s, far too slow for a blur handler. Show a spinner in the submit button ("Checking client impact…"), then a confirmation step showing the verdict + reasoning with **Yes / No** buttons before the final file. One extra click, no dead air.
2. Copy must be plain, not jargon: *"Is this affecting clients right now?"* with the AI's one-line reasoning underneath and a "Change this" affordance.
3. Success toast branches: client-facing → *"Bug filed as MSD-XXX and flagged for Rachel's review."*; not → *"Bug filed to Jira (MSD-XXX)."*

#### `src/features/requests/RequestCard.tsx`

- Add a **Client-facing** badge beside the existing Bug/Enhancement badge (`bug` → rose, `enhancement` → sky). Use amber/red for client-facing so it reads as urgent at a glance in the widget.
- Show `details.client_facing_reasoning` in the detail dialog, attributed (`"Claude, high confidence"` / `"Set by Jordan Scherich"`).
- **Footer buttons.** A client-facing bug is `pending` **and** already has a `jira_issue_key`. Today that renders Approve/Deny, which is wrong — the ticket is already filed. Branch on `jira_issue_key`: render a single **"Reviewed — close"** button (sets `completed`, `decision_note: 'Reviewed by <name>; already filed as <key>'`). Keep Deny available so Rachel can mark a mis-filed bug — it should **not** re-file, and `fileRequestToJira` already early-returns when `jira_issue_key` is set, so this is safe by construction.

#### `supabase/functions/request-email-notify/index.ts`

Extend the `isFiledBug` branch that shipped today. Add to `detailRows`:

```ts
`<tr><td style="padding:2px 12px 2px 0;color:#666">Client-facing</td>` +
`<td><strong>${clientFacing ? 'Yes' : 'No'}</strong></td></tr>`
```

and immediately below the table, the reasoning line. Then branch the closing copy:

- **client-facing:** subject `⚠️ Client-impacting bug: <title>`; body says it's filed as `<key>` **and** is waiting in Pulse for Rachel's review; include the `Open in Pulse` button (the existing non-bug branch has it; today's bug branch deliberately omits links — for this case the link is correct because there *is* something for her to do).
- **not client-facing:** keep today's copy verbatim, plus the `Client-facing: No` row.

Also add the row to the enhancement/collateral branch? **No** — out of scope, and the concept only means something for bugs.

---

### 6.3 Jira

- Add label `client-facing` and `internal-only` to the MSD project (created implicitly on first use; no config needed).
- Confirm Rachel's board filter or a saved JQL surfaces `labels = "client-facing" AND status = "Nexus Drops"`.
- Optionally update the hourly Nexus Drops triage task (`NEXUS_DROPS_TRIAGE_HANDOFF.md`, §6 STEP 5) to **read** the `client-facing` label instead of re-deriving the judgment. That task currently spends a full repo investigation reaching a conclusion this endpoint will already have written onto the ticket. Worth doing, but as a follow-up ticket — not in this one.

---

## 7. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Classifier is wrong and marks a real client incident internal-only | Fail-safe default is `true` (§6.1). Submitter override. Confidence + reasoning in the email so Rachel can spot a bad call. Log every classification to `tickets.classification` for later audit. |
| R2 | Latency — a repo-grounded call is 10–40s; submit feels broken | `deadlineMs: 60_000` hard cap. Explicit two-step UI with a labelled spinner (§6.2). If the classifier times out, fail-safe to client-facing and file anyway — **never block the submission**. |
| R3 | Helm is down / Azure cold start | Existing rollback-to-`pending` path is retained. Request stays pending, normal reviewer email fires, Rachel sees it. Degrades to today's enhancement flow, which is safe. |
| R4 | Duplicate Jira tickets on retry | Unique index on `tickets.pulse_request_id`; step 1 of the handler returns the stored result. Pulse's CAS on `status='pending'` is a second guard. |
| R5 | Merge conflict with the Nexus revamp | Branch from `origin/main` (`6fd4e58`), which already contains the revamp. Do not branch from `Staging`. |
| R6 | Anthropic cost | ~1 call per bug. 11 bugs in 10 days. Negligible. |
| R7 | Rachel's Requests widget floods with client-facing bugs she must manually close | `preview_count` caps rows; the widget footer shows the true total. If it becomes noisy, tighten the classifier's threshold rather than re-hiding bugs. |
| R8 | `PULSE_API_KEY` leaks | Bearer compared with plain `===` (existing Helm convention, not constant-time). Acceptable for a service-to-service secret held only in Supabase secrets + Azure app settings; note it and don't put it in the repo. |

---

## 8. Test plan

**Unit (Helm, `npm test`)**
1. `coerceClassification` on: valid JSON, missing fields, `confidence` out of range, non-JSON text → never throws; malformed input yields the fail-safe `clientFacing: true`.
2. Submitter override beats AI verdict in both directions.
3. Label assembly always contains `needs-spec` and exactly one of `client-facing` / `internal-only`.

**Integration (Helm)**
4. `POST /api/nexus/bug-intake` with no auth → 401 (and confirm the proxy exemption returns JSON 401, not a 307 redirect to `/login` — this is the specific failure mode `/api/tickets/**` has today).
5. Same `requestId` twice → one Jira ticket, second call returns the first result.
6. Classifier throws → ticket still created, `clientFacing: true`.

**End-to-end on staging (`staging.crm.medcurity.com` + `medcurity-crm-staging` Supabase project `baekcgdyjedgxmejbytc`)**
7. Submit a clearly client-facing bug ("SRA report shows the wrong company name to the customer"). Expect: AI says yes → Jira ticket in Nexus Drops labelled `client-facing`, assigned to Rachel → Pulse row stays `pending` → appears in the Requests widget with the amber badge → email subject starts `⚠️ Client-impacting bug` and body contains `Client-facing: Yes`.
8. Submit a clearly internal bug ("the Nova admin action button is misaligned"). Expect: AI says no → ticket filed, unassigned, labelled `internal-only` → Pulse row `completed` → **not** in the widget → email contains `Client-facing: No`.
9. Override case: internal-looking text, submitter flips to Yes. Verify `details.client_facing_source = 'submitter'` and the email says so.
10. Point `HELM_BUG_INTAKE_URL` at a dead host. Verify the request stays `pending`, no Jira ticket, reviewer email still sends.
11. Enhancement + collateral + CRM submissions unchanged (regression — this is AC #7 on the ticket).
12. Attachments still land on the Jira ticket.

**Cleanup:** staging shares prod's Jira. Every test ticket creates a real MSD issue — exactly what happened with MSD-918 during the 7/17 Bug/Enhancement split. Prefix test summaries `TEST (Claude) — safe to delete` (the Nexus Drops triage task already skips those) and delete them afterwards.

---

## 9. Rollout

1. Branch `msd-957-client-impact-gating` off `origin/main` in **both** repos.
2. Helm first — it must exist before Pulse can call it. Push → wait for GH Actions (~2.5 min) → **then** set `PULSE_API_KEY` (never in the same moment as the push).
3. Apply migration `058` — it runs at boot via `src/lib/migrate.ts`, so it lands with the deploy.
4. Smoke-test the endpoint with `curl` before touching Pulse.
5. Pulse to staging: push branch → `npx supabase functions deploy product-request-action request-email-notify` (already in `.github/workflows/azure-static-web-apps-*.yml`) → apply the Pulse migration to `baekcgdyjedgxmejbytc`.
6. Run §8 end-to-end. Delete test Jira tickets.
7. **Stop.** Send Rachel the two sample emails and a link to staging. Hold for her sign-off — same gate Nathan used for the bug-email copy.
8. On approval, promote to prod, apply the Pulse migration to `igmwomnkbbsytihtvhbp`, and watch the next real bug end-to-end.
9. Update `docs/ledger/SHIPPED.md` (move from DOCKET) in the same commit — repo rule.
10. Post the result to MSD-634, the M1↔M2 coordination ticket.

---

## 10. Open questions — confirm with Rachel before building

1. **Does "gated" mean blocked, or reviewed?** This plan assumes reviewed (D3): the ticket is filed immediately and flagged, rather than held until she approves. The ticket's written AC says held. Her email says "gated… and have that decision in the email," which is ambiguous. **This is the one answer that changes the architecture** — get it explicitly.
2. **Where does she want to review them?** This plan puts client-facing bugs back into her Nexus Requests widget as `pending`. She could instead prefer to work entirely from the Jira `client-facing` label and keep Pulse clean.
3. **What does she consider client-facing?** The classifier prompt needs her definition, not mine. §6.1 proposes: reachable by a paying customer on `app.medcurity.com` / `training.medcurity.com` in normal use; SRA/BAA/Policies/Training/PhishRx/dashboard = yes by default; Nova and internal admin = no. Confirm.
4. **Does she want to close them herself?** A client-facing bug will sit `pending` in Pulse until someone clicks "Reviewed — close." SHIPPED.md shows at least three prior instances of requests being left pending for Nathan to close manually. If she won't close them, add an auto-close when the Jira ticket reaches `IN PROD`.

---

## Appendix A — file inventory

**Helm** — new: `src/lib/bug-classify.ts`, `src/app/api/nexus/bug-intake/route.ts`, `prisma/migrations-manual/058_pulse_bug_intake.sql`. Modified: `prisma/schema.prisma`, `src/proxy.ts`, `src/app/api/tickets/create/route.ts` (TRANSITION_IDS + `'Nexus Drops': '12'`), `src/lib/captain.ts` (same map).

**Pulse** — new: `supabase/migrations/2026073000000_request_client_facing.sql`. Modified: `supabase/functions/product-request-action/index.ts`, `supabase/functions/request-email-notify/index.ts`, `src/features/requests/RequestsPage.tsx`, `src/features/requests/RequestCard.tsx`, `src/features/requests/api.ts`, `src/types/crm.ts`.

**Medcurity (Laravel)** — none. See §1.1.

## Appendix B — verified reference values

| Thing | Value | How verified |
|---|---|---|
| Jira "Nexus Drops" transition | `12` | `getTransitionsForJiraIssue` on MSD-957, today |
| Jira "Nexus Drops" status id | `10087` | same |
| Rachel Kunkel Jira accountId | `5f7ba88d459d4200699631a5` | `NEXUS_DROPS_TRIAGE_HANDOFF.md` |
| Makena Jira accountId | `712020:b65beec3-8895-44eb-9937-74eea95ea53b` | Jira API |
| Pulse prod Supabase project | `igmwomnkbbsytihtvhbp` | `list_projects` |
| Pulse staging Supabase project | `baekcgdyjedgxmejbytc` | same |
| Pulse prod HEAD | `6fd4e58` (2026-07-30) | `git fetch` |
| Next Helm manual migration | `058_` | `ls prisma/migrations-manual/` |
| Rachel's email | `rachelk@medcurity.com` | Outlook thread |
