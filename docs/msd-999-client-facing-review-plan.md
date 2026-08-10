# MSD-999 — Fast-path guardrails (implemented plan of record)

**Ticket:** [MSD-999](https://medcurity.atlassian.net/browse/MSD-999) · Requester: Rachel Kunkel · Assignee: Makena
**Direction settled 2026-08-10 (Rachel via Makena), superseding the 8/4 reading.** Rachel's original submission asked for client-facing bugs to go through review. After discussion the goal changed: **keep client-facing bugs going straight to dev for efficiency** — the review gate is NOT being built. What ships instead is a set of guardrails on the fast path. This also resolves ledger question A5 ("does 'gated' mean blocked, or reviewed?"): filed-and-flagged stands.

## What was wrong / what was asked

The MSD-957 pipeline (live in prod since 7/30) files client-facing bugs straight to Jira via Helm `/api/nexus/bug-intake` with no human gate. Rachel's own MSD-999 submission demonstrated the loophole: it was a **process request**, the classifier correctly said "not client-facing… describes no broken feature", she overrode to Yes, and a non-bug sailed past review into the dev queue. Separately (8/10 "Dashboard bug…" thread): tickets arrive unassigned, the straight-to-dev heads-up email is normal importance, and emails don't link to the ticket in Helm.

## The four changes (branch `msd-999-fast-path-guardrails` in BOTH repos)

### 1. Not-a-bug warning popup (helm + medcurity-crm)
- `helm/src/lib/bug-classify.ts`: the classifier now also answers **`looksLikeBug`** — whether the report describes a defect vs. a request/enhancement/process change. Fail-safe polarity: only an explicit `false` counts; missing/garbage/degraded/timed-out all coerce to `true` so a model hiccup never nags a real bug reporter. The prompt states the two calls are independent of `clientFacing`.
- `medcurity-crm/src/features/requests/bug-warning.ts`: pure predicate `shouldWarnNotABug(verdict, choosingClientFacing, alreadyBypassed)` (tested in `tests/bugWarningNotABug.test.ts`).
- `RequestForms.tsx` (ProductForm): choosing **"Yes, a client is affected right now"** when the classifier said not-a-bug opens an AlertDialog quoting the classifier's reasoning, stating in bold that **only time-sensitive bugs affecting a client right now should go straight to dev — everything else goes through the reviewer, even when a client is involved.** Buttons: "Send it through review (recommended)" (sets client-facing No → held pending for Rachel) or "It's a time-sensitive bug, send it straight to dev" (bypass). A submit-time backstop catches the pre-filled-Yes case. Bypass is per-verdict; editing the report resets it. When bypassed, `composeBugDescription` stamps the ticket: *"the automatic check read this as a request/enhancement… the submitter chose to send it straight to the dev team anyway."*
- Standing copy tightened (em-dash-free per house style): category blurb, the Yes-option hint ("Time-sensitive bugs only: goes straight to the dev team"), and the footer line.

### 2. Auto-assignment (both repos)
Rule: **every ticket that goes straight to dev → Makena; every reviewed filing → Rachel.**
- `helm/src/app/api/nexus/bug-intake/route.ts`: creates the Jira issue with `assigneeId` = `PULSE_BUG_ASSIGNEE_ID` env, default Makena (`712020:b65beec3-…`). Replaces the deliberately-unassigned design — anything triaging Nexus Drops by "oldest unassigned" must now filter by assignee instead.
- `medcurity-crm/supabase/functions/product-request-action/index.ts`: `createJiraIssue` accepts an assignee; the reviewer-approve path assigns Rachel (`JIRA_ASSIGNEE_REVIEWED` env, default `5f7ba88d…`), the Helm-unreachable direct-file fallback assigns Makena (`JIRA_ASSIGNEE_DEV` env).

### 3. High-importance emails (medcurity-crm)
`request-email-notify/index.ts`: the straight-to-dev ("Client-impacting bug: …") email is sent with Graph `importance: "high"`. Review emails stay normal — the high flag is the signal that something skipped review.

### 4. Helm ticket links in emails (medcurity-crm)
Same function: the ticket key in the filed-bug email links to **Helm** at `{HELM_APP_URL}/tickets?view=list&q=MSD-XXXX` (defaults to `https://app-helm-prod-ad7881.azurewebsites.net`; override via Supabase secret), plus a prominent "Open MSD-XXXX in Helm" button and a secondary "View in Jira" link. This is the only Pulse email that references a ticket (review emails predate any ticket).

## Known caveats / follow-ups

- **Helm accounts:** the email goes to Rachel + Nathan + Makena, but Helm's users table only has Makena + Joe. Rachel/Nathan clicking the Helm link will hit the login wall — add viewer accounts for them, or they use the Jira link.
- **Assignee IDs are env-overridable** but default-hardcoded so the behavior works without new secrets.
- **Your hourly Nexus Drops triage** (if it selects "oldest unassigned") needs its filter updated now that tickets arrive assigned to Makena.
- The stale-review sweep (60-day auto-close) still deliberately excludes client-facing bugs — unchanged.
- Deploy: helm → push branch, PR/merge to `main` (auto-deploys ~2.5 min). CRM → merge to `Staging` for staging CI, then prod promote per house rules; both changed edge functions redeploy via CI. Set the optional env overrides only if the defaults should differ.

## Repo-state incident (2026-08-10, for the record)

The Cowork sandbox cannot unlink files in these mounted repos, so the initial `git checkout -b … origin/main` half-applied: index/HEAD moved to main but ~60 working files kept old-branch content, and stale `.git/index.lock` files blocked further git writes from the sandbox. Verified no real WIP was present (every stray file was byte-identical to the old branch); repaired on the Mac via the m1-bridge (`.m1-msd999-repair-commit-2026-08-10.sh`): removed locks, force-reset the branch to origin/main, restored the preserved MSD-999 files, deleted the dead `RequestsPage.tsx` (superseded on main by `RequestForms.tsx`, where the popup now lives). Lesson: do branch switches for these repos via bridge scripts, not from the sandbox.
