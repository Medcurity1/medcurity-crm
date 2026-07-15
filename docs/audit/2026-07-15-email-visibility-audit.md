# Email Visibility Audit — 2026-07-15

**Trigger:** Summer's request "emails are not showing up" (example: contact
Danyal Khattak, danyalkhattak1997@gmail.com, prod record
cb28f7e6-d910-483c-9966-28df9e8aa0d3 — account-less, "No activities yet").
Molly reported the same class repeatedly; the 2026-07-10 "trustworthiness
batch" (dce9b1f) fixed several matching bugs but reports continued.

**Method:** 5-dimension multi-agent audit of the entire pipeline (ingest →
matching → storage → display → operations → history), 51 raw findings,
deduplicated to the clusters below; action-driving claims adversarially
re-verified against current code. All file references are to the state at
commit 1fb6ae1.

---

## The root cause of the recurring reports

**Address→contact matching happens exactly once — at fetch time — and the
`last_sync_at` cursor guarantees a message is never re-examined.**
Unmatched messages are not stored anywhere. Therefore a contact that is
created / given a corrected or additional email / unarchived AFTER its
emails were synced shows an empty timeline forever, and every matching
improvement (including all of 2026-07-10's) only helps mail that arrives
AFTER the fix. This is why the reports kept coming back: each fix was
correct and none was retroactive.

The reported example fits exactly: a new, account-less contact whose email
history predates the contact record.

---

## Fixed in this batch (staging, commit references in ledger)

| # | Scenario (emails invisible when…) | Fix |
|---|---|---|
| 1 | Contact created after its emails were synced; email corrected/added later; contact unarchived | **Retroactive backfill queue**: triggers on contacts (insert / email change / unarchive) queue the address; every sync run drains up to 5 newest addresses — targeted provider search (Graph `$search=participants:` spanning ALL folders; Gmail query) over a 90-day window, run through the normal dedup-safe inserts. Poison entries retire after 3 attempts. |
| 2 | Contact assigned to an account after emails were logged (rows carry the OLD/null account_id; the contact panel ANDed account_id + contact_id) | Contact timeline now scopes by contact_id ONLY (ActivityTimeline). Plus a trigger fills NULL `activities.account_id` when an account-less contact gains an account, so the ACCOUNT timeline picks the history up too. |
| 3 | Stored contact email has stray whitespace (CSV/SF import) — exact-length ilike never matches | BEFORE trigger btrims contact email/email2/email3 on write + one-time data fix for contacts & leads + trimmed matcher keys. |
| 4 | Contact only on the BCC line | Both providers now fetch BCC (sender's copy carries it) and matching includes it. |
| 5 | Mail arrives during a long sync run (dead zone past the 2-min overlap) | Cursor now advances to the fetch-window END (fetch-start time / chunk boundary), never to completion time. |
| 6 | One oversized mailbox window (dead token healed, busy new connection) starves EVERY mailbox forever (SIGKILL before cursor advance; oldest-first ordering retries it first each tick) | Live catch-up windows are chunked to 7 days per run — the cursor walks forward tick by tick; each run is bounded. |
| 7 | Contact/lead lookup batch error silently dropped that batch's matches while the cursor advanced | Lookup errors now FAIL the connection's run (cursor untouched; next tick retries). |
| 8 | Gmail per-message fetch failure (429/5xx) silently skipped past the cursor | Retry once, then fail the run. (Note: no Gmail OAuth function is deployed today, so Gmail connections can't currently exist — this and the other Gmail fixes are future-proofing.) |
| 9 | A connection failing repeatedly burns sweep budget every 10 min | Hourly retry cooldown once past the 3-failure alert threshold (manual Sync Now bypasses). |
| 10 | `email_sync_scheduler_lock` singleton row missing → every sweep silently no-ops with a green 200 | Edge fn distinguishes "lock held" from "row missing", reseeds and proceeds; migration also reseeds. |
| 11 | Rep deactivated then reactivated → connections stayed off forever | Two-way cascade: reactivation re-enables connections the deactivation cascade turned off (never manually-disabled ones — new `deactivated_by_cascade` flag). |
| 12 | Account-less contact + `auto_link_opps` → pointless null-account opp lookup | Guarded (hygiene; was harmless but wasteful). |
| 13 | One dead mailbox connection (e.g. Azure AD user deleted from the directory — found LIVE on staging during verification) poisoned every backfill-queue drain attempt | Drain isolates failures per connection, skips connections past the 3-strike alert, and only retries a queue row when EVERY eligible mailbox failed. |

**Post-promote step (needs Nathan):** run the existing manual backfill
workflow (`sync-emails-backfill.yml`, 90 days) once on prod AFTER promoting —
that re-scans history with all the fixed matching (multi-account fan-out,
To/CC, trim, BCC) and heals the pre-2026-07-10 gaps that were never
re-fetched. Idempotent (dedup index).

## Verified-working (not bugs) — for support triage

- **Whole pipeline health:** pg_cron every 10 min on prod + GH Actions
  fallback + Sync Now button; 3-failure in-app alert to the mailbox owner.
- **Internal domains** (medcurity.com) are never logged — by design.
- **Wholly-internal emails** produce no activity — by design.
- **Initial connect backfills 30 days** — older history needs the manual
  backfill workflow. By design (gateway timeout), now documented.

## Known gaps deliberately NOT fixed in this batch (docket candidates)

1. **Incremental Outlook sync reads only Inbox + SentItems.** Mail auto-filed
   by rules into subfolders is missed by the 10-min sync (the deliberate
   /me/messages avoidance after the 2026-05-19 drafts incident). Partial
   mitigation shipped: the new per-address backfill search spans ALL folders,
   so new-contact backfills DO find rule-filed mail. Full fix = enumerate
   mailFolders and fetch each non-system folder; medium effort.
2. **`primary_only` config drops account-less contacts entirely** for that
   mailbox (they're structurally never primary). Per-user setting, default
   off — check who has it on before changing semantics. Consider a UI hint.
3. **pg_cron observability gap (prod):** cron.job_run_details records only the
   HTTP handoff, not the result; a stale pasted service key looks green while
   sync degrades to the throttled GH fallback (~100-min gaps) that keeps the
   watchdog's 2h threshold satisfied. Fix idea: status view joins pg_net
   response table; or watchdog checks max(email_sync_runs.started_at) gap
   instead. Small migration, needs prod-side verification.
4. **Token-refresh race:** 4 functions (sync-emails, calendar-sync,
   task-reminders, task-digest) refresh from the same connection row; a
   rotated refresh token can be clobbered under exact-timing collisions.
   Rare; the 2026-07-10 rotation-persistence fix reduced it. Needs a
   row-level advisory lock around refresh.
5. **Lead-matched emails are invisible to reps** (Leads module is admin-only
   now) and stranded if a contact is created manually instead of converting
   the lead. Largely moot once the leads-removal project lands; the new
   backfill queue covers the manual-contact case going forward (the contact
   trigger fires regardless of how the contact was created).
6. **Panel shows newest 50 activities** — busy accounts hide older email in
   the side panel (full list via "View All"). By design; revisit if reps
   complain.
7. **Migration-rerun trap:** re-running 20260710130000 on prod unschedules the
   hand-pasted cron job and cannot reinstall it (GUCs unset). Documented
   here; don't re-run it on prod without re-pasting the cron afterwards.

## The reported case (Danyal Khattak) — expected resolution

The contact was created on prod after its email history was synced (it
doesn't exist in the staging snapshot). On promote, ANY of these heal it:
the backfill queue trigger fires for newly created contacts going forward;
for THIS already-created contact, the one-time 90-day backfill run (or
re-saving the contact's email, or an admin `insert into email_backfill_queue
(address, reason) values ('danyalkhattak1997@gmail.com', 'manual')`) will
pull its history within one sync tick. Verify on prod data which mailbox(es)
actually hold the correspondence.
