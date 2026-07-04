# Pulse deep audit — 2026-07-03 (Fable fan-out, 76 agents)

Counts: **1 critical, 17 serious, 28 minor, 9 ideas**. 
Security/most findings were adversarially verified; some performance/correctness verifications were cut off when the Fable budget hit its limit (those are marked found-not-verified in practice — spot-check before fixing).

> **Triage note (Nathan, 2026-07-04):** the PandaDoc webhook "critical" and the sync-emails / outlook-calendar-sync auth-gate "serious" items are on integrations **not yet built/live** — deliberately deferred, NOT urgent. Harden the auth gates as part of *building* those features, not before. Everything else stands.


## CRITICAL

### [security] PandaDoc webhook signature check is a no-op — unauthenticated writes to contract/financial data
- **File:** `supabase/functions/pandadoc-sync/index.ts:72`
- verifyWebhookSignature() returns true on EVERY path: no header -> `return true` (line 78-79), match -> true, and mismatch -> `console.warn(...); return true` (line 88-90). The raw body param is named `_body` and is never HMAC-hashed; the promised HMAC-SHA256 is never implemented. The function is deployed with --no-verify-jwt (index.ts:12, README line 13), so the only gate is this always-true check
- **Fix:** Implement real HMAC-SHA256 verification in verifyWebhookSignature using the PandaDoc shared secret and the raw request body (use crypto.subtle.importKey + sign with the raw body, constant-time compare against the X-PandaDoc-Signature header


## SERIOUS

### [a11y] Collapsed sidebar: all nav links and icon buttons lose their accessible names; collapse toggle is never labeled
- **File:** `src/components/layout/Sidebar.tsx:232`
- When collapsed, NavLink content renders only the icon — the label span is conditionally omitted entirely ({!collapsed && ...}, lines 224-248) — so all ~17 nav links (Home, Meddy, Accounts, Contacts, Opportunities, Pipeline, ...) have empty accessible names. The Radix Tooltip wrapper only sets aria-describedby while open on hover/focus; it does not provide a name. Same for the icon-only Search (164
- **Fix:** In Sidebar.tsx: (1) always render the label span and apply className={cn(collapsed && "sr-only")} instead of omitting it (or add aria-label={item.label} to each NavLink/a when collapsed); (2) add aria-label="Search" to the collapsed Search 

### [a11y] Meddy chat: incoming visitor messages are never announced (no aria-live region)
- **File:** `src/features/meddy/ChatView.tsx:273`
- The message list container (line 273) and the "Visitor is typing" indicator (296-303) are plain divs; a repo-wide grep shows zero aria-live/role=status regions in feature code. Realtime messages arrive via react-query/supabase and are silently appended. Failure scenario: a screen-reader agent has taken over a live website chat; the customer replies, and the agent gets no announcement at all — the 
- **Fix:** In src/features/meddy/ChatView.tsx add role="log" aria-live="polite" aria-relevant="additions" to the message-list container at line 273 (or, to avoid re-announcing on refetch, render a visually-hidden aria-live="polite" region that mirrors

### [a11y] Meddy whisper mode (Visitor / Team only) conveys active state by color only — no aria-pressed
- **File:** `src/features/meddy/ChatView.tsx:310`
- The two mode buttons (lines 310-336) indicate which is active purely via background classes (bg-primary vs bg-muted, amber vs muted); there is no aria-pressed, no role=radiogroup, no text change. Failure scenario: a screen-reader (or low-vision) support agent toggles "Team only" to write an internal note about a customer, but cannot verify the mode took effect — both buttons announce identically a
- **Fix:** Add aria-pressed={!whisper} to the Visitor button and aria-pressed={whisper} to the Team only button (or convert the pair to role="radiogroup" with role="radio"/aria-checked). Additionally add a non-color textual cue tied to the composer wh

### [a11y] Meddy quick-replies button has no accessible name (title is on a wrapper span, not the button)
- **File:** `src/features/meddy/ChatView.tsx:387`
- The Zap icon button (lines 387-396) contains only an icon; the title attribute lives on the wrapping <span> (deliberately, for the disabled-hover tooltip), so the button's accessible name is empty — a screen reader announces just "button". Failure scenario: an SR support agent composing a reply tabs from the textarea and lands on an unnamed button next to Send; pressing it unexpectedly opens the q
- **Fix:** Add aria-label to the Button at line 388, dynamic to match the tooltip semantics: aria-label={whisper ? "Quick replies unavailable while Team only is on" : "Insert quick reply"} — or simply aria-label="Insert quick reply". Keep the span tit

### [a11y] Most Select/combobox fields in the core record forms have no accessible name (Label rendered without htmlFor/id)
- **File:** `src/features/opportunities/OpportunityForm.tsx:911`
- OpportunityForm has 50 <Label> usages but only 32 htmlFor; the unassociated ones are exactly the Radix Select / combobox fields, whose trigger button gets no id or aria-label: Account* (line 911 → AccountCombobox at 919), Primary Contact (929), Opportunity Owner (949), Assigned Assessor (965), Original Sales Rep (982), Business Type (1004), Stage (1029), Payment Frequency (1223), Lead Source* (134
- **Fix:** For each unassociated field, give the trigger an id and point the Label at it: <Label htmlFor="opp-stage">Stage</Label> + <SelectTrigger id="opp-stage"> (Radix forwards id to the trigger button, restoring both SR naming and label-click focu

### [a11y] Pipeline kanban is completely inoperable by keyboard (no KeyboardSensor, no Enter/Space activation)
- **File:** `src/features/opportunities/PipelineBoard.tsx:150`
- PipelineBoard registers only PointerSensor (lines 150-154) — no KeyboardSensor — while every other dnd surface in the app (NexusGrid.tsx:128-130, nexus/panels/PinnedRecordsPanel.tsx:140-142, picklists/PicklistsManager.tsx:115-117, layouts/LayoutEditor.tsx:191-193, reports/ReportBuilder.tsx:599-601, reports/TeamDashboard.tsx:1285-1290) adds KeyboardSensor + sortableKeyboardCoordinates. Compounding 
- **Fix:** In PipelineBoard.tsx add useSensor(KeyboardSensor) to the useSensors call (import from @dnd-kit/core; since the board uses free useDraggable/useDroppable rather than sortable, either accept the default arrow-key coordinateGetter or supply a

### [cleanup] Six more dead feature files with zero importers
- **File:** `src/features/forecasting/ForecastPage.tsx:1`
- Symbol grep across all of src finds zero references (import or JSX) to: src/features/forecasting/ForecastPage.tsx (382 lines, sole file in its dir), src/features/analytics/WinLossAnalysis.tsx (430 lines, sole file in its dir), src/features/admin/DashboardGoalsManager.tsx (571 lines — AdminSettings.tsx imports 20+ managers but not this one; goals are managed in TeamDashboard now), src/features/dash
- **Fix:** Delete src/features/forecasting/ForecastPage.tsx, src/features/analytics/WinLossAnalysis.tsx (both dirs go away), src/features/admin/DashboardGoalsManager.tsx, src/features/dashboard/DashboardOverview.tsx, src/features/requests/RequestWidge

### [cleanup] Dead reports-dashboards subtree (~2,600 lines, 7 files) unreachable since ReportsHub consolidation
- **File:** `src/features/reports/DashboardsTab.tsx:1`
- ReportsHub.tsx (VALID_TABS at line 19: only "standard", "team-dashboard", "reports") no longer renders a dashboards tab, and nothing else imports this subtree. Import graph verified: DashboardsTab.tsx (447 lines) is the ONLY importer of DashboardView.tsx (825 lines), which is the ONLY importer of widgets/BuiltinReportWidget.tsx (415), widgets/KpiWidget.tsx (194), widgets/SavedReportWidget.tsx (210
- **Fix:** Delete src/features/reports/DashboardsTab.tsx, DashboardView.tsx, ReportsDashboard.tsx, dashboards-api.ts, and the widgets/ directory (BuiltinReportWidget.tsx, KpiWidget.tsx, SavedReportWidget.tsx); remove the PipelineSummaryRow interface a

### [correctness] Calendar day search/type/sort controls are dead due to stale useMemo deps
- **File:** `src/features/activities/ActivityCalendar.tsx:205`
- selectedActivities useMemo (lines 177-205) filters by dayQuery, dayType, and daySort but its dependency array is only [activities, selectedDate]. Typing in the "Search this day..." input, switching the type dropdown (Calls/Emails/...), or changing the sort re-renders the component but the memo returns the cached, unfiltered list — the three right-pane controls visibly do nothing. A rep on a busy d
- **Fix:** In src/features/activities/ActivityCalendar.tsx line 205, change the useMemo dependency array from [activities, selectedDate] to [activities, selectedDate, dayQuery, dayType, daySort].

### [correctness] Calendar fetch window queries created_at/due_at but places rows by activity_date, so backdated/synced activities vanish from past months
- **File:** `src/features/activities/ActivityCalendar.tsx:67`
- useMonthActivities filters the fetch to a created_at/due_at window (lines 72-77, ±1 month cushion) but activityCalendarDate() (lines 90-96) places non-task rows by activity_date. Any activity whose activity_date is more than ~1 month away from its created_at — Salesforce-imported history, an initial Outlook email-sync backfill (sync-emails sets activity_date to the email's real date but created_at
- **Fix:** Include activity_date in the fetch window: add activity_date.gte.${fetchStart} / activity_date.lte.${fetchEnd} arms to the two existing .or() filters in useMonthActivities (ActivityCalendar.tsx:72-77). Cleaner alternative: range-filter on t

### [performance] Activity calendar fetches all users' activities with no limit and an OR window that matches far more than the visible month
- **File:** `src/features/activities/ActivityCalendar.tsx:53`
- useMonthActivities selects * plus five embedded relations (owner, account, opportunity, contact, lead) with no .limit() and no owner filter - the whole team's activities. The two .or() bounds ((created_at>=start OR due_at>=start) AND (created_at<=end OR due_at<=end)) admit any old row whose due_at falls after the window start (e.g. created 2023, due 2027), and cover a 3-month span (month +/- 1-mon
- **Fix:** Use the indexed effective_at column that migration 20260629000002_activities_effective_at.sql already added (coalesce(activity_date, created_at), with activities_effective_at_idx). Replace the two .or() calls with one exact overlap filter f

### [performance] Record activity timeline downloads every activity for the record, renders 25
- **File:** `src/features/activities/api.ts:13`
- useActivities has no .limit()/.range() - it fetches all activities for an account/contact/opportunity/lead with owner+contact embeds. ActivityTimeline (src/features/activities/ActivityTimeline.tsx:104) then slices to visibleLimit=25 client-side (line 151). A long-lived account with 3k logged emails/calls downloads 3k full rows (including large body text) on every detail-page visit just to show 25;
- **Fix:** In useActivities, add a server-side cap and paging: switch to useInfiniteQuery with .range(pageParam * PAGE_SIZE, (pageParam + 1) * PAGE_SIZE - 1) (PAGE_SIZE ~50, keeping the existing effective_at desc order), and have ActivityTimeline's "S

### [performance] Opportunities list totals fetch the entire filtered table client-side on every visit and every mutation
- **File:** `src/features/opportunities/api.ts:237`
- useOpportunitiesTotals pages through up to 100,000 amount rows (1000/request, lines 279-339) just to compute sum+count client-side. It runs on OpportunitiesList (OpportunitiesList.tsx:371) with the default no-filter view, so at 5k opps every visit to /opportunities fires 5+ sequential round trips downloading every opportunity amount. Worse, its query key ["opportunities","totals",filters] sits und
- **Fix:** Replace the client-side paging loop in useOpportunitiesTotals with one server-side aggregate round trip: either a security-respecting RPC (e.g. `create function opportunity_totals(...filters) returns table(total numeric, cnt bigint)` doing 

### [security] outlook-calendar-sync edge function has no auth gate — anon can force calendar writes/deletes on staff calendars
- **File:** `supabase/functions/outlook-calendar-sync/index.ts:334`
- serve() uses a service-role client and performs NO caller authentication (no JWT, no API key, no service-role bearer validation) and is deployed --no-verify-jwt (index.ts:16). An anonymous caller who knows the URL can POST `/outlook-calendar-sync/tasks/<uuid>` (path regex at lines 343-345) to force syncTask() on a specific task, which creates/updates and — for archived/completed tasks — DELETES th
- **Fix:** At the top of serve() (before parsing path/body), require the caller to present the service-role bearer that the cron/trigger already passes: read req.headers.get('Authorization') and reject with 401 unless it equals `Bearer ${Deno.env.get(

### [security] sync-emails edge function has no auth gate — anon can enumerate staff mailboxes and trigger syncs
- **File:** `supabase/functions/sync-emails/index.ts:955`
- serve() creates a service-role client (bypasses RLS) and performs NO authentication of the caller — no JWT check, no X-API-Key, and no validation of the service-role bearer that pg_cron sends (grep for `Bearer ${SERVICE_ROLE_KEY}`/isServiceRole returns 0 matches). It is deployed --no-verify-jwt (index.ts:7). Any anonymous internet client that knows the URL can POST `{mode:'list_connections'}` and 
- **Fix:** At the top of the serve() handler (before reading the body / creating the service-role client), authenticate the caller. Mirror playbook-ai's isServiceRole(auth) gate (playbook-ai/index.ts:59/66,351): read req.headers.get("Authorization") a

### [ux] Renewals queue shows "No upcoming renewals" empty state when the query errors
- **File:** `src/features/renewals/RenewalsQueue.tsx:1327`
- The Upcoming and Closed-Won tabs render only isLoading→skeleton then !upcomingFiltered?.length→EmptyState ("No upcoming renewals — No contracts match the current filters", line 1321-1334; same at ~1617). isError from useUpcomingRenewals/useClosedWonRenewals (lines 859-860) is never checked. On a transient network/RLS failure a rep sees an authoritative-looking 'zero renewals' page — for a revenue-
- **Fix:** In RenewalsQueue.tsx, destructure isError and refetch from both hooks (lines 859-860), e.g. `const { data: upcoming, isLoading: upcomingLoading, isError: upcomingError, refetch: refetchUpcoming } = useUpcomingRenewals();`, then add an error

### [ux] Reports dashboard renders $0 / 0 metrics when queries fail (no error state anywhere on page)
- **File:** `src/features/reports/ReportsDashboard.tsx:207`
- All 7 useQuery hooks (lines 163-169) ignore error state. On failure isLoading is false and the fallbacks kick in: totalPipeline ends in `?? 0`, "Total Closed Won ARR" renders formatCurrency(closedWonTotal ?? 0), "Upcoming Renewals" renders 0 (lines 207-212). A rep or exec who opens Reports during a flaky connection sees Open Pipeline $0 / 0 opportunities presented as real data. Same pattern in Tea
- **Fix:** In ReportsDashboard, also destructure isError/refetch/isFetching from the critical hooks (at minimum usePipelineSummary and useClosedWonTotal), and before the metrics grid render `if (summaryQuery.isError || cwQuery.isError) return <QueryEr


## MINOR

### [a11y] BulkActionBar clear-selection X button has no accessible name
- **File:** `src/components/BulkActionBar.tsx:76`
- The bar that appears whenever rows are selected on Accounts/Contacts/Opportunities/Leads lists ends with <Button variant="ghost" size="icon" onClick={onClear}> containing only an X icon — no aria-label, no title. Failure scenario: an SR user who has selected 12 contacts tabs past Archive/Delete Permanently and reaches an unnamed button; activating it silently clears their entire selection. Sitting
- **Fix:** In src/components/BulkActionBar.tsx line 76, add aria-label="Clear selection" to the ghost icon Button (optionally also aria-hidden="true" on the X icon).

### [a11y] Global search trigger becomes an unlabeled icon-only button on small screens
- **File:** `src/components/GlobalSearch.tsx:270`
- The top-bar trigger (270-280) hides its "Search..." text and the ⌘K kbd below the sm breakpoint (hidden sm:inline), leaving only the Search icon with no aria-label — on mobile it announces as "button". The mobile-collapsed Sidebar variant (Sidebar.tsx:164-175) has the same problem and additionally works by dispatching a synthetic ⌘K KeyboardEvent. Fix: add aria-label="Search" to the trigger button
- **Fix:** Add aria-label="Search" to the trigger <button> in src/components/GlobalSearch.tsx:270 and to the collapsed icon Button in src/components/layout/Sidebar.tsx:164 (visible text already names the expanded/desktop variants). Optionally add aria

### [a11y] Inline editing controls announce only the field value — no field name or edit affordance for SR/keyboard users
- **File:** `src/components/InlineEdit.tsx:188`
- InlineEdit's trigger (188-209) is a button whose accessible name is just the rendered value ("$12,000" or "—"), with no indication of which field it is or that it can be edited; the pencil affordance is opacity-0 and only revealed on group-hover (208) — keyboard focus never reveals it (no group-focus-visible). Once editing, the Input (162-175) has no label. The same pattern repeats in Opportunitie
- **Fix:** Add an optional label prop to InlineEdit: on the trigger button emit aria-label={`Edit ${label}: ${display}`} and on the Input/Textarea emit aria-label={label}; add group-focus-visible:opacity-100 to the Pencil (line 208). Pass the existing

### [a11y] SortableHeader exposes no sort state (no aria-sort) on any list table
- **File:** `src/components/SortableHeader.tsx:53`
- The header button (55-67) cycles asc → desc → cleared, but the state is conveyed only by which chevron icon renders; there is no aria-sort on the TableHead and no state text in the button's name. Used by AccountsList, ContactsList, OpportunitiesList, ActivitiesListPage, etc. Failure scenario: an SR user on /opportunities activates "Close Date" and hears nothing change; they cannot tell whether the
- **Fix:** In SortableHeader, compute the state and set it on the TableHead: aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : undefined} (line 54). Optionally also append a visually hidden state hint inside the button, e.g

### [a11y] Calendar previous/next month buttons are unlabeled; day cells named only by bare day number
- **File:** `src/features/activities/ActivityCalendar.tsx:231`
- The two month-navigation icon buttons (lines 231-247, ChevronLeft/ChevronRight only) have no aria-label, so they announce as "button" — an SR user on /calendar can't tell which direction each moves, and the month heading between them isn't programmatically associated. The day-cell buttons (278-308) get an accessible name of just the day number plus the raw count badge (e.g. "14 3"), with no month/
- **Fix:** Add aria-label="Previous month" / aria-label="Next month" to the two icon Buttons (lines 231-237 and 241-247), and aria-hidden="true" on the chevron icons. On each day-cell button (line 278), add aria-label={`${format(day, "MMMM d, yyyy")}$

### [a11y] Sub-3:1 contrast on 9-10px text in Meddy chat (timestamps at 70% opacity on primary blue, tiny badges)
- **File:** `src/features/meddy/ChatView.tsx:482`
- Visitor-bubble timestamps render text-[10px] opacity-70 as white-on-primary (hsl(215 97% 52%) ≈ #0a6bfa); 70% white blended over that blue yields roughly 3.2:1 — below the 4.5:1 requirement for 10px text. Similar tiny/low-contrast text: ConversationSidebar.tsx:310 (text-[10px] text-muted-foreground/70 page label — muted-foreground at 70% alpha on background ≈ 3.1:1) and the h-4 text-[9px] badges a
- **Fix:** ConversationSidebar.tsx:310 — change text-muted-foreground/70 to text-muted-foreground (goes 2.9:1 → 5.2:1, passes). ConversationSidebar.tsx:292 — change bg-red-500 to bg-red-600 (3.76:1 → 4.83:1). ChatView.tsx:482 (and the opacity-80 label

### [a11y] Meddy conversation list cards: Space key doesn't activate, nested role=button star, color-only unread indicator, no aria-expanded on sections
- **File:** `src/features/meddy/ConversationSidebar.tsx:262`
- ConversationCard (262-276) is role="button" tabIndex=0 but its onKeyDown handles only Enter — pressing Space (required for role=button) scrolls the list instead of opening the conversation. The Save star (329-353) is a role=button nested inside the card button (invalid nested interactive; its name comes only from title="Save"). The unread indicator (278-280) is a bare red dot with no text alternat
- **Fix:** In ConversationCard: add `if (e.key === " " || e.key === "Enter") { e.preventDefault(); onSelect(); }` to the card onKeyDown; add an sr-only "Unread" span (or aria-label) inside the unread dot at line 278; replace the star span with a real 

### [cleanup] Unused npm dependency: next-themes
- **File:** `package.json:28`
- next-themes is in dependencies but no file in src/, scripts/, or supabase/ imports it — theming is handled by the custom src/hooks/useTheme.ts (localStorage + .dark class), and even ui/sonner.tsx (the shadcn component that normally pulls next-themes) was rewritten without it. It ships install weight and dependabot noise for nothing; safe to remove. (papaparse looks unused in src/ too, but it IS us
- **Fix:** Run `npm uninstall next-themes` (removes the entry at package.json:27 and updates the lockfile). No code changes needed since nothing imports it.

### [cleanup] App.tsx comments claim ForecastPage/WinLossAnalysis are lazy-loaded in ReportsHub — they are not, and the legacy redirects target tabs that no longer exist
- **File:** `src/App.tsx:39`
- Comments at App.tsx:39-40 ('ForecastPage is now only reached via /reports?tab=forecasting and lazy-loaded inside ReportsHub') and :57-58 (same for WinLossAnalysis) are false: ReportsHub.tsx lazy-loads only ReportBuilder/StandardReports/TeamDashboard and VALID_TABS (ReportsHub.tsx:19-23) has no 'forecasting' or 'analytics'. Consequently the legacy redirects at App.tsx:166-173 (/forecasting → /repor
- **Fix:** Delete or correct the two stale comments at App.tsx:39-40 and 57-58, and point the legacy redirects at App.tsx:167-172 to plain /reports (or /reports?tab=team-dashboard) instead of nonexistent tabs. Also update the ReportsHub.tsx:41-45 docs

### [cleanup] GlobalSearch re-declares stageLabels and leadStatusLabels maps it could import from lib/formatters
- **File:** `src/components/GlobalSearch.tsx:65`
- GlobalSearch.tsx:65-77 duplicates the exact stageLabels map from src/lib/formatters.ts:54-69 (which exports stageLabel()), and GlobalSearch.tsx:79 duplicates the lead-status map behind formatters' leadStatusLabel() (formatters.ts:177). The file already imports formatCurrency and customerStatusLabel from @/lib/formatters (line 15). Concrete failure mode: when a stage or lead status is added/renamed
- **Fix:** In src/components/GlobalSearch.tsx, delete the local stageLabels (lines 65-77) and leadStatusLabels (lines 79-85) maps, add stageLabel and leadStatusLabel to the existing @/lib/formatters import on line 15, and replace {stageLabels[opp.stag

### [cleanup] useDebouncedValue hook duplicated verbatim in two components
- **File:** `src/features/accounts/AddPartnerDialog.tsx:22`
- AddPartnerDialog.tsx:22-29 and activities/TaskRecordPicker.tsx:30-37 contain byte-identical useDebouncedValue<T> implementations, and three more components (nexus/panels/PinnedRecordsPanel.tsx:122-124, GlobalSearch.tsx:108, leads/ConvertLeadDialog.tsx:186) roll their own inline setTimeout debounce. The repo already has a src/hooks/ directory (useDebouncedUrlState.ts lives there); moving useDebounc
- **Fix:** Create src/hooks/useDebouncedValue.ts exporting the existing generic hook verbatim; delete the local copies in AddPartnerDialog.tsx and TaskRecordPicker.tsx (and the now-stale promotion comment) and import from @/hooks/useDebouncedValue. Op

### [cleanup] Two competing useUsers() hooks with different query keys split the cache and double-fetch user_profiles
- **File:** `src/features/leads/api.ts:381`
- src/features/leads/api.ts:381 defines useUsers() with queryKey ["users"], and src/features/accounts/api.ts:376 defines useUsers(includeInactive=false) with queryKey ["users", {includeInactive}]. Both select * from user_profiles ordered by full_name. 14 files import the accounts version but RenewalsQueue.tsx:15 and RoutingEditor.tsx:13 import the leads version, so a rep opening Renewals after brows
- **Fix:** Delete useUsers() from src/features/leads/api.ts (lines ~381-394) and update its three importers to use the accounts version: change src/features/renewals/RenewalsQueue.tsx:15 and src/features/requests/RoutingEditor.tsx:13 to import { useUs

### [cleanup] RenewalsQueue duplicates a 20-line untyped (o: any) → RenewalRow mapping in two query hooks
- **File:** `src/features/renewals/RenewalsQueue.tsx:224`
- useUpcomingRenewals (RenewalsQueue.tsx:223-243) and useClosedWonRenewals (:270-291) run the same select string and contain field-for-field identical `.filter((o: any) => ...).map((o: any): RenewalRow => ({...}))` blocks. Because `o` is any, a typo'd or dropped column in one select (they must stay in sync manually today) compiles fine and surfaces as blank cells only in one of the two tabs at runti
- **Fix:** In RenewalsQueue.tsx, hoist the shared select string into a module-level constant (e.g. RENEWAL_SELECT) and extract a helper `toRenewalRow(o: OppWithAccountRow): RenewalRow` with a manually-defined OppWithAccountRow type (the untyped supaba

### [cleanup] CSV escape/download logic hand-rolled in 5 files despite an existing shared helper
- **File:** `src/features/renewals/RenewalsQueue.tsx:531`
- src/features/reports/standard/report-helpers.ts:9 already exports a shared downloadCsv() (used by all 11 standard reports), yet private re-implementations of the same escape+Blob+anchor-click dance exist in: renewals/RenewalsQueue.tsx:531 (csvEscape) + :538 (downloadCsv), lead-lists/LeadListsPage.tsx:1215 (csvEscape), admin/DataExport.tsx:65 (escapeCsvField) + :112 (downloadCsv), admin/SalesforceI
- **Fix:** Create src/lib/csv.ts exporting csvEscape(v: unknown) (quote when /[",\n\r]/ matches, or adopt the report-helpers quote-all-strings/bare-numbers policy) and downloadCsv(filename, csvOrRows) that includes DataExport's setTimeout-deferred URL

### [cleanup] TeamDashboard.tsx maps Supabase rows through eight (r: any)/(err: any) callbacks
- **File:** `src/features/reports/TeamDashboard.tsx:340`
- TeamDashboard.tsx (2,900 lines) has 8 untyped row callbacks — e.g. :340, :357, :376, :409-410, :1163-1167 map rows as (r: any) => ({ event_date: r.sql_date }) and :2879 catches onError: (err: any). Each select string names concrete columns, so declaring 3-4 tiny row interfaces ({ sql_date: string }, { mql_date: string }, etc.) is mechanical and would catch column renames at compile time; today ren
- **Fix:** For real compile-time rename detection: generate types (supabase gen types typescript) and type the client as createClient<Database>(...) in src/lib/supabase.ts — then .select("sql_date") against a renamed view column fails to compile. As a

### [cleanup] lib/branding.ts is mostly dead config, and its stageLabels list is stale (pre-Salesforce-rename stages)
- **File:** `src/lib/branding.ts:35`
- Only branding.companyName/productName/loginSubtitle are ever read (LoginPage.tsx:9,82; WelcomeWizard.tsx:2,135). The rest — lifecycleLabels, stageLabels, industry, primaryColor, showRenewals, showPipeline, currency, dateFormat, companyUrl, supportEmail, and the documented rebrand() workflow — has zero readers. Worse, stageLabels (branding.ts:35-42) still lists only the retired stages (lead/qualifi
- **Fix:** In src/lib/branding.ts, trim the branding object to the three consumed fields (companyName, productName, loginSubtitle), delete the phantom rebrand() doc comment and the unused BrandingConfig export, and remove or correct the "ONLY file you

### [cleanup] Four exported functions have zero callers anywhere
- **File:** `src/lib/notification-sounds.ts:308`
- Verified by repo-wide symbol grep (definition is the only occurrence): playNotifSoundByType (notification-sounds.ts:308), setClientErrorAppVersion (clientErrorLogger.ts:96 — meaning app_version is never populated in the telemetry rows the module writes), modKeyLabel (lib/platform.ts), and quickTaskShortcutKeys (lib/quick-task-shortcut.ts). Also src/components/ui/avatar.tsx is the only shadcn primi
- **Fix:** Delete src/components/ui/avatar.tsx and the four dead functions: playNotifSoundByType (notification-sounds.ts:308), modKeyLabel (platform.ts:30), quickTaskShortcutKeys (quick-task-shortcut.ts:65). For clientErrorLogger.ts, either delete set

### [correctness] Weekly team-dashboard snapshots live only in localStorage — deltas differ per machine and vanish on browser data clear
- **File:** `src/features/reports/dashboardSnapshots.ts:4`
- Week-over-week snapshots are stored under a localStorage key (lines 140-152). Goals were migrated to the DB precisely because localStorage wasn't shared (TeamDashboard.tsx:703-948 comments), but snapshots weren't: the office TV, a laptop, and a second browser each accumulate different snapshot histories, so "vs last week" deltas disagree between devices, and clearing site data wipes the history en
- **Fix:** Mirror the dashboard_goals pattern: add a dashboard_snapshots KV row (or table keyed by week_start) in Supabase, make writeSnapshot/deleteSnapshot/clearSnapshots write through via a react-query mutation, hydrate on mount from DB with a one-

### [security] Leftover public.test table is world-writable by any authenticated user
- **File:** `supabase/migrations/20260407000002_test_table.sql:12`
- The throwaway public.test table created in this migration was never dropped (no `drop table` migration exists) and ships with fully-open RLS: SELECT/INSERT/UPDATE/DELETE policies all `TO authenticated USING(true) WITH CHECK(true)` (lines 12-22). Every logged-in role, including the intentionally-write-locked read_only integration role and any deactivated user whose JWT is still valid (the policies 
- **Fix:** Add a new migration containing `drop table if exists public.test cascade;` (dropping the table also removes its four policies).

### [ux] Calendar's "Add Activity" button navigates to the Opportunities list instead of creating an activity
- **File:** `src/features/activities/ActivityCalendar.tsx:324`
- The right-pane header shows a "+ Add Activity" button that is just a Link to /opportunities (lines 324-329). A rep who clicks it expecting an activity form for the selected day lands on the opportunities list with no explanation. It should open the existing QuickTaskDialog / Log Activity dialog — ideally prefilled with the selected calendar date.
- **Fix:** In ActivityCalendar.tsx, mirror ActivitiesListPage.tsx:282-289: add `const [showAddTask, setShowAddTask] = useState(false)`, replace the Link-wrapped button (lines 324-329) with `<Button variant="outline" size="sm" onClick={() => setShowAdd

### [ux] Log Activity dialog silently discards typed notes on Escape or outside click
- **File:** `src/features/activities/ActivityForm.tsx:379`
- ActivityForm's Dialog passes onOpenChange straight through with no dirty check, and form.reset() runs on reopen (useEffect around lines 206-243), so a rep halfway through typing long meeting notes who hits Escape or clicks outside the dialog loses everything with no warning. QuickTaskDialog has the same behavior — handleClose() unconditionally reset()s all fields on any close (QuickTaskDialog.tsx:
- **Fix:** In ActivityForm, intercept close: onOpenChange={(next) => { if (!next && form.formState.isDirty && !window.confirm("Discard unsaved changes?")) return; onOpenChange(next); }} — or equivalently block via onInteractOutside/onEscapeKeyDown={e 

### [ux] Lead form is the only full-page record form without the unsaved-changes guard
- **File:** `src/features/leads/LeadForm.tsx:713`
- AccountForm.tsx:249, ContactForm.tsx:175 and OpportunityForm.tsx:276 all wire useUnsavedChanges(isDirty) so Cancel/back prompts "Discard unsaved changes?". LeadForm (routes /leads/new and /leads/:id/edit in App.tsx:124-126) has no such guard — its Cancel button is a bare navigate(-1) (line 713), and navigating away via sidebar/G-chord shortcuts drops a half-filled lead with no prompt. Inconsistent
- **Fix:** In LeadForm.tsx: destructure isDirty from formState at line 104 (formState: { errors, isSubmitting, isDirty }), add const { confirmIfDirty, disarm } = useUnsavedChanges(isDirty) (import from @/hooks/useUnsavedChanges), change the Cancel but

### [ux] Leads list shows "No imports found — Import a list to get started" on query error
- **File:** `src/features/leads/LeadsList.tsx:658`
- useLeads result is rendered as isLoading→skeleton else !leads?.length→EmptyState (lines 652-676) with no isError branch. A failed fetch shows the onboarding empty state with a "New Import" CTA, telling the user their lead lists don't exist. Sibling lists (AccountsList.tsx:371, ContactsList.tsx:381, OpportunitiesList.tsx:634) all handle isError with a retry — LeadsList is the odd one out.
- **Fix:** In src/features/leads/LeadsList.tsx, destructure `isError` and `refetch` from useLeads at line 218, then insert an `: isError ? (...)` branch between the isLoading skeleton and the `!leads?.length` empty-state check (line ~658), mirroring t

### [ux] Pipeline custom-view tabs overflow off-screen with no wrap or scroll
- **File:** `src/features/opportunities/PipelineBoard.tsx:432`
- The tab row (`<div className="flex items-center gap-1">` line 432) holds Sales + Renewals + one TabsTrigger per custom view plus the + button. TabsList is `inline-flex w-fit` (ui/tabs.tsx) so it never wraps, and unlike the kanban grid below (which gets overflow-x-auto at lines 204/227) the tab row has no scroll container. Once a team saves 3-4 custom pipeline views, tabs and the + button push past
- **Fix:** Add horizontal scrolling to the tab row: change line 432 to `<div className="flex items-center gap-1 overflow-x-auto">` (optionally with `scrollbar-thin`/`pb-1`), keeping the + button `shrink-0` as it already is. Alternatively pass `classNa

### [ux] Products status badges (Imported/Manual/Default/Archived) are dark-mode-unsafe pastels
- **File:** `src/features/products/ProductsPage.tsx:319`
- Badges use bg-blue-100 text-blue-700 / bg-amber-100 text-amber-700 / bg-rose-100 text-rose-700 with no dark: variants (ProductsPage.tsx:319, 323, 600, 1064; ProductDetail.tsx:187, 191). With the app's real dark mode (useTheme light/dark/system toggle in Preferences), these render as glaring pastel chips on the dark surface. The codebase convention exists — RequestCard.tsx:49-50 pairs each light cl
- **Fix:** Follow the RequestCard.tsx convention: append dark variants to each badge class, e.g. ProductsPage.tsx:319/600/1064 and ProductDetail.tsx:187 → "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"; :323/191 → "bg-amber-100 tex

### [ux] Pipeline-by-stage charts render every current stage the same gray — STAGE_COLORS only maps legacy stage keys
- **File:** `src/features/reports/ReportsDashboard.tsx:153`
- STAGE_COLORS (lines 153-160) keys are the legacy stages (lead, qualified, proposal, verbal_commit, closed_won, closed_lost), but per formatters.ts the live stages are details_analysis, demo, proposal_and_price_quote, proposal_conversation. Every active-stage bar in both "Pipeline by Stage" charts falls through to the `?? "#6b7280"` fallback (line 233), so the whole funnel is uniform gray and the c
- **Fix:** In src/features/reports/ReportsDashboard.tsx, add the four current SF stage keys to STAGE_COLORS, e.g. details_analysis: "#94a3b8", demo: "#3b82f6", proposal_and_price_quote: "#8b5cf6", proposal_conversation: "#f59e0b" (keeping closed_won/c

### [ux] Team dashboard snapshot delete/recapture use native window.confirm instead of the app ConfirmDialog
- **File:** `src/features/reports/TeamDashboard.tsx:3703`
- Deleting a weekly snapshot (line 3703) and "Recapture this week" (lines 3746-3752) pop browser-native window.confirm boxes, while every other destructive action in the app (bulk deletes, pipeline view delete, task delete) goes through the styled ConfirmDialog component — OpportunitiesList.tsx:333 even documents that convention. Same inconsistency in MultiProductPicker.tsx:367 where the no-price-fo
- **Fix:** In TeamDashboard.tsx's snapshot list component, import ConfirmDialog from "@/components/ConfirmDialog" and replace the two window.confirm calls with dialog state: e.g. `const [pendingDeleteWeek, setPendingDeleteWeek] = useState<string | nul

### [ux] Product request "Deny" is one click with no confirm and no undo
- **File:** `src/features/requests/RequestCard.tsx:355`
- In the request detail dialog, Deny fires deny.mutate immediately on click (lines 355-370) — no ConfirmDialog, no undo toast action (contrast: task-complete toasts offer Undo in HomePage.tsx:401-406). The Deny and Approve buttons sit adjacent in the footer; a mis-click permanently denies a teammate's product request (there's no un-deny path in the UI — only pending requests show actions, line 324+)
- **Fix:** Either (a) wrap the deny in a confirm step — reuse the app's ConfirmDialog/AlertDialog pattern around deny.mutate in RequestCard.tsx:357, or (b) add an Undo action to the "Request denied." toast (toast.success("Request denied.", { action: {


## IDEA

### [a11y] Sweep remaining unlabeled icon-only buttons on secondary screens
- **File:** `src/features/products/ProductsPage.tsx:378`
- Beyond the high-traffic findings above, a grep for size="icon" without aria-label surfaces ~40 more instances on secondary screens, most containing only an icon: ProductsPage.tsx:378,506,1079,1390; accounts/AccountAttachments.tsx:134,146 (download/delete per attachment); accounts/AccountContacts.tsx:166; accounts/AccountPartners.tsx:284; activities/ActivityTimeline.tsx:205,214 (edit/delete per act

### [cleanup] kpi-registry and nexus/metrics carry parallel copies of localISODate and the paginated opp-amount summer
- **File:** `src/features/nexus/metrics.ts:193`
- src/features/dashboard/kpi-registry.ts and src/features/nexus/metrics.ts each define localISODate() (kpi-registry.ts:97, metrics.ts:112) and a paginate-past-1000-rows amount aggregator: fetchAllOppAmounts (kpi-registry.ts:44-63) vs sumOppAmounts (metrics.ts:193-218) — the latter's docstring even says 'same guard as kpi-registry's fetchAllOppAmounts'. They differ subtly already: the nexus copy bake

### [enhancement] Two spreadsheet libraries shipped: xlsx and exceljs
- **File:** `package.json:36`
- The bundle carries both xlsx@0.18.5 (used only by admin/AuditLogViewer.tsx and reports/ReportBuilder.tsx for .xlsx export) and exceljs (used only by reports/standard/financialSaasMetricsExport.ts). Both do the same job here (write a workbook client-side); xlsx 0.18.5 is also the long-stale npm build of SheetJS with known advisories. Migrating the two xlsx call sites to exceljs (or vice versa) drop

### [enhancement] Enhancement: bulk stage change and bulk tagging in BulkActionBar
- **File:** `src/components/BulkActionBar.tsx`
- BulkActionBar currently exposes only onArchive/onDelete/onAssignOwner (see wiring at OpportunitiesList.tsx:784-791). Two everyday multi-record chores are missing: moving several opportunities to a new stage at once (e.g. sweep stale deals to Closed Lost after a quarter review — would also route through the existing loss-reason/closed-lost-guard flow), and applying/removing a tag across selected ac

### [enhancement] Enhancement: include activities/notes and products in Global Search
- **File:** `src/components/GlobalSearch.tsx:159`
- Cmd+K search queries accounts, contacts, opportunities and leads only (from() calls at lines 159/181/196/222). Reps frequently remember a phrase from a call note or need to jump to a product/SKU — neither is findable. Adding an activities section (subject/body ilike, linking to the parent record) and a products section would make Cmd+K the single jump point; the grouped-results UI already supports

### [enhancement] Enhancement: bulk actions on the Activities/Tasks list
- **File:** `src/features/activities/ActivitiesListPage.tsx:266`
- Accounts, Contacts, Opportunities and Leads lists all have row checkboxes + BulkActionBar (archive/delete/assign owner), but ActivitiesListPage has no selection at all. Reps who inherit a departed teammate's tasks or want to clear a page of stale to-dos must open each one. Reuse BulkActionBar with activity-appropriate actions: bulk complete, bulk reassign owner, bulk delete, bulk shift due date.

### [enhancement] Enhancement: owner / "My activities" filter on the Activity Calendar
- **File:** `src/features/activities/ActivityCalendar.tsx:155`
- useMonthActivities fetches every user's activities with no owner filter, so the month grid counts are the whole team's volume and a rep can't see just their own schedule. Every list page has an owner filter and Pipeline has a "My Deals" switch — add the same switch + owner Select here (the owner join is already fetched, line 70). Also consider color-coding day cells by type (call/meeting/task) sin

### [enhancement] Enhancement: export current filtered list view to CSV for reps
- **File:** `src/features/opportunities/OpportunitiesList.tsx:304`
- The only export in the app is admin-gated (src/features/admin/DataExport.tsx under Admin Settings). List pages already hold rich URL-backed filter state, column picker (useColumnPrefs) and sorted results — an "Export CSV" button that serializes the visible columns of the current filtered result would cover the constant 'can you pull me a list of…' asks without admin involvement. Applies equally to

### [performance] Estimated counts and 5s global staleTime make heavy list queries refetch on every navigation
- **File:** `src/lib/queryClient.ts:43`
- staleTime: 5000 applies to every query, including the expensive ones documented above (useAccountsList's up-to-20-request full fetch, useOpportunitiesTotals' full scan, nexus metric scans). Any navigation back to a mounted route after 5 seconds refetches them all even though this data changes rarely. Post-mutation invalidation is already thorough (317 invalidateQueries call sites), so raising stal
