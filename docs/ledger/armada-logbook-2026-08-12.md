# ARMADA logbook entry — 2026-08-12

**This file is a courier, not a record.** Paste the block below at the TOP of
`ARMADA/Pulse/LOGBOOK.md` on Nathan's machine
(`/Users/nathanagellatly/Desktop/AI - Work/Medcurity/ARMADA/Pulse/LOGBOOK.md`).
It was written from a Cowork session on Makena's machine, which cannot reach
that folder — hence the hand-off. Delete this file once it has landed.

---

## 2026-08-12 | Claude Code | A bug that was blocking a client got filed as "doesn't affect clients" — found out why, fixed it, shipped to prod

Done: A bug came in through Pulse this morning from Margaret — the drop-downs in
the IT section were broken for the Southland Neurologic account. It was recorded
as NOT affecting clients, which is wrong, so it skipped the fast lane to the dev
team and sat in the review queue instead. Rachel approved it about eighty minutes
later and it is now MSD-1023, so nothing was stuck for long.

The cause was not Margaret. The automatic check that reads our code and decides
"is a client affected" failed that morning — one attempt, about eleven seconds,
no answer. When that happens the form asks the person instead, and it was asking
with both answers equally blank, so a single click decided it. She picked "no".
Nothing anywhere recorded that the check had failed at all, which is why this
took a while to establish.

Five things were fixed and are now live in production:

1. The check tries twice instead of once. The failure it hit was a blip; a
   second attempt would very likely have cleared it. (Only one layer retries —
   a first draft had both sides retrying, which would have left someone
   staring at a spinner for over a minute.)
2. When the check does fail, the form still asks — but it starts on "yes,
   a client is affected", which is the safe answer, and says plainly that
   nothing will re-check a "no".
3. A failed check is now recorded and visible. Before, "nobody checked this"
   looked exactly like a confident "no" on Rachel's card and in her email.
   It now shows a red "Check failed" badge, and the email goes out high
   importance with "(check failed)" in the subject line.
4. Bugs approved through review now get the same Jira labels as the ones that
   skip review. They were getting none at all, which meant our automatic
   spec-writer never ran on them — MSD-1023 has a three-line description where
   the bugs that skipped review the same week got full specs.
5. On the Helm side, the check now logs every outcome. It previously logged
   nothing at all, which is the reason the morning was hard to reconstruct.

Everything went to staging first, was verified there, then promoted to
production (CRM commit afc65f9, Helm 5c29f7b, both CI runs green). Verified
against the production database and the deployed code directly, not just the
green checkmark.

Next: nothing outstanding on this. Worth deciding separately whether MSD-1023
should have its labels added by hand so the spec-writer picks it up — Makena
asked that no ticket be touched during this work, so it still has none.

Blocked: nothing.

Flags: 🚩 The database migration in this batch was applied to production on
Makena's go, not yours. Under Article II it is the kind of change you sign off
on, and it was written and held for you — then shipped when she said "full
deploy now". It is small and reversible: three function replacements that (a)
stop people forging the "was this checked" flag, (b) stop the 60-day auto-close
from cancelling bugs nobody verified, and (c) register the sweep with the job
watchdog and the admin panel. Flagging it so the exception is visible rather
than buried in a commit.

🚩 Second thing worth your eye: the 60-day auto-close has been telling people
"It was not affecting clients when it came in" since 7/31. On a bug whose check
failed, nothing ever established that. That sentence is now gone.
