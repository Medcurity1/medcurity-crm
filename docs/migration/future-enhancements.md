# Future enhancements (post-cutover backlog)

Things Brayden flagged as nice-to-have but NOT blockers for SF cutover.
Keep these out of Phase 1-9; revisit after cutover is stable.

## Email sync

### Auto-add thread participants with matching domain

**Idea.** When `sync-emails` processes an inbound/outbound email, it sometimes
sees participants who aren't CRM contacts yet but share the same email
domain as an existing contact on a known account.

Example:
- `tim@clinicfoo.com` is already a CRM contact on account "Clinic Foo"
- Email arrives with both `tim@clinicfoo.com` and `sara@clinicfoo.com` on it
- `sara` is not in the CRM

**Proposal.** Auto-create a `contacts` row for `sara` against account "Clinic
Foo" and log the email against her too.

**Why this is non-trivial.**
- The MSP problem: if the customer CCs `helpdesk@someotherdomain.com` (an
  external IT vendor), that email is NOT on Clinic Foo's domain, and we
  should NOT auto-add them. The domain match must be strict.
- Multiple accounts may share a domain (rare but possible, e.g. parent/
  subsidiary relationships). Auto-assignment to the wrong account is worse
  than not auto-adding.
- Names from email signatures can't be reliably extracted — we'd end up
  with contacts named just "Sara" with no last name.

**Suggested gating rules when we build it:**
1. Only auto-add if the email domain matches EXACTLY ONE existing account
   (via at least one existing contact).
2. Skip if the inbound address is on an internal blocklist (same list
   `sync-emails` already uses for `@medcurity.com`).
3. Mark the auto-added contact with a boolean like `auto_added_from_email`
   and surface it in the UI so reps can audit/clean up.
4. Optionally require a confirmation queue: drop candidates into a
   "suggested contacts" list that an admin approves before they land in
   `contacts` proper.

**Not implementing now** because the SF cutover doesn't depend on this, and
getting it wrong pollutes the contacts table with MSP / third-party vendor
rows that take manual cleanup.

### Per-contact opt-out from email logging

**Idea.** Some prospects explicitly ask "don't log our conversations."
Add `contacts.exclude_from_email_sync boolean` and respect it in
`sync-emails` before creating an activity.

### Sync settings UI

**Idea.** The `email_sync_connections.config` JSON has four flags
(`log_sent`, `log_received`, `primary_only`, `auto_link_opps`) but no UI
to toggle them. Currently only editable via SQL. Add a panel under
My Settings → My Email.

## Notifications

### Proactive reminders (renewals, hot leads, stale accounts)

**Idea.** Users shouldn't have to go hunt for tasks. The CRM should push
reminders:
- Renewal coming up in 30/60/90 days (already partially wired via
  `generate_renewal_reminder_tasks`, but currently in-app only)
- Hot lead that hasn't been touched in N days
- Account you own that hasn't had activity in N days

**Channels:** email (via Graph API since we already have Outlook tokens
per-user), in-app toast, optional SMS down the line.

**Dependency:** need a "notification preferences" table per user so they
can pick channels + cadence.

## AI-driven cleanup

### Contract-language renewal_type parser

**Context.** `Account.renewal_type` is unreliable in SF data. Ground truth
is whichever is true for a given customer:
1. The contract document says "auto-renew" (or similar)
2. The auto-renew toggle is set on the customer's Medcurity platform instance

**Idea.** Build an AI agent that:
- Ingests PDF contracts (uploaded per account, or pulled from a document
  store)
- Extracts renewal-related clauses (term length, auto-renew Y/N, notice
  window, price escalator)
- Writes findings back to `account.renewal_type` + supporting fields
- Flags low-confidence extractions for human review

**Not implementing now** — the `accounts.do_not_auto_renew` manual override
added in migration 20260417000001 is enough to suppress renewals on the
3-5 exceptions while humans figure it out case-by-case.
