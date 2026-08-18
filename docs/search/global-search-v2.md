# Global Search v2 — "find everything, look upgraded" (survey T6)

Nathan, 8/17: "take the opportunity to make search work much much better, and Look better too, so the entire experience of searching is just super upgraded and beautified. give search an evolved and upgraded Look like we've been doing for new pieces of the CRM."

Design authored by the main session; implementation may refine details but NOT the contract below. Current implementation: src/components/GlobalSearch.tsx (363 lines, cmdk CommandDialog, 3 entities, name-only for accounts/opps).

## 1. Coverage contract (what must become findable)

| Group | Matches on | Today |
|---|---|---|
| Accounts | name, city, state, website, account_number, phone (digit-normalized) | name only |
| Contacts | first/last name, email/email2/email3, title, phone (digit-normalized) | names+emails |
| Deals (opportunities) | name, **account name** | name only |
| Activity | subject AND **body** — emails, notes, tasks, calls, meetings | nothing (subject-only on /activities, nothing here) |

- All groups: `archived_at is null`; contacts also `import_status is null` (current behavior preserved).
- Phone matching: if the query stripped to digits has ≥4 digits, also match digit-normalized phone columns.
- Activity rows link to the RECORD the activity belongs to (opportunity > contact > account priority, same fallback logic task-reminders uses) with `?open_activity=<id>` style param only if such a pattern already exists — otherwise link to the record page (the timeline shows the item); fallback `/activities?q=<query>`.

## 2. Backend: one RPC, invoker security

New migration (next free 202608171xxxxx slot): `global_search_v2(q text, per_group int default 8)`.

- **LANGUAGE sql or plpgsql, SECURITY INVOKER (explicitly NOT definer)** — caller RLS must apply. Grant execute to authenticated only; revoke from anon + public. (House rule: never a definer view/function readable by anon — see tests/anonViewGrants.test.ts.)
- Returns jsonb: `{accounts: {rows: [...], total: int}, contacts: {...}, opportunities: {...}, activities: {...}}` where each row carries `{id, label, sublabel, meta, related_id?, related_entity?}` — whatever minimal shape the UI needs, designed by implementer, documented in the migration header.
- `total` = capped count (count up to 50 with a `limit 50` subquery — never a full count over big tables) so the UI can say "8 of 40+".
- Ranking in SQL per group: exact-prefix matches first (`label ilike q || '%'`), then substring, then (activities only) recency `order by coalesce(activity_date, created_at) desc`. Keep it simple — no scoring framework.
- Activities body search: `subject ilike %q% or body ilike %q%`, min length guard: the activities branch only runs when `length(q) >= 3` (body search under 3 chars is noise + heavy).
- Indexes: enable pg_trgm if not already (`create extension if not exists pg_trgm`) and add GIN trgm indexes to make the new predicates sane: `activities using gin (subject gin_trgm_ops)`, `activities using gin (body gin_trgm_ops)` (verify column name for body/description!), `accounts using gin (name gin_trgm_ops)`, `contacts` name/email if not indexed, `opportunities using gin (name gin_trgm_ops)`. Check existing indexes first (169 exist) — do not duplicate.
- Frontend calls the ONE rpc (single round trip) instead of 3 parallel queries. Debounce 200ms. Keep `["global-search-v2", q]` query key, `keepPreviousData` so the list doesn't flash while typing.

## 3. UI: the upgraded look (tokens verbatim from the design-language recon)

Keep the cmdk/CommandDialog foundation (a11y + keyboard model are right). Restyle + restructure:

1. **Size**: `sm:max-w-2xl`; list `max-h-[420px]`.
2. **Input row**: keep h-12; placeholder "Search accounts, contacts, deals, emails, notes…".
3. **Scope chips row** (new, under the input, above the list): `All · Accounts · Contacts · Deals · Activity` — small pills, `rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors`; active chip `bg-primary/10 text-primary border-primary/30`; inactive `text-muted-foreground hover:text-foreground`. Clicking filters which groups render (client-side; the RPC always returns all). Keyboard: Tab cycles chips (or ⌘1-5 if trivial); do not steal ↑↓/Enter from cmdk.
4. **Result rows** (the visible upgrade): replace bare icons with the Nexus **icon-chip** pattern — `flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br` + per-entity accent gradients (KpiCard's CATEGORY_ACCENTS shape):
   - Accounts: `from-blue-500/20 to-blue-500/[0.04]` + `Building2` `text-blue-500`
   - Contacts: `from-emerald-500/20 to-emerald-500/[0.04]` + `Users` `text-emerald-500`
   - Deals: `from-violet-500/20 to-violet-500/[0.04]` + `Target` `text-violet-500`
   - Activity: `from-amber-500/20 to-amber-500/[0.04]` + per-type icon (reuse the ACTIVITY_ICONS idea) `text-amber-500`
   Centralize this in a NEW shared module `src/lib/entity-visuals.ts(x)` (icon + accent per entity) — GlobalSearch imports it; do not refactor other files to use it in this pass (note it for later adoption).
   Row layout: chip + `min-w-0 flex-1` column (title `text-sm font-medium truncate` + sublabel `text-xs text-muted-foreground truncate`) + right meta `text-xs text-muted-foreground` (`tabular-nums` for money). Row container: `rounded-lg px-2 py-2` (cmdk selected state `data-[selected=true]:bg-accent` kept).
5. **Match highlight**: first case-insensitive occurrence of the query in title/sublabel wrapped in `<mark className="rounded-sm bg-primary/15 px-0.5 text-inherit">`. Client-side, cheap.
6. **Group headers**: eyebrow style `text-xs uppercase tracking-wide text-muted-foreground` with count chip (`8 of 40+`) and a right-aligned **"See all →"** (`text-xs text-primary underline underline-offset-4 hover:text-primary/80`) that routes to the list page with the query prefilled (`/accounts?q=…`, `/contacts?q=…`, `/opportunities?q=…`, `/activities?q=…` — verify each list reads a `q`/search param; wire the smallest missing param read if one lacks it).
7. **Footer hint bar** (new): `border-t px-3 py-2 flex items-center justify-between`; left: kbd chips (`↑↓` navigate · `⏎` open · `esc` close) in the existing kbd style (`rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground`); right: total across groups (`23 results`) `text-[11px] text-muted-foreground`.
8. **Loading**: 3 skeleton rows (`h-9 rounded-lg`) replacing the "Searching…" text; error state keeps text-destructive line.
9. **Empty query**: Recents exactly as today but restyled with the same chips/rows; below recents a one-line hint `text-[11px] text-muted-foreground`: "Tip: search emails and notes by any phrase, accounts by city, deals by company."
10. **Empty results**: keep CommandEmpty; copy "No matches for "<q>" — try fewer words."
11. Reduced motion + dark mode: free via tokens; no new animations beyond existing transitions.

## 4. Non-goals (this pass)

- No products/lists/collateral/requests groups (rare targets; keep the palette focused).
- No fuzzy/typo matching beyond trgm ilike.
- No changes to useRecentRecords storage shape.
- No redesign of the topbar trigger button beyond updating its placeholder text if needed.

## 5. Acceptance checklist

- [ ] A phrase that appears only in a synced email's BODY finds the email's record from Cmd+K.
- [ ] An account is findable by its city; a deal by its account's name; a contact by phone digits.
- [ ] Group counts + See-all links work; see-all lands on the list pre-filtered.
- [ ] anon cannot execute the RPC (revoked); RLS applies (invoker) — a non-admin sees only what their role allows.
- [ ] tsc + vitest + build green; anonViewGrants test still green (no new view; RPC revoked from anon).
- [ ] Dialog remains fully keyboard-drivable; screen-reader labels intact.
