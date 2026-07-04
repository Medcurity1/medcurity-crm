# Pulse improvement backlog — 2026-07-04 (hunt: 20 agents)

Counts: {'critical': 3, 'high': 13, 'medium': 25, 'low': 24, 'ideas': 7}. Excludes items the hunt marked already-FIXED/VERIFIED.


## CRITICAL

### [security/M] outlook-calendar-sync edge function lacks auth gate
- `supabase/functions/outlook-calendar-sync/index.ts:334`
- serve() creates a service-role client (line 336-339) with no caller authentication whatsoever. The --no-verify-jwt deployment (line 16) means an anonymous internet caller who knows the URL can POST /outlook-calendar-sync/tasks/<uuid> to force syncTask() on arbitrary task UUIDs, creating, updating, or deleting calendar events on any staff member's Outlook calendar without authorization. The path regex at lines 343-345
- Fix: Prioritize: (1) drop public.test table in new migration (security) (2) add Bearer auth gates to sync-emails / outlook-calendar-sync per audit recommendations (3) fix ActivityCalendar useMemo deps [activities, selectedDate] → [activities, se

### [security/M] sync-emails edge function lacks auth gate
- `supabase/functions/sync-emails/index.ts:955`
- serve() creates a service-role client (line 964-968) with zero authentication of the caller. The --no-verify-jwt deployment (line 7) means any anonymous caller can POST {mode:'list_connections'} to enumerate all staff mailbox connection IDs, or POST {mode:'backfill_chunk'} to force email syncs for arbitrary connection_id / date windows, bypassing RLS entirely. No JWT check, no API key validation, and no service-role 
- Fix: START: Security fixes for sync-emails and outlook-calendar-sync are most urgent — implement isServiceRole(req.headers.get('Authorization')) gate at top of serve() before body/path parsing in both functions. PandaDoc requires HMAC-SHA256 imp

### [security/M] PandaDoc webhook signature verification is a no-op
- `supabase/functions/pandadoc-sync/index.ts:71-91`
- verifyWebhookSignature() returns true on every path: (1) no X-PandaDoc-Signature header → console.warn + return true (line 78-79); (2) signature mismatch → console.warn + return true (line 89-90). The _body parameter is never HMAC-hashed. This allows unauthenticated callers to POST fake PandaDoc webhook events, creating/updating/deleting contract records and writing to opportunities + activities tables via the servic
- Fix: 
**PandaDoc webhook:** Replace verifyWebhookSignature() with real HMAC-SHA256 verification:
1. Import crypto from Deno
2. Use crypto.subtle.importKey() with HMAC algorithm and the PANDADOC_API_KEY as the secret key
3. Use crypto.subtle.sign


## HIGH

### [security/M] public.test table is world-writable and never cleaned up
- `supabase/migrations/20260407000002_test_table.sql:12-22`
- public.test table has fully-open RLS: all four policies (SELECT/INSERT/UPDATE/DELETE) use TO authenticated USING(true) WITH CHECK(true). Any logged-in user (including deactivated users whose JWTs are still valid, and intentionally write-locked read_only integration role) can read and mutate all rows. The table was never dropped; no cleanup migration exists. FIX: Add a new migration: drop table if exists public.test c
- Fix: Priority fixes: (1) Create new migration: drop table if exists public.test cascade; (2) Implement HMAC-SHA256 verification in pandadoc-sync verifyWebhookSignature using crypto.subtle with constant-time comparison; (3) Add auth gate to sync-

### [correctness/M] Calendar search/type/sort filters don't work (stale useMemo deps)
- `src/features/activities/ActivityCalendar.tsx:205`
- The selectedActivities useMemo (lines 177-205) filters by dayQuery, dayType, and daySort (lines 181-203) but the dependency array at line 205 is [activities, selectedDate] — missing the three filter state variables. This causes the filter/search/sort controls in the right pane to visibly do nothing: typing in 'Search this day...', toggling the activity type dropdown, or changing the sort renders the component but ret

### [correctness/M] Timezone bug: 'days until close' column shows wrong values in negative-offset timezones
- `src/features/renewals/RenewalsQueue.tsx:403,457`
- The dateValue() function at line 403 uses `new Date(dateStr)` which parses date-only strings ('2026-07-04') as UTC midnight. But in sortUpcoming() line 426, `today` is set to local midnight via `today.setHours(0,0,0,0)`. When the 'days' column is computed (line 454-459), it subtracts UTC midnight from local midnight, resulting in off-by-one-day errors in negative-offset timezones (e.g. Pacific, Mountain). The code al

### [correctness/M] Calendar fetch window misses backdated activities placed by activity_date
- `src/features/activities/ActivityCalendar.tsx:72-77`
- useMonthActivities filters the fetch to created_at/due_at windows (lines 72-77) but activityCalendarDate() (lines 90-96) places rows by activity_date. Any activity whose activity_date is more than ~1 month away from created_at (Salesforce-imported history, Outlook sync backfill with real email dates) falls outside the fetch window and silently vanishes from the calendar. The fix: include activity_date in the fetch wi

### [performance/M] CONFIRMED UNFIXED: Opportunities totals fetch entire filtered table client-side
- `src/features/opportunities/api.ts:237-339`
- useOpportunitiesTotals pages through up to 100k rows (1000/request, lines 279-339) downloading every opportunity amount to compute sum+count client-side. At 5k opps this fires 5+ sequential round trips. Fix: Replace with a single server-side aggregate RPC that respects RLS, e.g. `create function opportunity_totals(...filters) returns table(total numeric, cnt bigint)`.

### [performance/M] Unbounded query fetches ALL closed-won opportunities client-side just to sum amounts
- `src/features/reports/ReportsDashboard.tsx:34-46`
- useClosedWonTotal (ReportsDashboard.tsx:34-46) fetches all opportunities where stage='closed_won' with no limit, then sums them in JavaScript (line 44). At 5k+ closed deals this is 5k+ rows on every dashboard page load or refresh. Should use a database aggregate function instead: SELECT coalesce(sum(amount), 0) FROM opportunities WHERE stage='closed_won' AND archived_at IS NULL

### [performance/M] Unbounded query fetches ALL closed-won opportunities for average deal size calculation
- `src/features/reports/ReportsDashboard.tsx:89-103`
- useAverageDealSize (ReportsDashboard.tsx:89-103) fetches all closed_won amounts then calculates mean client-side (line 101). Use a database aggregate instead: SELECT coalesce(avg(amount::numeric), 0) FROM opportunities WHERE stage='closed_won' AND archived_at IS NULL

### [performance/M] Unbounded query for top accounts by revenue fetches all closed-won opportunities
- `src/features/reports/ReportsDashboard.tsx:106-131`
- useTopAccountsByRevenue (ReportsDashboard.tsx:106-131) fetches ALL opportunities where stage='closed_won' with full account embed, then groups and sorts client-side (lines 117-129). At scale, 5k+ rows. Use database aggregation: SELECT account_id, SUM(amount) as total FROM opportunities WHERE stage='closed_won' AND archived_at IS NULL GROUP BY account_id ORDER BY total DESC LIMIT 5

### [performance/M] Activity timeline fetches unbounded activities and client-side-limits to 25 rows
- `src/features/activities/api.ts:13-51`
- useActivities (api.ts:13-51) has no .limit()/.range() - it downloads ALL activities for a record (account/contact/opportunity/lead) with two relation embeds. ActivityTimeline (ActivityTimeline.tsx:104-109) then slices to visibleLimit=25 client-side (line 151). A long-lived account with 3k logged emails downloads 3k full rows on every detail-page visit. Fix: switch useActivities to use .range(0, 49) and wrap ActivityT

### [performance/M] Activity Calendar fetches all team members' activities with no owner filter or limit
- `src/features/activities/ActivityCalendar.tsx:53-81`
- useMonthActivities (ActivityCalendar.tsx:53-81) fetches activities with no .limit() and no owner_user_id filter - downloads the whole team's activities. The two .or() bounds (lines 72-77) are also overly broad: '(created_at>=start OR due_at>=start) AND (created_at<=end OR due_at<=end)' admits any old task whose due_at is in the future, not just the visible month. Fix: (1) add owner_user_id filter or 'my activities' o

### [performance/M] Opportunities totals query pages through up to 100,000 rows client-side to compute sums
- `src/features/opportunities/api.ts:237-343`
- useOpportunitiesTotals (opportunities/api.ts:237-343) pages through 1000-row chunks in a while loop (lines 282-339) just to compute sum+count client-side. On the no-filter view at 5k opps, fires 5+ sequential round-trips. Worse, the query key includes full filters but is never specific-keyed, so every page navigation refetches. Fix: Replace the paging loop with a single RPC call like 'SELECT count(*), coalesce(sum(am

### [design/M] Products status badges (Imported/Manual/Default/Archived) lack dark-mode color variants — already noted in audit as serious issue
- `/src/features/products/ProductsPage.tsx:319, 323, 600, 1064; /src/features/products/ProductDetail.tsx:187, 191`
- ALREADY IN AUDIT (audit.md:227-230). Status badges use bare pastel colors (bg-blue-100 text-blue-700, etc.) with no dark: variants. In dark mode they render as washed-out pastels on dark surfaces. Fix is documented: pair each light class with a dark variant, e.g. 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300' per RequestCard.tsx convention. This is a high-severity visual break in dark mode.

### [bug/M] All 6 widget types ignore query errors — show empty state instead of error
- `src/features/nexus/widgets/TasksWidget.tsx:142, PipelineWidget.tsx:49, CustomReportWidget.tsx:35, MetricsWidget.tsx:94, PinnedRecordsWidget.tsx:41, RequestsWidget.tsx:39`
- None of the widget body components (TasksWidget, PipelineWidget, CustomReportWidget, MetricsWidget, PinnedRecordsWidget, RequestsWidget) destructure or check the `isError` flag from their useQuery/useInfiniteQuery hooks. When a query fails (network error, RLS denial, etc.), the hook sets isError=true but isLoading=false. The widget then falls through to the empty state ("No tasks due today", "No open opportunities", 
- Fix: In each widget file, add `isError` and `refetch` to the query hook destructure. Insert an error branch before the empty-state check, e.g. `isError ? (<QueryError message="Couldn't load..." onRetry={() => refetch()} />) : !data?.length ? (..


## MEDIUM

### [correctness/M] Add Activity button navigates to Opportunities instead of opening activity creation dialog
- `src/features/activities/ActivityCalendar.tsx:324-329`
- The right-pane header's '+ Add Activity' button (lines 324-329) is a bare Link to /opportunities. A rep who clicks it lands on the opportunities list, not an activity form. Should open QuickTaskDialog or ActivityForm prefilled with the selected calendar date, like ActivitiesListPage does (ActivitiesListPage.tsx:282-289).

### [correctness/M] RenewalsQueue missing error state checks show empty list as 'No renewals' on query failure
- `src/features/renewals/RenewalsQueue.tsx:859-860,1327`
- The useUpcomingRenewals and useClosedWonRenewals hooks (lines 859-860) destructure only data and isLoading, not isError. The render (line 1327) checks only isLoading→skeleton else !upcomingFiltered?.length→EmptyState, with no error branch. On a network/RLS failure, a rep sees 'No upcoming renewals — No contracts match filters' instead of an error message, making it appear the business has zero renewals.

### [correctness/M] LeadsList missing error state check shows onboarding empty state on query failure
- `src/features/leads/LeadsList.tsx:218,658-675`
- useLeads (line 218) destructures only data and isLoading, not isError. The render (line 652-675) checks only isLoading→skeleton else !leads?.length→EmptyState('Import a list to get started'), with no error branch. On a failed fetch, a rep sees the onboarding CTA with 'Import a list' instead of an error state, making it appear their lead lists don't exist rather than the query failed. Sibling lists (AccountsList, Cont

### [correctness/M] ReportsDashboard renders $0 metrics on query failure with no error state
- `src/features/reports/ReportsDashboard.tsx:163-169,196-212`
- The seven useQuery hooks (lines 163-169) ignore isError. The render (line 196-206) checks only isLoading→skeleton else display metrics. On failure, all hooks return undefined data and isLoading=false, so the ?? fallbacks trigger and display $0 / 0 'Open Pipeline', 'Total Closed Won ARR', 'Upcoming Renewals' presented as real numbers. A rep or exec viewing reports during a flaky connection sees authoritative-looking z

### [performance/M] CONFIRMED UNFIXED: StaleTime 5s causes expensive list queries to refetch on every navigation
- `src/lib/queryClient.ts:43`
- The global staleTime: 5000 applies to all queries including expensive full-table scans (useAccountsList up to 20 requests, useOpportunitiesTotals full 5k opp scan, nexus metrics). Any navigation back after 5 seconds refetches even though this data changes rarely. Post-mutation invalidation is thorough, so raising staleTime to 30-60s would avoid unnecessary downloads without stale-data issues.

### [ux/M] ReportsDashboard queries have no error state - render $0/0 when queries fail
- `src/features/reports/ReportsDashboard.tsx:162-212`
- All 7 useQuery hooks in ReportsDashboard (lines 163-169 in render) ignore isError state. On failure, fallbacks render $0 or 0 opportunities presented as real data. Add isError/refetch destructuring and render a QueryError component before the metrics grid when any critical query fails (at minimum usePipelineSummary and useClosedWonTotal)

### [correctness/M] Calendar day search/type/sort controls are broken - useMemo has stale dependencies
- `src/features/activities/ActivityCalendar.tsx:177-205`
- selectedActivities useMemo (ActivityCalendar.tsx:177-205) filters by dayQuery, dayType, daySort but dependency array is only [activities, selectedDate]. Typing in the search input, switching type dropdown, or changing sort re-renders but memo returns stale cached list - the three controls visibly do nothing. Fix: add dayQuery, dayType, daySort to dependency array at line 205

### [performance/M] Query stale time too short - 5s causes heavy list queries to refetch on every navigation
- `src/lib/queryClient.ts:43`
- Global staleTime: 5000 (queryClient.ts:43) applies to ALL queries, including expensive ones (useOpportunitiesTotals' 5-request loop, useAccountsList' 20-request pagination, full-table team-activity scans). Any back-navigation after 5 seconds refetches them all even though this data changes rarely. Post-mutation invalidation is thorough (317 sites), so raising staleTime to 5-10 minutes would reduce refetch churn with 

### [performance/M] Renewal queue fetches unbounded table without limit - no error handling on failure
- `src/features/renewals/RenewalsQueue.tsx:223-291`
- useUpcomingRenewals/useClosedWonRenewals (RenewalsQueue.tsx:223-291) have no .limit()/.range() and the display (lines 1321-1334) shows 'No upcoming renewals' empty state on query error instead of a retry-able error. Even with small renewal counts this pattern is wrong. Add pagination with range() and handle isError state like other lists do (AccountsList.tsx:371, ContactsList.tsx:381)

### [performance/M] Account list pagination loops up to 20 requests to fetch ALL accounts (hard cap at 20k)
- `src/features/accounts/api.ts:343-374`
- useAccountsList (accounts/api.ts:343-374) pages through 1000-row chunks with hard cap of 20 pages (line 356). While this is used for a dropdown combobox (not a paginated list), fetching 20k non-archived accounts on mount is still wasteful. Consider: (1) lazy-load the dropdown on first keystroke, (2) cap the fetch to 500-1000 accounts and show 'too many results, refine search', (3) add a debounced search parameter to 

### [design/M] EmptyState component lacks visual hierarchy and accent color — flat gray palette
- `/src/components/EmptyState.tsx:19-28`
- The EmptyState component renders a flat, uniform empty-state pattern: muted circular icon container + muted-foreground text. All empty states across the app (no contacts, no opportunities, no leads, no renewals) inherit this same muted look. Compare to the Ask AI panel (lines 231-240) which uses a vibrant gradient-glow backdrop + blue-to-violet icon + layered text hierarchy — or the Playbook template cards which pair

### [design/M] KPI cards are blank white — no visual differentiation or category accent
- `/src/features/dashboard/KpiCard.tsx:67-88`
- KPI cards render with a generic white Card + muted label + bold number, with hover-state limited to shadow and border tint. The icon receives a category color (emerald for sales, red for renewals, blue for team — CATEGORY_ACCENTS at line 13-17), but the card itself has no tint or left-border accent. Cards in the Playbook section (TemplatesSection.tsx:219) pair a colored top-border gradient (from-amber-500/20 to-orang

### [design/M] Ask AI button has a beautiful gradient (blue → violet → pink) + shimmer, but other AI-powered buttons lack this polish
- `/src/app.css:248-288 (btn-ai class), /src/components/AiAssistantDialog.tsx:202-207, /src/features/playbook/* (Sparkles usage)`
- The Ask AI dialog header and buttons in the Playbook (IdeasTab, NewsletterEditor, CampaignWizard) use the .ai-icon class with ai-pulse animation + blue→violet gradient on buttons. However, throughout the app, other AI-adjacent calls (e.g., data summarization buttons, generate-prompt buttons in RequestCard) use standard Button variants without the distinctive AI gradient. The Playbook buttons use .ai-icon with span wr

### [design/M] Closed Won celebration (confetti) is triggered but the UI change on-screen lacks polish — no celebratory flash or glow
- `/src/lib/confetti.ts:9-46, /src/features/opportunities/OpportunityDetail.tsx, /src/features/opportunities/PipelineBoard.tsx, /src/features/opportunities/OpportunityForm.tsx`
- When a deal moves to Closed Won, celebrateClosedWon() fires confetti (line 9-46: three burst cannons, colorful particles, 1.2s duration). However, the card or detail page doesn't flash a celebratory highlight or glow. Opportunity: when the stage changes to closed_won, apply a brief animated border-glow to the card/section (2s emerald glow + scale pulse), pair with the confetti, and optionally show a toast.success wit

### [capability/M] No keyboard shortcut to open Ask AI assistant
- `src/components/layout/AppLayout.tsx:135-140`
- The Ask AI dialog can only be opened via the top-bar button (click or Sparkles icon). Compare: Cmd+N opens Quick Create, Cmd+/ shows keyboard shortcuts, Ctrl+Space opens Quick Task. Ask AI deserves a dedicated keyboard binding. Recommend Cmd+? (or Cmd+Shift+/ on some keyboards) since / is taken for help, but this is discoverable in the shortcuts menu. Currently the dialog is hidden behind a mouse-only UI pattern, mak

### [design/M] Example prompts lack diversity and don't cover common reps' workflows
- `src/components/AiAssistantDialog.tsx:29-36`
- EXAMPLES at src/components/AiAssistantDialog.tsx:29-36 is weighted toward pure lookups (pipeline, renewals, contacts by tag). Missing: comparative questions ('deals I've owned vs peer average pipeline'), trend questions ('top 5 accounts by activity this month'), diagnostic questions ('which accounts have no activity in 30 days'), and complex filters ('closed-won deals under $50k'). Examples like 'Show my warm-lead co

### [capability/M] No proactive follow-up suggestions after answers
- `supabase/functions/ask-ai/index.ts:318-327`
- When the assistant finishes an answer, it stops. No suggestion of next logical questions. Contrast with top LLM assistants that offer 'Would you like to see...' or 'You might also ask...'. For a sales rep who asks 'Which of my open deals close in the next 30 days?', a follow-up suggestion like 'Would you like to dive into any of these opportunities, or see the full pipeline breakdown?' would deepen engagement. Requir

### [capability/M] System prompt model name outdated or unsupported
- `supabase/functions/ask-ai/index.ts:51`
- At supabase/functions/ask-ai/index.ts:51, DEFAULT_MODEL = 'claude-sonnet-5' but the correct current model ID is 'claude-3-5-sonnet-20241022' (or a later date). As of Feb 2025, 'claude-sonnet-5' does not exist in the Anthropic API. The fallback FALLBACK_MODEL = 'claude-haiku-4-5-20251001' is correct, but if the default is ever rejected by the API (4xx at line 365), the app falls back to Haiku. Verify the preferred mod

### [bug/M] Widget shells show 'Updated X ago' but never refresh the relative-time label after the initial render
- `src/features/nexus/WidgetShell.tsx:133-139`
- WidgetShell.tsx:134-139 sets up a 60-second tick loop to re-render the relative-date label ("Updated 3 minutes ago") and keeps it honest. However, the effect depends on [dataUpdatedAt], and if dataUpdatedAt never changes (the widget data doesn't refetch), the interval is never set. More critically, the interval fires .tick() to force a re-render, but the tick counter is local state — no actual data fetch happens. So 

### [design/S] Drag-to-reorder uses instant opacity change (0.6 on drag) instead of smooth fade + shadow lift
- `src/features/nexus/NexusGrid.tsx:220-227`
- NexusGrid.tsx:225-226 applies opacity: isDragging ? 0.6 : 1 directly to the element style, causing an instant visual drop on grab. Modern drag UX combines: (1) a 150-200ms fade to 0.6-0.7 opacity, (2) a subtle shadow-lift (`shadow: 0 10px 30px rgba(0,0,0,0.15)`), and (3) smooth release back to normal. The current implementation feels stiff—the drag state is abrupt, and there's no visual feedback on hover-before-grab 

### [design/S] Mobile: drag handle + controls too small / hard to tap on < 768px; no touch-optimized spacing
- `src/features/nexus/WidgetShell.tsx:150-233`
- WidgetShell.tsx renders the header with `className="h-7 w-7"` icon buttons (Search, Edit, Remove) at 28×28px (7rem). The drag handle is also h-4 w-4 (16px). On mobile (< sm: 640px), these are difficult to tap accurately—WCAG 2.5.5 recommends 44×44px minimum touch targets. Also, the header layout is `flex items-center gap-0.5` (2px gap) which is tight on phones. The entire widget is in `grid grid-cols-1 lg:grid-cols-2

### [a11y/S] Widget accent bar is `aria-hidden` but provides critical visual status info (no accessible alternative)
- `src/features/nexus/WidgetShell.tsx:151-156`
- WidgetShell.tsx:151-156 renders the left accent bar with `aria-hidden=true`, which is correct (it's decorative). However, for a screen reader user with no vision, the color accent conveys semantic info: it's intentional visual branding/categorization. While this is borderline (it's purely decorative, not a state indicator), the spec doesn't provide a text alternative for the color choice. Consider adding a hidden ele


## LOW

### [performance/M] Two competing useUsers() hooks split cache and double-fetch user_profiles
- `src/features/leads/api.ts:381`
- src/features/leads/api.ts:381 defines useUsers() with queryKey ['users'], while accounts/api.ts:376 defines useUsers(includeInactive) with queryKey ['users', {includeInactive}]. Both query user_profiles. RenewalsQueue.tsx:15 and RoutingEditor.tsx:13 import the leads version, splitting the cache. 14 other files import the accounts version, so a rep opening Renewals after browsing Accounts triggers a duplicate fetch. F

### [performance/M] lib/branding.ts exports unused config and stale stage labels
- `src/lib/branding.ts:35-42`
- branding.ts:35-42 defines stageLabels with retired stage keys (lead, qualified, proposal, verbal_commit) that are never read. Only companyName, productName, loginSubtitle are consumed (3 fields). The unused exports (lifecycleLabels, industry, primaryColor, currency, etc.) add bundle bloat. Trim to just the 3 used fields

### [design/M] Pipeline stats cards (Total Pipeline, Deal Count, Avg Deal Size) lack accent color or visual separation
- `/src/features/opportunities/PipelineBoard.tsx:75-96`
- Three stat cards in a horizontal row show label + value with no visual accent or left-border tint. They're plain Card elements with identical styling. Compare to team-dashboard metric cards which often include small icon accents or tinted left-borders. Adding a left-border or icon accent (e.g., a small 📊 or 💰) with category-specific color would make the stats more scannable at a glance.

### [design/M] RecentWins card uses plain emoji UI instead of icon + accent pattern used elsewhere
- `/src/features/dashboard/RecentWins.tsx:78-146`
- The card uses trophy emoji (line 80) and plain emoji (🎉, 🖐) instead of matching the app's lucide-icon + gradient-accent pattern. Lines 118-138 render emoji text instead of color-coded Badge or Button variants. The high-five button (line 129) is a muted outline instead of a celebratory accent. The win-record row itself (line 97) uses a plain muted/30 background instead of a tinted accent (e.g., emerald-50 dark:emera

### [design/M] Empty states for data-heavy pages (Renewals, Reports, Lists) do not differentiate 'no filters vs. no data'
- `/src/features/renewals/RenewalsQueue.tsx:1321-1334, /src/features/opportunities/OpportunitiesList.tsx, /src/features/leads/LeadsList.tsx`
- EmptyState instances across list pages render identically whether the list is naturally empty (brand new CRM, zero leads) or empty due to filters (no opportunities in Demo stage). The audit notes (audit.md:204-206, 217-221) already flag that some pages have no error state on query failure. Visual differentiation opportunity: when a filter narrows to zero results, show a blue empty state with 'Adjust filters' + a quic

### [design/M] PipelineCard lacks visual depth and hover animation polish
- `/src/features/opportunities/PipelineCard.tsx:38-72`
- Pipeline cards render with minimal animation: shadow-sm hover:shadow-md on hover, no color shift or border highlight. The amount (line 52-54) is plain primary text, and the owner/close-date footer (line 61-69) sits plain on a border-t divider. Opportunity for delight: on hover, apply a subtle scale(1.02) + glow-shadow + border-color shift (e.g., border-primary/50). The amount could have a subtle gold or emerald tint 

### [design/M] Calendar day cells and activity list rows lack micro-interactions and color-coding by type
- `/src/features/activities/ActivityCalendar.tsx:278-308, /src/features/activities/ActivityTimeline.tsx`
- The calendar (lines 278-308) renders day cells with plain background + click handlers, no hover-state polish (no shadow, no border highlight). Activity rows in the calendar and timeline use plain text + badges, with no left-border or color stripe to denote type (call = blue, email = purple, task = green, note = gray). Compare to OpportunitiesList which color-codes the 'Last Touch' badge by days-since-touch (green/yel

### [design/M] List row hover states are minimal — no background shift, only opacity changes on secondary elements
- `/src/features/opportunities/OpportunitiesList.tsx:100-200 (row rendering), /src/features/accounts/AccountsList.tsx`
- Table rows in Opportunities, Accounts, Contacts lists have no hover:bg-muted/30 or similar row-level background shift. Only inline elements like the edit pencil (line 228) use opacity-0 group-hover:opacity-50. The entire row should have a subtle hover state (light background shift) + shadow-sm, making the interactive row more obvious. Currently you need to mouse very precisely over a link to see hover states; the row

### [design/M] Gradient accents are used sparingly — only in Ask AI, Playbook templates, and RequestCard approval button
- `/src/app.css:248-250 (btn-ai), /src/features/playbook/TemplatesSection.tsx:217-220 (category accents), /src/features/requests/RequestCard.tsx:348 (approval button gradient from-violet-600 via-blue-600 to-cyan-500)`
- The app has a rich palette of category/accent gradients (blue→violet→pink for AI, amber→orange for flagship campaigns, violet→fuchsia for post-demo, etc.) but they're concentrated in a few areas. Dashboard KPI cards, pipeline cards, and list-page section headers could benefit from subtle gradient accents. Playbook already nails this (category-specific gradients on each card header). Opportunity: apply similar gradien

### [design/M] Dark mode lacks gradient richness — muted dark surfaces don't leverage color as much as light mode
- `/src/app.css:58-99 (dark color tokens), /src/components/AiAssistantDialog.tsx:193-197 (gradient glow in dark mode)`
- Dark mode color palette (app.css:58-99) is inverted from light mode: dark slate surfaces (hsl(210 25% 8-11%)), light text. The Ask AI panel adds a subtle gradient glow (line 195-196: from-violet-500/10 via-blue-500/[0.06] to-transparent) which adds depth. However, most other dark-mode surfaces lack this richness — dashboard cards, empty states, list rows are flat. Opportunity: add subtle gradient washes to dark-mode 

### [design/M] No celebratory or motivational moment for completing milestones — tasks, activities, wins feel routine
- `/src/features/activities/TaskForm.tsx (task complete), /src/features/dashboard/HomePage.tsx (task list), /src/features/dashboard/RecentWins.tsx (win card)`
- When a rep marks a task complete or closes a Closed Won deal, the app shows a toast.success + confetti (for closed-won only). However, there's no celebratory micro-animation on the list row itself (no badge flash, no brief highlight). Closing a task is a small win, and the RecentWins card celebrates it with emoji but no special animation. Opportunity: add subtle celebratory micro-animations to high-engagement moments

### [design/M] Icon usage is inconsistent across empty states — some use lucide, some use emoji, patterns not unified
- `/src/components/EmptyState.tsx:16-30, /src/features/dashboard/RecentWins.tsx:118-140, /src/features/opportunities/OpportunitiesList.tsx (EmptyState calls)`
- EmptyState accepts a lucide Icon and renders it consistently (icon-in-circle pattern). However, some components mix lucide icons with emoji (RecentWins uses Trophy lucide but then 🎉 and 🖐 emoji; ActivityCalendar uses lucide Phone/Mail/etc for activity types but plain badge text elsewhere). Recommendation: commit to lucide icons across the entire app for consistency. If emoji is used, reserve it for specific celebra

### [design/M] Login page has beautiful seasonal backdrop but no micro-animations on form — feels static despite rich background
- `/src/features/auth/LoginPage.tsx:68-143, /src/components/seasonal/SeasonalBackdrop.tsx (seasonal scenes)`
- LoginPage renders a seasonal backdrop (winter snow, spring flowers, summer beach, fall leaves) which is visually gorgeous. The form itself is plain — inputs, labels, submit button, error text. No micro-interactions: inputs don't have animated focus-states, the submit button doesn't have a press-feedback animation, the form doesn't slide in. Opportunity: add subtle transitions (input focus: shadow + border color shift

### [design/M] Meddy chat bubbles and messages lack visual hierarchy and color differentiation
- `/src/features/meddy/ChatView.tsx (message rendering), /src/features/meddy/ConversationSidebar.tsx (conversation cards)`
- Chat bubbles render as plain bordered cards (visitor = one color, team = another). The conversation sidebar cards (ConversationCard.tsx) are plain white cards with a red unread dot. No visual hierarchy or micro-animations on new messages (no entrance animation, no highlight). The unread badge is color-only (red dot, audit.md:137-141 already noted). Opportunity: add subtle entrance animations to new messages (fade-in 

### [design/M] Nexus dashboard widgets lack visual polish — no subtle borders, no accent top-bars like Playbook cards
- `/src/features/nexus/WidgetShell.tsx (widget container rendering), /src/features/nexus/widgets/* (all widget bodies)`
- Nexus widgets render as plain Card elements with a drag handle. Unlike Playbook template cards (TemplatesSection.tsx:217-220 which have a colored top-border gradient), Nexus widgets have no accent gradient or left-border. The drag handle icon is plain (GripVertical + muted opacity). Opportunity: add a subtle 2px top-border gradient per widget type (tasks = blue, pipeline = emerald, metrics = purple, etc.), and apply 

### [design/M] System prompt forbids em-dashes but UI comments use them
- `src/components/AiAssistantDialog.tsx:195`
- The system prompt at supabase/functions/ask-ai/index.ts:324 explicitly says 'Do not use em dashes; use commas, periods, or the word to instead.' However, the React component comments (src/components/AiAssistantDialog.tsx:195, line 195) contain em-dashes: '/* Soft gradient glow behind the header — the "AI pretty" wash. */' and 'side="right"' comment. This is cosmetic but creates an inconsistent mental model. Consider 

### [design/M] System prompt lacks guidance for ambiguous asks or out-of-scope questions
- `supabase/functions/ask-ai/index.ts:318-327`
- System prompt provides guidance for 'how do I' questions and read-only constraints but does not coach the model on how to handle ambiguous asks gracefully. E.g., if a rep asks 'Show me big deals' without clarifying 'big' (>$100k? >$500k?), the assistant should ask 'Should I look for deals over $100k, $500k, or a specific amount?' rather than picking a default. Current prompt says 'Only use the provided tools to get d

### [design/M] Tool descriptions are dense and could benefit from examples
- `supabase/functions/ask-ai/index.ts:309`
- ALL_TOOLS descriptions (e.g., line 309 for search_opportunities) are functional but text-heavy. E.g., 'Search/filter opportunities (deals). Args: query (name), owner, open_only (true = only in-flight deals, i.e. Details Analysis / Demo / Proposal and Price Quote / Proposal Conversation), stage (a single raw stage value if you need one specifically), team (sales|renewals), kind (new_business|renewal), min_amount, sort

### [design/M] Fallback message when no results is generic and unhelpful
- `supabase/functions/ask-ai/index.ts:410`
- At supabase/functions/ask-ai/index.ts:410, the fallback is 'I couldn\'t find anything for that. Try rephrasing?' — generic and doesn't help reps recover. Better: detect what search tools ran and offer constructive next steps, e.g., 'Found no Warm Lead contacts. Would you like to see all active contacts, or search by a different tag?' This requires post-processing the answer to detect empty-set scenarios, which is a m

### [bug/S] MetricsWidget doesn't show metric definition load error when getMetricDef returns null
- `src/features/nexus/widgets/MetricsWidget.tsx:87-117`
- MetricsWidget.tsx:89 calls getMetricDef(config.metric) once at the top level. If the metric registry (metrics.ts) doesn't include that key—e.g., a stale config from before the metric was added—the def is null. The widget checks `if (!def)` at line 111 and shows "This metric is no longer available." That's good UX. However, the query above (line 94) has `enabled: !!def`, which disables it when def is null, so the quer
- Fix: Bug 1: Add error checking to opportunities/api.ts useBulkUpdateOwner (line 443-446) - map over ids with error handling per update, or use chunked bulk updates like contacts does. Bug 2: Same fix for leads/api.ts useBulkUpdateOwner (line 192

### [bug/S] WidgetBuilder form allows empty/whitespace-only widget names; doesn't trim on save
- `src/features/nexus/WidgetBuilder.tsx:256-280`
- WidgetBuilder.tsx:258 checks `!!name.trim()` for canSave, which prevents saving if the name is only spaces. But once saved, if a rep somehow bypasses this (e.g., via API), the widget renders in the shell with blank title. More likely: a rep types a space, then deletes it, then hits Save—the check passes, but the API receives ` ` (single space), which displays as blank in the grid.
Fix: Trim the name before passing to
- Fix: In ActivityForm.tsx line 379 and QuickTaskDialog.tsx line 191, wrap the Dialog's onOpenChange prop with a dirty check: `onOpenChange={(next) => { if (!next && (form.formState.isDirty || subject.trim()) && !window.confirm("Discard unsaved ch

### [design/S] No visual feedback when a widget is pinned/unpinned in PinnedRecordsWidget
- `src/features/nexus/widgets/PinnedRecordsWidget.tsx:68-77`
- When a rep unpin()s a record via the X button at PinnedRecordsWidget.tsx:137-146, the row vanishes immediately (optimistic update works fine), but there's no toast notification, no flash, no confirmation. Contrast: tasks completion in TasksWidget.tsx:174-179 shows a "Task completed" toast with an Undo action. Pinned records should confirm the action ("Unpinned {name}" toast, optional undo) so a rep knows the click wa

### [design/S] RequestsWidget doesn't show count of non-visible pending requests like Tasks/Pipeline do
- `src/features/nexus/widgets/RequestsWidget.tsx:92-104`
- TasksWidget.tsx:306-310 shows "openTasks.length open" when there are more rows than preview_count. PipelineWidget and PinnedRecordsWidget do the same. RequestsWidget.tsx:96-100 shows the total pending count but only when visible.length = all.length (all requests fit in the preview). When there are more pending requests than preview_count, the bottom footer shows nothing about the overflow—it just shows the "View All"


## IDEA

### [capability/M] No capability to answer questions about activities/notes or products
- `supabase/functions/ask-ai/index.ts:153-301`
- The 9 read-only tools (search_accounts, get_account, search_contacts, get_contact, search_opportunities, pipeline_summary, list_renewals, list_my_tasks, how_do_i) omit two frequently-asked categories: (1) activities/notes — reps often ask 'Did we talk to X recently?' or 'Show call notes from meeting with Y'; (2) products/SKUs — 'What's the margin on product Z?' or 'Search for products in the Platform team bundle'. Ad

### [design/M] Voice lacks warmth and personality beyond 'teammate' tone
- `supabase/functions/ask-ai/index.ts:324`
- System prompt says 'write like a helpful teammate, not a chatbot' and forbids cheerful sign-offs. This is correct — avoid 'Let me help you!' and 'Have a great day!'. But the phrase 'helpful teammate' is vague. Consider adding a concrete voice sample or a 2-3 sentence riff on personality. Example: 'Be concise and practical. If you found what they asked for, say so directly. If the data is empty, say it clearly: "No Wa

### [design/M] Dialog loses message history on close
- `src/components/AiAssistantDialog.tsx:209-219`
- The AiAssistantDialog at src/components/AiAssistantDialog.tsx uses a sheet that portals to body. When closed and reopened, the conversation history is in memory (messages state) but a user who closes the panel expects it to be sticky across the app. Currently clicking 'New' clears messages and prompt state, but closing the sheet and reopening it keeps them. This is actually good UX, but document it (e.g., add a toolt

### [capability/M] Streaming response not implemented — all-or-nothing latency
- `supabase/functions/ask-ai/index.ts:351-372`
- The edge function fetches the full response from Anthropic and returns it at once (line 372: 'const data = await res.json()'), then the frontend displays it immediately. No streaming. For longer answers (e.g., multi-paragraph pipeline analysis), this means a 2-3s wait before ANY text appears. Modern Ask-AI assistants stream tokens to the UI for perceived speed. Requires: (1) edge function to use streaming API (SSE or

### [design/M] Rich text rendering supports tables but example prompts don't demonstrate this
- `src/components/AiAssistantDialog.tsx:53-132`
- The RichText component at src/components/AiAssistantDialog.tsx:53-132 supports markdown tables (parseRow, isTableSeparator), but the EXAMPLES at lines 29-36 don't include any prompt that would naturally yield a table. This is a missed opportunity to show off the formatter's capability and guide users toward structured asks. Consider adding an example like 'Show pipeline by stage as a table' or in the system prompt, e

### [design/S] No keyboard shortcut or tooltip indicating Nexus grid is reorderable via dnd-kit
- `src/features/nexus/WidgetShell.tsx:159-171, NexusGrid.tsx:164-176`
- WidgetShell.tsx:159-171 documents the drag handle with a Tooltip("Drag to reorder"), which is good. But there's no hint that arrow keys also work (keyboard drag via KeyboardSensor in NexusGrid.tsx:130). A first-time user might not discover keyboard reorder. Consider: add a sentence in the empty-state message at NexusGrid.tsx:168-174 like "Drag widgets to reorder, or use arrow keys when focused on the drag handle." Al

### [design/S] NexusPage greeting doesn't update when system time crosses 12pm or 5pm
- `src/features/nexus/NexusPage.tsx:22-27`
- NexusPage.tsx:22-27 computes getGreeting() once on first render—no effect, no polling. If a rep leaves the dashboard open overnight, the greeting never updates (stays "Good evening" when it's now morning). While low-impact (mainly cosmetic), compare this to WidgetShell's 60-second tick—consistency suggests the greeting should update too, or at minimum there should be a comment explaining why it doesn't.
Fix (if desir
