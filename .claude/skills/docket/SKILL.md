---
name: docket
description: Audit, reconcile, or update docs/ledger/DOCKET.md — Pulse's cross-session work tracker. Use when the user asks what's on the docket, what's left, what to work on next, or to check/refresh/clean up the docket; and ALWAYS before reporting docket contents to the user, since stale lines have repeatedly caused wrong status reports.
---

# Docket audit

`docs/ledger/DOCKET.md` is the primary cross-session tracker for Pulse. Nathan does not maintain it — Claude does, and it has rotted before. On 2026-07-27 an audit found **10 items already done or moot**, some sitting for six weeks, including one blocked on an answer the requester had already given. Nathan's standing instruction: *"priority #1 is making sure the docket is 100% up to date."*

## The rule that matters most

**Never read a docket row aloud to the user as current without re-running its `Verify` recipe first.** Being written in the docket is not evidence it is still true.

## Modes

### 1. Audit (default — "check the docket", "is the docket current?")

For **every** row in sections A–F:

1. Run its `Verify` recipe (a grep, a file check, or a prod/staging REST query).
2. Classify:
   - **STILL OPEN** — evidence confirms the problem exists. Update `Checked` to today.
   - **RESOLVED** — the code/data shows it was fixed. Move the row to `SHIPPED.md` with what fixed it, and delete it here.
   - **MOOT** — the premise is gone (feature retired, requester left, symptom aged out). Delete with a one-line reason in the commit message.
   - **CHANGED SCOPE** — still open but the description is now wrong. Rewrite the row with today's evidence.
3. Report to the user: what changed, what stayed, with the evidence. Never just say "audited, all good."

Sections G (ideas) and H (watch) are parked by design — spot-check only.

### 2. Report ("what's on the docket?", "what's next?")

Run the audit first, then present. Group by section, one row per item, and lead with what's actionable now versus blocked on a person.

### 3. Add ("docket this", "add X to the docket")

Append a row to the right section with: status, date, requester, a self-contained detail, a `Verify` recipe, and today's `Checked` date. **A row without a Verify recipe is not done** — write one that would let a future session re-prove it cold.

### 4. Close ("that's shipped")

Move the row to `SHIPPED.md` in the **same commit as the work itself**. Never leave a tombstone line in the docket; SHIPPED is the history.

## Writing a good Verify recipe

It must re-prove the claim with no memory of this conversation. Good ones:

- `grep -n 'name: "first_name"' src/features/playbook/csv.ts` — proves the CSV bug is still present
- `grep -c 'virtual\|Virtuoso' src/features/renewals/RenewalsQueue.tsx` = 0 — proves it is still unvirtualized
- `accounts?fte_count=eq.250&archived_at=is.null` count — proves the blast radius

Bad ones: "check if it still happens", "ask Nathan", anything requiring context you won't have.

For live-data recipes, query through Nathan's authenticated browser tab (see the `pulse-browser-verification` memory) — build `apikey` from the deployed bundle and read the session token fresh per request, since it rotates.

## Traps learned the hard way

- **Bundled rows hide rot.** One item per row, always. The 7/27 audit found 10 dead sub-items buried in 3 bundled lines.
- **"Adjacent thing was fixed" ≠ "this was fixed."** The On-Site Fee's *pricing gaps* were fixed in June, which made the whole item feel done — but the boundary rule and the auto-add were untouched. Verify the specific claim.
- **Check whether a "blocked on X" row is actually blocked.** Molly had answered in June; the row sat six weeks anyway.
- **Symptoms can age out.** The campaigns over-count fixed itself when migration timestamps fell outside the 30-day window. Still worth deleting the row.
- **Don't track people's ordinary job tasks or Nathan's to-dos** — build work and decisions only.

## After any change

Commit `docs/ledger/DOCKET.md` (and `SHIPPED.md` when closing rows) and push to `Staging`. Never push to `main` without Nathan's explicit go for that specific change.
