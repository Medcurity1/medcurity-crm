# Requests → Header Popup — Relocation Plan

**Asked by:** Nathan, 2026-08-04. Team already alerted and on board ("green lighted to build").
**Status:** Plan for review. No code written yet.
**Goal:** Requests stops being a sidebar tab and becomes a polished popup you can open from anywhere in Pulse — one less tab, zero lost functionality.

---

## 1. What this is (plain English)

Today, submitting a request means leaving whatever you're doing and going to the Requests tab. After the change:

- A good-looking **Submit Request button sits in the top bar** on every page — between the search bar and Ask AI.
- Clicking it opens a **popup** with the same three request forms we have today (Collateral / Product / CRM), tightened up to fit a popup: scrollable, title folded into the popup header, refreshed look.
- You fill it out, submit, see the confirmation, close it — **without ever leaving the page you were on**.
- Links elsewhere in Pulse open the popup pre-set to the right form: Nexus's "Something missing?" opens it on the CRM tab; the future Collateral page's "Request new collateral" link opens it on the Collateral tab.
- The **Requests tab disappears from the left sidebar** — one tab fewer.

### The don't-downgrade guarantee

The current Requests page works well, so everything it does survives exactly as-is:

- All three forms with all their fields, priorities, and attachments (Collateral 5 MB, Product 25 MB, CRM 10 MB limits).
- The **bug fast-path** (Rachel's MSD-957 flow): bug reports still get the automatic client-impact check, the yes/no confirmation, and straight-to-Jira filing for client-facing bugs. Untouched.
- The "Request submitted" confirmation and "Submit another" flow.
- Admin side is unaffected: the requests inbox and routing editor already live in Admin Settings, not the Requests tab.

## 2. The new experience

**The button.** In the top bar: `[Search] [Submit Request] [Ask AI] [bell] [avatar]`. Styled to stand out just a little more than Ask AI (it's an invitation, not a utility) — pill shape with the MessageSquarePlus icon. On small screens it collapses to icon-only, same as Ask AI's label does.

**The popup.** A centered dialog (not a side sheet), sized around 560px wide, capped at ~85% of screen height with the body scrolling inside it:

- **Header band:** "Submit a request" + one-line subtitle, with the three form tabs as segmented pills (icons kept: Palette / Package / Wrench).
- **Body:** the existing form, compacted — two-column rows where fields are short (audience/format already are), same required-field marks.
- **Footer:** sticky, with the "From {name}" line on the left and the Submit button on the right, so the submit action never scrolls out of view.
- **Success state:** same green-check panel, plus Close.

**Refreshed look** (Nathan asked for the box to "take on its own look"): subtle gradient wash in the header band, slightly larger radius, and the tab pills — modern but consistent with Pulse's existing design tokens. No new design system; this is a glow-up, not a rebrand.

**Safety touch (small upgrade):** if you've typed something and hit Esc or click outside, ask "Discard this request?" instead of silently losing it. Today, navigating away from the tab loses your draft with no warning — the popup makes accidental dismissal easier, so this guard keeps it from being a downgrade.

## 3. Where the old entry points go

| Today | After |
|---|---|
| Sidebar "Requests" tab | Removed |
| `/requests` URL (bookmarks, muscle memory) | Redirects home and auto-opens the popup, honoring `?tab=` — old links keep working |
| Nexus Briefing "Something missing?" → navigates to `/requests?tab=crm` | Opens the popup on the CRM tab, no navigation |
| Future Collateral page link | Opens the popup on the Collateral tab (the popup API takes a starting tab, so this is a one-liner when that page exists) |

## 4. Technical map (for the build session)

Current shape (all in `src/features/requests/`): `RequestsPage.tsx` (813 lines) = PageHeader + 3 tabs, each rendering a self-contained form component (`CollateralForm`, `ProductForm` with the MSD-957 classifier two-step, `CrmForm`) + shared bits (`PrioritySelect`, `FromLine`, `AttachmentPicker`, `SubmittedPanel`). Deep-link via `?tab=collateral|product|crm`. `api.ts` handles submission/uploads/classification. Admin pieces (`RequestsInbox`, `RoutingEditor`) are imported only by `AdminSettings.tsx`.

Build steps:

1. **Extract** the forms + shared bits out of `RequestsPage.tsx` into `RequestForms.tsx` (pure move, no logic changes — the forms don't know they're on a page today, which is why this is safe).
2. **New `RequestDialog.tsx`**: shadcn Dialog wrapping the tabs + forms, `initialTab` prop, scroll-inside-body layout, sticky footer, dirty-close confirm. Submitted-state reset on close (fresh form next open, same as today's "Submit another").
3. **Provider**: `RequestDialogProvider` + `useRequestDialog()` exposing `open(tab?)` — mounted once in `AppLayout` next to the assistant state (same pattern as `setShowAssistant`, AppLayout.tsx:254). Dialog itself lazy-loads so the forms' code stays out of the initial bundle (it's lazy today via the route).
4. **Header button** in the top-bar cluster (AppLayout.tsx:248) between `<GlobalSearch />` and the Ask AI button.
5. **Rewire links**: Briefing.tsx "Something missing?" (line ~397) from `Link to="/requests?tab=crm"` to `open("crm")`.
6. **Retire the route**: replace the `/requests` route (App.tsx:145) with a tiny redirect component that reads `?tab=`, calls `open(tab)`, and navigates home; delete the sidebar entry (Sidebar.tsx:103); delete `RequestsPage.tsx`; check `sectionName` derivation in AppLayout for a `/requests` label entry.
7. **Optional, cheap:** `G then R` keyboard shortcut alongside Ask AI's `G then I`.

Watch-outs:

- **Mobile**: dialog must stay usable at 375px — single-column fallback, footer visible above the keyboard.
- **Classifier wait**: the bug check can take up to 15s (`classifyDraftBug`); the dialog must not be dismissible-by-accident mid-check (the dirty-close guard covers this).
- **Staging testing files real Jira tickets** (the Requests feature shares the production Jira board — see `pulse-requests-feature` memory). Test the Product/bug path with the routing trimmed or with an obviously-test title per the established convention.
- Uploads on submit are unchanged (`api.ts`), so storage/RLS is untouched — no schema or backend work in this build.

## 5. Acceptance checks

1. Every field, validation, and toast from today's three forms works identically inside the popup (side-by-side pass against the old page on staging before deleting it).
2. Bug fast-path end-to-end: classifier verdict renders, override works, client-facing bug files to Jira with attachments.
3. Popup opens from: header button (every page), Nexus "Something missing?" (lands on CRM tab), `/requests?tab=product` bookmark (redirect + auto-open).
4. Esc / outside-click with a dirty form asks before discarding; clean form closes instantly.
5. Sidebar has no Requests entry; nothing else in the app still links to `/requests` (grep clean).
6. Mobile pass at 375px.

## 6. Recommendations (decide at review, then build)

- **Button label:** "Submit Request" spelled out, icon-only on mobile. (Alternative "Request" is shorter but vaguer.)
- **Keep the `/requests` redirect** for at least a month — costs ~20 lines, saves every bookmark.
- **Ship the dirty-close guard** — it's the one place a popup is genuinely worse than a page, and it's small.
