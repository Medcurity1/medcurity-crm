# Nexus Build Plan — architecture + stage breakdown

Companion to `jordan-v4-spec.md` (read that first — it is the requirements
source). This doc pins the architecture decisions and the reuse map so
implementation stages stay consistent. Staging-only until Nathan's prod call.

## Naming decision

"Nexus" replaces the homepage. The placeholder at `src/features/nexus/NexusPage.tsx`
(/nexus, "Coming Soon") is superseded by the real thing. Route `/` renders the
new NexusPage; `/nexus` redirects to `/`. Sidebar item "Home" renamed "Nexus"
(keep a home-ish icon). Legacy `src/features/dashboard/HomePage.tsx` keeps its
file (rollback = one route line) but loses the `/` route.

## Schema (one migration, house style per 20260702000001 + 20260613000004)

- `nexus_widgets`: id uuid pk, user_id uuid not null, position int not null,
  widget_type text check in ('tasks','pipeline','custom_report','metrics','pinned_records','requests'),
  name text not null, color text null, icon text null,
  preview_count int not null default 5 check (preview_count in (3,5,10)),
  config jsonb not null default '{}', created_at, updated_at (+touch trigger).
  RLS: own-row all ops (auth.uid() = user_id); admin (is_admin()) full access
  (needed for "configure for user"). Cap: BEFORE INSERT trigger raises when the
  target user already has 8. revoke from anon.
- `nexus_default_widgets`: same minus user_id. RLS: SELECT authenticated,
  writes admin-only. Seed two rows in the migration: "Today's Tasks" (tasks,
  pos 0) and "Current Pipeline" (pipeline, pos 1), preview_count 5.
- `nexus_user_state`: user_id pk, initialized_at timestamptz. Own-row + admin
  RLS. Exists so an intentionally-emptied grid is NOT re-seeded.
- RPC `nexus_initialize(p_user uuid default auth.uid())` security definer:
  caller must be p_user or admin; no-op if nexus_user_state row exists; else
  copy nexus_default_widgets → nexus_widgets, and (Requests migration
  requirement) if the user has any non-completed rows in `requests` they
  submitted, append a Requests widget (name 'My Requests', config
  {"category":"all"}); insert state row. Idempotent.
- RPC `nexus_reset_to_default(p_user uuid)`: admin-only. Delete user's
  widgets, re-copy defaults, upsert state row.
- Warm Lead tag (Spec 1): idempotent seed into `tags` (match the column shape
  in 20260623000005; pick an orange-family color token consistent with
  TagChips palette). No schema change — tags are free-form.

## config JSONB shapes (TS types in src/features/nexus/types.ts)

- tasks / pipeline: `{}` (always scoped to the widget owner)
- custom_report: `{ entity: 'contacts'|'accounts'|'opportunities'|'imports',
    filters: NexusReportFilter[], sort: { field, dir }, columns: string[] }`
  — columns 3-6, draggable order. Imports entity = admin-only option.
- metrics: `{ metric: MetricKey, scope: 'personal'|'team',
    period: 'today'|'week'|'month'|'quarter', compare: boolean }`
- pinned_records: `{ records: [{ type: 'contact'|'account'|'opportunity', id }] }`
  (array order = display order)
- requests: `{ category: 'collateral'|'crm'|'all' }`

## Reuse map (from recon — verify at point of use)

- Grid DnD: @dnd-kit (`PipelineBoard.tsx` DndContext; `LayoutEditor.tsx`
  SortableContext + verticalListSortingStrategy precedent).
- Tasks widget: port query/render logic from HomePage's MyTasksSection
  (activities, activity_type='task', owner, due_date asc + priority desc).
- Pipeline widget: port MyOpenOpportunitiesSection (open stages, owner,
  expected_close_date asc nulls last).
- Custom Report engine: new `src/features/nexus/report-engine.ts`. Reuse the
  LIST-PAGE filter semantics per entity (see each feature's api.ts — contacts
  already supports tag filter via contact_tags join; owner/status/stage/
  industry/state filters mirror the list pages). Filter option lists should
  visually match the list-view filters (MultiSelect.tsx is entity-agnostic).
  Stage values are lowercase snake_case. Warm Leads preset = contacts +
  tag filter.
- Metrics: new `src/features/nexus/metrics.ts` registry modeled on
  `kpi-registry.ts` (18 KPIs exist — reuse query fns where they fit). Personal
  scope = owner_user_id filter; team = none. Compare = same query over the
  previous window. Trend metrics (calls/emails per day) render mini bar/line
  via recharts (SegmentedLineChart.tsx precedent, but keep widget charts
  axis-free + compact). "Demos Scheduled" = activity_type='meeting' count
  (label it honestly: "Meetings Scheduled"). "Revenue vs Goal" reads
  dashboard_goals; empty state when no goal configured.
- Pinned records: search via house combobox pattern (AccountCombobox.tsx);
  stale = last activity/updated 14+ days → amber dot. Row drag = dnd-kit.
- Requests widget: reuse `src/features/requests/api.ts` hooks + RequestCard
  visual language, compact rows: title, submitted date, priority badge,
  status badge, filtered by config.category.
- Widget shell: name, color accent (left edge, 7-color palette: navy blue
  green red purple orange gray), optional icon, "Updated X ago"
  (dataUpdatedAt from react-query), in-widget search (client-side filter of
  loaded preview rows only), edit pencil (reopens builder pre-filled), remove
  X (ConfirmDialog), drag handle in header.
- Persistence api: `src/features/nexus/api.ts` — useNexusWidgets(userId?),
  add/update/remove/reorder mutations (reorder = batch position update),
  useNexusInitialize. Admin passes a target userId; RLS admin policies allow.
- Admin section: AdminSettings TOP_TABS pattern → new "Nexus" tab with:
  default-layout editor (same grid/builder against nexus_default_widgets),
  per-user editor (user picker from UsersManager patterns → renders
  NexusGrid with that userId), reset-to-default button (ConfirmDialog).
- Loading/empty/toast: Skeleton + FriendlyLoading + sonner, per-type friendly
  empty states from the spec (§10).

## Layout rules (spec §3)

2 columns lg+, 1 column below. Max 8 widgets (builder button disabled at 8).
Equal widths; height driven by preview_count. Order: pairs left-to-right then
down; single-column preserves order.

## Stages

- A: migration + Warm Lead seed + types + api.ts (hooks/mutations/init)
- B: NexusPage + NexusGrid + WidgetShell + dnd reorder + builder
  (add/edit/remove) + system widgets (tasks, pipeline) + route/sidebar swap
- C: custom_report engine+builder, metrics registry+widget, pinned_records,
  requests widget
- D: admin tab (default layout, per-user config, reset) + polish pass
  (empty states, search, updated-ago, responsive, dark mode)
- E: build/tsc, deploy to staging, browser E2E (every widget type + reorder +
  admin + Summer's layout from spec §12), review fan-out, fixes

Summer's §12 layout is configured via the admin UI after E (needs her ICP
confirmation for widget 3 — leave that one pending; set up 1, 2, 4).
