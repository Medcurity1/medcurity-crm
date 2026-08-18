// Global search v2 — the Cmd+K palette (docs/search/global-search-v2.md).
//
// Two things changed from v1, and they're independent:
//
// 1. WHAT IT FINDS. v1 fired three parallel PostgREST queries and matched
//    name-only on accounts and deals, so you could not find an account by its
//    city, a deal by the company it belongs to, or an email by a phrase in its
//    BODY. All of that now comes from one `global_search_v2` RPC
//    (supabase/migrations/20260817120000_global_search_v2.sql) — one round
//    trip, ranked and capped server-side, SECURITY INVOKER so a user still
//    only finds rows their RLS lets them open.
//
// 2. HOW IT LOOKS. Rows carry the Nexus icon-chip (src/lib/entity-visuals.tsx)
//    instead of a bare grey glyph, groups get an eyebrow header with a count
//    and a "See all" into the pre-filtered list, matches are highlighted, and
//    a footer bar states the keyboard model.
//
// Kept from v1 on purpose: the cmdk CommandDialog (its keyboard + a11y model
// is right), shouldFilter={false} (results arrive server-filtered — letting
// cmdk re-filter them made the palette look stuck), the recents list backed by
// useRecentRecords, and the debounce.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import {
  activityLabel,
  customerStatusLabel,
  formatCurrency,
  formatDate,
  stageLabel,
} from "@/lib/formatters";
import {
  ENTITY_CHIP_CLASS,
  ENTITY_VISUALS,
  activityIcon,
  type SearchEntity,
} from "@/lib/entity-visuals";
import { useRecentRecords, type RecentRecord } from "@/hooks/useRecentRecords";
import type { ActivityType, CustomerStatus, OpportunityStage } from "@/types/crm";

// 200ms: long enough that a fast typist sends one query instead of six, short
// enough to feel live. Results still start at a single character.
const DEBOUNCE_MS = 200;
const MIN_SEARCH_LENGTH = 1;
const RESULTS_PER_GROUP = 8;
// Must match the `limit 50` in the RPC's per-group CTEs: the server counts no
// further than this, so a total that reaches it is displayed as "50+".
const TOTAL_CAP = 50;

// ── Shape returned by global_search_v2 ────────────────────────────────
// Values are RAW (enum tokens, status keys) and formatted here by the same
// helpers the rest of the app uses, so the SQL never has to know what a stage
// is called this quarter.

type SearchGroupKey = "accounts" | "contacts" | "opportunities" | "activities";

interface SearchRow {
  id: string;
  label: string;
  sublabel: string | null;
  meta: string | null;
  /** opportunities only */
  amount?: number | null;
  /** activities only — effective_at (coalesce(activity_date, created_at)) */
  occurred_at?: string | null;
  /** activities only — the record the activity hangs off, if any */
  related_entity?: SearchEntity | null;
  related_id?: string | null;
}

interface SearchGroupResult {
  rows: SearchRow[];
  total: number;
}

type SearchResponse = Record<SearchGroupKey, SearchGroupResult>;

const EMPTY_GROUP: SearchGroupResult = { rows: [], total: 0 };
const EMPTY_RESPONSE: SearchResponse = {
  accounts: EMPTY_GROUP,
  contacts: EMPTY_GROUP,
  opportunities: EMPTY_GROUP,
  activities: EMPTY_GROUP,
};

const GROUPS: { key: SearchGroupKey; entity: SearchEntity }[] = [
  { key: "accounts", entity: "account" },
  { key: "contacts", entity: "contact" },
  { key: "opportunities", entity: "opportunity" },
  { key: "activities", entity: "activity" },
];

type Scope = "all" | SearchGroupKey;

const SCOPES: { value: Scope; label: string }[] = [
  { value: "all", label: "All" },
  ...GROUPS.map((g) => ({
    value: g.key as Scope,
    label: ENTITY_VISUALS[g.entity].plural,
  })),
];

// ── Presentation helpers ─────────────────────────────────────────────

/**
 * Wrap the first case-insensitive occurrence of the query so the user can see
 * WHY a row matched — which matters most for activity rows, where the hit is
 * often a phrase buried in an email body.
 */
function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!text || !q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-inherit">
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

/** The right-hand column: status, title, stage + money, or type + date. */
function rowMeta(key: SearchGroupKey, row: SearchRow): string | null {
  switch (key) {
    case "accounts":
      return customerStatusLabel(row.meta as CustomerStatus | null);
    case "contacts":
      return row.meta;
    case "opportunities": {
      const stage = row.meta
        ? (stageLabel(row.meta as OpportunityStage) ?? row.meta)
        : null;
      const amount =
        typeof row.amount === "number" ? formatCurrency(row.amount) : null;
      return [stage, amount].filter(Boolean).join(" · ") || null;
    }
    case "activities": {
      const type = row.meta
        ? (activityLabel(row.meta as ActivityType) ?? row.meta)
        : null;
      const when = row.occurred_at ? formatDate(row.occurred_at) : null;
      return [type, when].filter(Boolean).join(" · ") || null;
    }
  }
}

/**
 * Where a row goes. Activities have no detail page of their own worth landing
 * on, so they open the RECORD they belong to (opportunity > contact > account,
 * decided server-side) whose timeline shows the item. An activity attached to
 * nothing falls back to the Activities list.
 */
function rowTarget(
  key: SearchGroupKey,
  entity: SearchEntity,
  row: SearchRow,
  query: string,
): string {
  if (key !== "activities") return `${ENTITY_VISUALS[entity].route}/${row.id}`;
  if (row.related_entity && row.related_id && ENTITY_VISUALS[row.related_entity]) {
    return `${ENTITY_VISUALS[row.related_entity].route}/${row.related_id}`;
  }
  return `/activities?q=${encodeURIComponent(query)}`;
}

/** "8" when everything is shown, else "8 of 23" / "8 of 50+" at the cap. */
function countLabel(shown: number, total: number): string {
  if (total <= shown) return String(shown);
  return `${shown} of ${total >= TOTAL_CAP ? `${TOTAL_CAP}+` : total}`;
}

/**
 * cmdk's root keydown handler claims Enter unconditionally — it preventDefaults
 * and clicks the highlighted RESULT no matter what's focused. Without this, a
 * user who tabs to a scope chip or a "See all" link and hits Enter gets sent to
 * whichever row happened to be highlighted. Stopping the key here lets the
 * button activate natively; arrow keys still fall through to cmdk, so the list
 * keeps responding to Up/Down from anywhere in the dialog.
 */
function stopActivationKeys(e: ReactKeyboardEvent<HTMLButtonElement>) {
  if (e.key === "Enter" || e.key === " ") e.stopPropagation();
}

// ── Component ────────────────────────────────────────────────────────

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [scope, setScope] = useState<Scope>("all");
  const navigate = useNavigate();
  const { records: allRecents, refresh: refreshRecents } = useRecentRecords();

  // The lead type is retired — stale "lead" recents (from before the cutover)
  // stay hidden for everyone.
  const recentRecords = allRecents.filter(
    (r): r is RecentRecord & { entity: SearchEntity } => r.entity !== "lead",
  );

  // This palette instance lives in the top bar for the whole session, so its
  // recents snapshot goes stale — re-read storage every time it opens.
  useEffect(() => {
    if (open) refreshRecents();
  }, [open, refreshRecents]);

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(inputValue), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) {
      setInputValue("");
      setDebouncedQuery("");
      setScope("all");
    }
  }, []);

  const trimmedQuery = debouncedQuery.trim();
  const searchEnabled = trimmedQuery.length >= MIN_SEARCH_LENGTH;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["global-search-v2", trimmedQuery],
    queryFn: async () => {
      const { data: rpcData, error } = await supabase.rpc("global_search_v2", {
        q: trimmedQuery,
        per_group: RESULTS_PER_GROUP,
      });
      if (error) throw error;
      return (rpcData ?? EMPTY_RESPONSE) as SearchResponse;
    },
    enabled: searchEnabled,
    // Hold the previous results on screen while the next query is in flight,
    // so the list doesn't blank out between keystrokes.
    placeholderData: keepPreviousData,
  });

  const result = data ?? EMPTY_RESPONSE;

  const visibleGroups = useMemo(
    () => GROUPS.filter((g) => scope === "all" || scope === g.key),
    [scope],
  );

  const hasResults = GROUPS.some((g) => (result[g.key]?.rows.length ?? 0) > 0);
  const hasVisibleResults = visibleGroups.some(
    (g) => (result[g.key]?.rows.length ?? 0) > 0,
  );

  const totalAcross = visibleGroups.reduce(
    (sum, g) => sum + (result[g.key]?.total ?? 0),
    0,
  );
  const totalCapped = visibleGroups.some(
    (g) => (result[g.key]?.total ?? 0) >= TOTAL_CAP,
  );

  // Distinguish "still searching" and "search failed" from "genuinely empty",
  // so the palette never flashes a false "No matches" mid-keystroke or hides a
  // real error as an empty CRM.
  const showSkeletons = searchEnabled && isFetching && !hasResults;
  const showEmpty =
    searchEnabled && !isFetching && !isError && !hasVisibleResults;

  function handleSelect(path: string) {
    handleOpenChange(false);
    navigate(path);
  }

  return (
    <>
      {/* Trigger button for the top bar */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Search className="h-4 w-4" />
        <span className="hidden sm:inline">Search...</span>
        <kbd className="pointer-events-none hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
          <span className="text-xs">&#8984;</span>K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Global Search"
        description="Search accounts, contacts, deals, emails and notes"
        className="sm:max-w-2xl"
        // The cmdk defaults baked into CommandDialog force 20px item icons and
        // py-3 rows, and they out-specify anything set on an individual
        // CommandItem. Opt out so the 24px gradient chips fit their rows.
        commandClassName="[&_[cmdk-item]]:py-2 [&_[cmdk-item]_svg]:h-3.5 [&_[cmdk-item]_svg]:w-3.5"
        // Results arrive server-filtered; cmdk's own fuzzy filter would hide
        // most of them and make the input look stuck.
        shouldFilter={false}
      >
        <CommandInput
          placeholder="Search accounts, contacts, deals, emails, notes…"
          value={inputValue}
          onValueChange={setInputValue}
        />

        {/* Scope chips. Client-side only — the RPC always returns all four
            groups, so switching scope is instant and costs no round trip.
            They're plain buttons, so Tab cycles them for free and ↑↓/Enter
            stay with cmdk. Hidden before a search, where they'd be inert. */}
        {searchEnabled && (
          <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
            {SCOPES.map((s) => {
              const active = scope === s.value;
              const count =
                s.value === "all" ? null : (result[s.value]?.total ?? 0);
              return (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setScope(s.value)}
                  onKeyDown={stopActivationKeys}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                    active
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.label}
                  {count ? (
                    <span className="ml-1 tabular-nums opacity-70">
                      {count >= TOTAL_CAP ? `${TOTAL_CAP}+` : count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}

        <CommandList className="max-h-[420px]">
          {showSkeletons && (
            <div className="space-y-1 p-2" aria-label="Searching">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-9 rounded-lg" />
              ))}
            </div>
          )}

          {searchEnabled && isError && !hasResults && (
            <div className="py-6 text-center text-sm text-destructive">
              Search failed — try again.
            </div>
          )}

          {showEmpty && (
            <CommandEmpty>
              No matches for &ldquo;{trimmedQuery}&rdquo; — try fewer words.
            </CommandEmpty>
          )}

          {/* Before the user types: recently-viewed records. */}
          {!searchEnabled && recentRecords.length > 0 && (
            <>
              <div
                role="presentation"
                className="px-3 pt-3 pb-1 text-xs uppercase tracking-wide text-muted-foreground"
              >
                Recent
              </div>
              {recentRecords.map((record) => {
                const visual = ENTITY_VISUALS[record.entity];
                const Icon = visual.Icon;
                return (
                  <CommandItem
                    key={`${record.entity}-${record.id}`}
                    value={`recent-${record.entity}-${record.id}`}
                    onSelect={() =>
                      handleSelect(`${visual.route}/${record.id}`)
                    }
                    className="rounded-lg px-2 py-2"
                  >
                    <span className={cn(ENTITY_CHIP_CLASS, visual.badge)}>
                      <Icon className={cn("h-3.5 w-3.5", visual.iconColor)} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {record.name}
                    </span>
                  </CommandItem>
                );
              })}
              <p className="px-3 pt-2 pb-3 text-[11px] text-muted-foreground">
                Tip: search emails and notes by any phrase, accounts by city,
                deals by company.
              </p>
            </>
          )}

          {!searchEnabled && recentRecords.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              Start typing to search…
              <p className="mt-1 text-[11px]">
                Tip: search emails and notes by any phrase, accounts by city,
                deals by company.
              </p>
            </div>
          )}

          {searchEnabled &&
            visibleGroups.map(({ key, entity }) => {
              const group = result[key];
              if (!group || group.rows.length === 0) return null;
              const visual = ENTITY_VISUALS[entity];

              return (
                <div key={key} role="presentation">
                  {/* Group header. Deliberately NOT cmdk's `heading` prop:
                      cmdk marks that node aria-hidden, and a focusable "See
                      all" inside an aria-hidden container is both an a11y
                      violation and unreachable by keyboard. */}
                  <div
                    role="presentation"
                    className="flex items-center justify-between gap-2 px-3 pt-3 pb-1"
                  >
                    <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                      {visual.plural}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums normal-case">
                        {countLabel(group.rows.length, group.total)}
                      </span>
                    </span>
                    {/* All four lists already read ?q= (useDebouncedUrlState),
                        so these land pre-filtered with no wiring needed. One
                        asymmetry to know about: ActivitiesListPage filters on
                        `subject` only, so a body-only match shows here but not
                        on its See-all page. Widening that list's filter to
                        body is a separate change to that file. */}
                    <button
                      type="button"
                      onClick={() =>
                        handleSelect(
                          `${visual.route}?q=${encodeURIComponent(trimmedQuery)}`,
                        )
                      }
                      onKeyDown={stopActivationKeys}
                      className="text-xs text-primary underline underline-offset-4 hover:text-primary/80"
                    >
                      See all &rarr;
                    </button>
                  </div>

                  {group.rows.map((row) => {
                    const Icon =
                      key === "activities"
                        ? activityIcon(row.meta)
                        : visual.Icon;
                    const meta = rowMeta(key, row);
                    return (
                      <CommandItem
                        key={row.id}
                        value={`${key}-${row.id}`}
                        onSelect={() =>
                          handleSelect(
                            rowTarget(key, entity, row, trimmedQuery),
                          )
                        }
                        className="rounded-lg px-2 py-2"
                      >
                        <span className={cn(ENTITY_CHIP_CLASS, visual.badge)}>
                          <Icon className={cn("h-3.5 w-3.5", visual.iconColor)} />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">
                            {highlightMatch(row.label, trimmedQuery)}
                          </span>
                          {row.sublabel && (
                            <span className="truncate text-xs text-muted-foreground">
                              {highlightMatch(row.sublabel, trimmedQuery)}
                            </span>
                          )}
                        </span>
                        {meta && (
                          <span
                            className={cn(
                              "shrink-0 text-xs text-muted-foreground",
                              key === "opportunities" && "tabular-nums",
                            )}
                          >
                            {meta}
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </div>
              );
            })}
        </CommandList>

        {/* Footer hint bar: states the keyboard model and the result count. */}
        <div className="flex items-center justify-between border-t px-3 py-2">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                &uarr;&darr;
              </kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                &crarr;
              </kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                esc
              </kbd>
              close
            </span>
          </div>
          {searchEnabled && hasVisibleResults && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {totalAcross}
              {totalCapped ? "+" : ""} result{totalAcross === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </CommandDialog>
    </>
  );
}
