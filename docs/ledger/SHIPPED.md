# SHIPPED — completed work

Newest first. One line per item: date shipped, who asked, what, where it landed (staging/prod + commit). Older history (pre-2026-07) lives in the session archives and PULSE-GAME-PLAN/PULSE-BACKLOG.md; this file is canonical from 2026-07-09 onward. Update in the same commit as the work — worktree/subagent sessions included.

## 2026-07

- 2026-07-08 · PROD (61495c1) · Rachel · Closed Won gate: account must have phone, billing address, FTE range, and a contact email before a deal can close; config in required_field_config entity opportunity_close; every close surface gated, transition-only, imports/automation exempt · 8a041fa
- 2026-07-08 · PROD (61495c1) · Jordan · Nexus: lead-source filter fixed (root cause: hardcoded 8-value list vs 13-value picklist — now data-driven), called-by filter (v_contact_callers), timezone filter (data-driven values; contacts via linked account), phone + last-touch widget columns; both /nexus and admin tab · 2e72211
- 2026-07-08 · PROD (61495c1) · Jordan · Accounts list: Primary Contact (linked) + Phone columns, Last Touch replaces Contract End; Rural Hospital industry display/filter fix (enum existed since May; frontend never picked it up) · 0e878b6
- 2026-07-08 · PROD (61495c1) · Molly + Summer · Opportunity FTE count/range autofill from the account (one-way, fills empty fields only) · 8a041fa
- 2026-07-08 · PROD (597f9cd) · Jordan Mayer · Editable unassigned accounts: required-fields "grandfather" rule — editing never blocks on fields that were already empty; create stays strict; clearing a filled required field still blocks; all four entities; friendlier toast labels; repo's first unit-test suite (vitest) · 07b65cf
- 2026-07-08 · PROD (597f9cd) · (follow-up chip) · Blank numeric inputs stay null instead of silently becoming 0 (made numeric required fields actually enforceable; also stopped saves backfilling 0 into blank columns) · 449464a
- 2026-07-07 · PROD (301939d) · Nathan · Performance batch: recharts/chrono out of first paint, React vendor chunk cached across deploys, App modulepreload, shared renewal-queue fetch, bounded My Tasks, gated notifications, 4 DB indexes, widget/HTML cache tuning · 528e9e7+869e55f
- 2026-07-07 · PROD (301939d) · (review chips) · Perf-batch polish (bell loading state, on-demand QuickTask chunk, renewal KPI errors surface) + renewal_queue view security_invoker (closed anon read of renewal data) · 81b5e31, 5b76673
- 2026-07-07 · PROD (301939d) · Jordan (Molly's widgets) · Nexus report-builder gap list + joined-column sort fixes · 96c6c5a5, 08fdc38, b8498bf
- 2026-07-07 · PROD (301939d) · Nathan + Summer · Four quick CRM fixes (weekly calls Monday-start, fireworks date, opp owner default, task checkboxes) + stale-chunk auto-recovery reload · 7faed52, 8d2caad
- 2026-07-07 · STAGING · Nathan · MeddySweeper: loss board fully revealed (shielded Meddys show under faded shields — fixed blank-tile bug), dismissible end screen with RESULTS chip · c63ac99 (to prod with 301939d)

## Earlier (see PULSE-GAME-PLAN/PULSE-BACKLOG.md for detail)

- 2026-06-26→29 · PROD · Summer batch: pipeline catch-all column, company-details cleanup, zip→timezone, Ctrl+Space quick task with predictive text, request + account attachments, Meddy prompt fixes
- 2026-06-24 · PROD · Bundle: opportunities inline-edit fixes, bot-army security/correctness fixes, reports landing phase 1, Campaigns builder (admin-only), renewal-type unrequired (Summer)
- 2026-06 · PROD · Playbook port (all phases), reports overhaul phase 1, task reminders redesign, account dedup upgrades, Partner Types (Rachel), Pipeline Runner v2
