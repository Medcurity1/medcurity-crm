# ARMADA logbook entry — 2026-08-12

**This file is a courier, not a record.** Paste the block below at the TOP of
`ARMADA/Pulse/LOGBOOK.md` on Nathan's machine
(`/Users/nathanagellatly/Desktop/AI - Work/Medcurity/ARMADA/Pulse/LOGBOOK.md`).
It was written from a Cowork session on Makena's machine, which cannot reach
that folder — hence the hand-off. Delete this file once it has landed.

---

## 2026-08-12 | Claude Code | A bug that was blocking a client got filed as "doesn't affect clients" — found out why, fixed the causes

Done: A bug came in through Pulse this morning from Margaret — the drop-downs in
the IT section were broken for the Southland Neurologic account. It was recorded
as NOT affecting clients, which is wrong, so it skipped the fast lane to the dev
team and sat in the review queue instead. Rachel approved it about eighty minutes
later and it is now MSD-1023, so nothing is stuck.

The cause was not Margaret. The automatic check that reads our code and decides
"is a client affected" failed that morning — one attempt, about eleven seconds,
no answer. When that happens the form asks the person instead, and it was asking
with both answers equally blank, so a single click decided it. She picked "no".
Nothing anywhere recorded that the check had failed at all, which is why this
took a while to establish.

Five things were fixed, all written but NOT yet live anywhere:

1. The check now tries twice instead of once, on both sides of the call. The
   failure it hit was a blip; a second attempt would very likely have cleared it.
2. When the check does fail, the form still asks — but it now starts on "yes,
   a client is affected", which is the safe answer, and says plainly that
   nothing will re-check a "no".
3. A failed check is now recorded and visible. Before, "nobody checked this"
   looked exactly like a confident "no" on Rachel's card and in her email.
   It now shows a red "Check failed" badge, and the email goes out high
   importance saying so.
4. Bugs approved through review now get the same Jira labels as the ones that
   skip review. They were getting none at all, which meant our automatic
   spec-writer never ran on them — MSD-1023 has a three-line description where
   the bugs that skipped review the same week got full specs.
5. On the Helm side, the check now logs every outcome. It previously logged
   nothing at all, which is the reason the morning was hard to reconstruct.

Next: Makena reviews the changes, then they go to staging and prod the usual way.
The one piece that needs your sign-off before it can be applied is a small
database migration (docket A15) — it stops people forging the "was this checked"
flag, and stops the 60-day auto-close from cancelling bugs nobody ever verified
with a note claiming they didn't affect clients.

Blocked: Nothing is blocked. The migration is waiting on your go, by design.

Flags: 🚩 The 60-day auto-close currently closes un-triaged bugs with the line
"It was not affecting clients when it came in." On a bug whose check failed,
nothing ever established that. The migration removes the claim — worth knowing
it has been going out unchallenged since 7/31.
