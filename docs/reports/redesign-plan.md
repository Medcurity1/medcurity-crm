# Reports redesign — build plan (2026-06-24)

Staging only. Card landing merging Standard + saved reports; Team Dashboard stays separate; Standard routes/pages untouched.

## Summary
Redesign /reports into a unified, searchable CARD LANDING that merges the 13 hardcoded Standard reports with the user's saved/custom reports, with per-user DB-backed favorites (★), one-click share-with-team, and one-click run. The Team Dashboard stays its own tab and is never a card. The plan is sequenced into 6 independently-shippable staging slices, each safe on its own.

The keystone insight from the code: Standard reports are a hardcoded REPORTS array in StandardReports.tsx (id slug = stable contract) that each Link to a bespoke /reports/standard/:slug route in App.tsx (lines 138-157); saved reports are saved_reports rows run through ReportBuilder.tsx + report-api.ts. These two worlds share NO abstraction. The redesign generalizes the card grid (StandardReports.tsx is already 90% of the target — search, ★, grid) into a shared card that renders BOTH kinds, WITHOUT touching the 13 standard pages or their routes, and WITHOUT changing the ReportConfig/saved_reports contract.

Three things drive new schema: (1) favorites today are localStorage-only and standard-slug-only (FAV_KEY 'report_favorites', StandardReports.tsx:24-36) with no concept at all for saved reports — unify into one polymorphic report_favorites table keyed (user_id, report_ref) where report_ref is 'standard:<slug>' or 'saved:<uuid>'; (2) one-click share/un-share from a card needs no schema (reuse is_shared + useUpdateReport) but admins can't manage others' shared reports because saved_reports UPDATE/DELETE RLS is owner-only with no is_admin() escape hatch — add that; (3) custom reports have NO deep link today (ReportBuilder holds load state in component state only, no searchParams), so a card 'Run' for a saved report needs a new ?report=<id> param the builder reads on mount.

Builder redesign + results display are orthogonal slices done last/incrementally to avoid big-bang regression: extract ColumnPicker/FilterBuilder/ResultsTable out of the 1,917-line ReportBuilder.tsx into their own files first (pure refactor), then improve them (searchable/reorderable column picker, aligned filter rows, sticky-header sortable results with a totals row), and introduce ONE shared <ReportResult> that the 13 standard pages can adopt page-by-page later.

## New schema
Two new migrations, both additive.

1) report_favorites (Slice 1) — unifies favorites across both report kinds via a prefixed text ref (standard reports have no DB row to FK to, so a real FK can't cover them):

  create table public.report_favorites (
    user_id    uuid not null references public.user_profiles(id) on delete cascade,
    report_ref text not null,            -- 'standard:new-customers' | 'saved:<uuid>'
    created_at timestamptz not null default now(),
    primary key (user_id, report_ref)
  );
  alter table public.report_favorites enable row level security;
  create policy report_favorites_all on public.report_favorites
    for all to authenticated
    using (user_id = auth.uid()) with check (user_id = auth.uid());
  create index idx_report_favorites_user on public.report_favorites(user_id);

(Orphaned 'saved:<uuid>' rows after a saved-report delete are harmless; optional cleanup trigger deferred. Frontend one-time migration upserts the old localStorage 'report_favorites' slug array as 'standard:<slug>' rows, then clears the key.)

2) saved_reports admin RLS (Slice 4) — add is_admin() to UPDATE + DELETE so admins can manage/clean others' shared reports (today they're owner-only, migration 20260403000003 lines 100-112, inconsistent with the newer report_folders tables):

  drop policy if exists saved_reports_update on public.saved_reports;
  create policy saved_reports_update on public.saved_reports
    for update to authenticated
    using (owner_user_id = auth.uid() or public.is_admin())
    with check (owner_user_id = auth.uid() or public.is_admin());

  drop policy if exists saved_reports_delete on public.saved_reports;
  create policy saved_reports_delete on public.saved_reports
    for delete to authenticated
    using (owner_user_id = auth.uid() or public.is_admin());

No new columns on saved_reports — share-with-team reuses the existing is_shared boolean. The dead folder_id/is_public columns (added 20260417000008, never read by report-api.ts) are left as-is; the text `folder` column remains the one in use. No new deep-link table needed — the ?report=<id> param (Slice 3) is URL-only, no schema.

## Do not break
Standard reports stay fully intact: every /reports/standard/<slug> route in App.tsx (lines 138-157) and every bespoke page in src/features/reports/standard/*.tsx is left untouched through Slices 1-5; the slug stays the stable card↔route contract; standard cards keep rendering as <Link to={`/reports/standard/${id}`}> exactly as today (StandardReports.tsx:236). The hardcoded REPORTS array remains the source of truth for standard cards — we only ADD saved cards alongside it, never replace it. Legacy <Navigate> redirect aliases (mql-leads, arr-rolling-365, renewals-queue, mql-sql-counts) and the diagnostic route are preserved. Standard pages back-link to /reports?tab=standard, so we KEEP the tab value 'standard' (and VALID_TABS in ReportsHub.tsx) so all 13 back-links and the catalog redirect keep resolving. Team Dashboard stays its own ReportsHub tab (?tab=team-dashboard) and the separate full-bleed /team/tv route — never rendered as a card, satisfying the keep-separate constraint by construction. The durable ReportConfig shape (types/crm.ts:803-809) and saved_reports columns are unchanged, so all existing saved/custom reports keep loading and running; runReportQuery/fetchAllReportRows/useRunReport are not modified. Results-display improvements are migrated page-by-page (Slice 6) so any regression is scoped to one report at a time, not a big-bang across all 13. The Custom Builder UX refactor (Slice 5) is split into a pure extraction commit before any visual change, keeping props/behavior identical first.

## Slices

### Slice 1 — Slice 1 — Favorites backend + unified favorites hook (DB-backed, replaces localStorage)
- Files: NEW supabase/migrations/2026XXXX_report_favorites.sql (create report_favorites table + RLS); NEW src/features/reports/report-favorites-api.ts (useReportFavorites read + useToggleFavorite mutation, react-query); EDIT src/features/reports/StandardReports.tsx (swap loadFavorites/saveFavorites localStorage helpers at lines 24-36 for the hook; key cards by 'standard:<id>'; add a one-time localStorage→DB upsert-then-clear migration on first mount)
- Polymorphic favorites covering BOTH report kinds. Table: report_favorites(user_id uuid refs user_profiles on delete cascade, report_ref text -- 'standard:<slug>' | 'saved:<uuid>', created_at, PK(user_id, report_ref)). RLS: for-all to authenticated using/with check user_id = auth.uid(); index on user_id. Hook returns a Set<string> of refs + a toggle. StandardReports keeps working exactly as-is visually; only the persistence layer changes. The localStorage→DB one-shot read old 'report_favorites' slug array, upsert as 'standard:<slug>', then remove the key so it doesn't re-run. Ships alone: Standard tab is unchanged in look, favorites now sync cross-device. No card-merge yet.
- Risk: Low. Pure additive table + same-shaped UI. Only risk is the one-time localStorage migration firing twice — guard by deleting the key after a successful upsert and no-op if absent.

### Slice 2 — Slice 2 — Saved reports as cards on the Standard tab (the unified grid) behind kind discriminator
- Files: EDIT src/features/reports/StandardReports.tsx (generalize ReportCard into a discriminated union: {kind:'standard', id, title, description, icon, apiView, status} | {kind:'saved', id (uuid), title=name, description (entity summary), is_shared, owner_user_id}; build saved cards from useSavedReports(); render standard cards as today via Link to /reports/standard/:id, render saved cards with a run action that navigates to /reports?tab=reports&report=<uuid>); REUSE src/features/reports/report-api.ts useSavedReports (no change); REUSE report-favorites-api.ts from Slice 1 keyed by 'saved:<uuid>' too
- This is the core 'one searchable home'. Add filter chips All / Favorites / My / Shared / Standard. Mapping: Standard = the REPORTS array (kind:'standard'); My = saved where owner_user_id===user.id; Shared = saved where is_shared && owner!==me; Favorites = union of favorited refs across both; All = everything. Standard cards only ever match All/Favorites/Standard (they have no owner/share). Search filters title+description across both kinds. Keep the existing grid/search/star UI from StandardReports.tsx:256-329 verbatim, just feed it both sources. The saved-card 'run' deep link (?report=) is wired in Slice 3 — until then, saved cards can link into the builder tab without preselect (still functional, just not auto-run).
- Risk: Medium. Biggest visual change. De-risk by keeping all Standard rendering identical and only ADDING saved cards. Hide edit/delete/un-share on saved cards the user doesn't own (RLS is owner-only). The 'My/Shared/Standard' chips are pure client-side filters over already-fetched data.

### Slice 3 — Slice 3 — Deep-link a saved report into the builder (run-in-one-click for custom reports)
- Files: EDIT src/features/reports/ReportBuilder.tsx (read useSearchParams for ?report=<id> on mount; when present and savedReports loaded, call existing handleLoadReport (line 1710) which already setConfig+auto-runs+scrolls; clear the param after load to avoid re-trigger on tab switches); EDIT src/features/reports/StandardReports.tsx (saved-card run action → navigate('/reports?tab=reports&report='+id))
- ReportBuilder today holds loaded-report state purely in component state (activeReportId, no URL sync — confirmed: no useSearchParams in the file). Add the one new URL param so a card click both navigates to the Custom Builder tab AND preloads+auto-runs the report. handleLoadReport already does setHasRun(true)+runTrigger bump+scrollIntoView, so this is a thin wiring job. Standard cards still just Link to their bespoke page (no change). This makes 'run in one click' uniform: standard → page route; saved → builder with ?report=.
- Risk: Low-Medium. Must guard against re-loading on every render (load once per id; strip the param or track lastLoadedId). No schema change.

### Slice 4 — Slice 4 — Share/un-share from a card + admin manage RLS
- Files: NEW supabase/migrations/2026XXXX_saved_reports_admin_rls.sql (add is_admin() to saved_reports UPDATE + DELETE policies, mirroring report_folders pattern from 20260417000008); EDIT src/features/reports/StandardReports.tsx (owner-only 'Share with team' toggle on saved cards calling useUpdateReport({id,is_shared}) from report-api.ts:100; non-owners see a read-only 'Shared' badge); REUSE report-api.ts useUpdateReport/useDeleteReport (no change)
- Today sharing is set ONLY inside SaveReportDialog — you must reopen the report in the builder and re-save. Add a one-click toggle on the card (owner-only) that flips is_shared via the existing mutation. The RLS migration lets admins fix/clean/un-share another user's shared report (current saved_reports UPDATE/DELETE RLS at migration ...3 lines 100-112 is owner-only with no is_admin() override, inconsistent with the newer report_folders tables). Keep the builder's existing checkbox too.
- Risk: Low. RLS change is additive (widens to admins). UI toggle reuses an existing mutation. Verify the UPDATE policy uses both USING and WITH CHECK so an admin flip isn't rejected.

### Slice 5 — Slice 5 — Builder UX refactor: extract sub-components, then improve column picker + filters
- Files: NEW src/features/reports/builder/ColumnPicker.tsx, FilterBuilder.tsx, ResultsTable.tsx, ReportsSidebar.tsx (extract the inline sub-components from ReportBuilder.tsx lines ~442, ~741, ~908, ~1407 with NO behavior change first); then EDIT those new files to add: searchable + grouped + reorderable column picker (ENTITY_DEFS already carry ColumnDef.group), aligned/responsive filter rows, select-all/clear; EDIT src/features/reports/ReportBuilder.tsx to import them; NO change to src/features/reports/report-config.ts (ENTITY_DEFS) or the ReportConfig contract
- ReportBuilder.tsx is 1,917 lines with everything inline — refactor-then-improve de-risks it. Step 5a is a pure extraction (move code, keep props/behavior, ship, verify identical). Step 5b improves the cramped column picker (add a search box + select-all/clear + drag-reorder since selection order == display order) and the wrap-awkward filter rows. The persisted ReportConfig (entity/columns/filters/sort) is the durable contract and stays byte-compatible so all existing saved reports keep loading. group_by stays unused (out of scope).
- Risk: Medium. Mitigated by doing extraction as its own shippable commit before any visual change. Keep runReportQuery/fetchAllReportRows/useRunReport untouched so query semantics and saved-report compatibility are preserved.

### Slice 6 — Slice 6 — Shared <ReportResult> + improved results display, adopted incrementally
- Files: NEW src/features/reports/ReportResult.tsx (one shared results component: sticky-header sortable table, KPI/total row, table/bar/pie toggle, export-button cluster — generalized from ResultsTable in ReportBuilder.tsx:908-1217); EDIT src/features/reports/ReportBuilder.tsx (render <ReportResult> instead of inline ResultsTable); then OPTIONALLY EDIT standard pages one at a time (src/features/reports/standard/NewCustomers.tsx, DoNotEmail.tsx, etc.) to adopt <ReportResult>; REUSE src/features/reports/standard/report-helpers.ts + report-fetchers.ts + PreviewNote.tsx
- Today each of the 13 standard pages re-implements its own table+KPIs+export, and the builder's ResultsTable has no header sorting, no sticky header, no totals row, and the chart toggle only appears when a numeric column happens to be selected. Introduce ONE <ReportResult> and migrate the builder first (immediate win), then convert standard pages page-by-page so a regression touches one report, not all 13. This slice is orthogonal to the landing and can ship anytime after Slice 5; the 13 standard pages keep working untouched until individually migrated.
- Risk: Low if incremental. The hard constraint (don't break Standard) is honored by migrating pages one-by-one and never changing their routes/slugs. Charts must aggregate the full export set, not just the 1,000-row display cap, to avoid wrong totals — wire totals via fetchAllReportRows where a true sum is shown.
