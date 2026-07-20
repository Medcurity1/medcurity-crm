import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, Users, Target, Search, Inbox } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { formatCurrency, customerStatusLabel } from "@/lib/formatters";
import { buildPersonSearchClause } from "@/lib/search-clause";
import { useRecentRecords, type RecentRecord } from "@/hooks/useRecentRecords";
import type {
  Account,
  Contact,
  Opportunity,
  Lead,
  OpportunityStage,
  LeadStatus,
} from "@/types/crm";

type AccountResult = Pick<Account, "id" | "name" | "customer_status">;
type ContactResult = Pick<Contact, "id" | "first_name" | "last_name" | "email">;
type OpportunityResult = Pick<Opportunity, "id" | "name" | "stage" | "amount">;
type LeadResult = Pick<Lead, "id" | "first_name" | "last_name" | "email" | "company" | "status">;

// Snappier search: results start after a single character and with a shorter
// debounce, so typing "M" to find Mary feels instant instead of laggy.
const DEBOUNCE_MS = 150;
const MIN_SEARCH_LENGTH = 1;
// Per-entity cap shown in the dropdown after re-ranking.
const RESULTS_PER_ENTITY = 10;
// Fetch a wider net from the DB so we can re-rank prefix matches
// above substring matches. With the old limit=5 and no order, an
// arbitrary 5 substring matches could come back and bury the
// actual prefix match (e.g. "entre" returned "Endoscopic Surgical
// Centre of Maryland" before "Entre Technology Services").
const FETCH_LIMIT = 40;

/**
 * Re-rank server results so prefix matches on the displayed label
 * float to the top, then case-insensitive alphabetical. The DB
 * uses plain ilike '%q%' which doesn't distinguish prefix from
 * mid-string matches; this is the cheapest fix that doesn't
 * require a pg_trgm/ts_vector migration.
 */
function rankResults<T>(rows: T[] | undefined, query: string, labelOf: (row: T) => string): T[] {
  if (!rows) return [];
  const q = query.toLowerCase();
  return [...rows].sort((a, b) => {
    const la = labelOf(a).toLowerCase();
    const lb = labelOf(b).toLowerCase();
    const aPrefix = la.startsWith(q) ? 0 : 1;
    const bPrefix = lb.startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return la.localeCompare(lb);
  });
}

const stageLabels: Record<OpportunityStage, string> = {
  details_analysis: "Details Analysis",
  demo: "Demo",
  proposal_and_price_quote: "Proposal and Price Quote",
  proposal_conversation: "Proposal Conversation",
  closed_won: "Closed Won",
  closed_lost: "Closed Lost",
  // Legacy labels — kept for history rows only
  lead: "Lead",
  qualified: "Qualified",
  proposal: "Proposal",
  verbal_commit: "Verbal Commit",
};

const leadStatusLabels: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  unqualified: "Unqualified",
  converted: "Converted",
};

// Icon + route per recent-record entity (see useRecentRecords) for the
// "Recent" group shown before the user types anything.
const recentIcons: Record<RecentRecord["entity"], typeof Building2> = {
  account: Building2,
  contact: Users,
  opportunity: Target,
  lead: Inbox,
};

const recentPaths: Record<RecentRecord["entity"], string> = {
  account: "/accounts",
  contact: "/contacts",
  opportunity: "/opportunities",
  lead: "/imports",
};

export function GlobalSearch() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const navigate = useNavigate();
  const { records: allRecents, refresh: refreshRecents } = useRecentRecords();
  // Leads are admin-only everywhere else in the app — keep the Recent
  // group consistent with that gate.
  const recentRecords = isAdmin
    ? allRecents
    : allRecents.filter((r) => r.entity !== "lead");

  // This palette instance lives in the top bar for the whole session, so
  // its recents snapshot goes stale — re-read storage every time it opens.
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

  // Debounce input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(inputValue);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // Reset input on close
  const handleOpenChange = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) {
      setInputValue("");
      setDebouncedQuery("");
    }
  }, []);

  const searchEnabled = debouncedQuery.length >= MIN_SEARCH_LENGTH;
  const searchPattern = `%${debouncedQuery}%`;

  const { data: accounts, isFetching: accountsFetching, isError: accountsError } = useQuery({
    queryKey: ["global-search", "accounts", debouncedQuery],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, customer_status")
        .is("archived_at", null)
        .ilike("name", searchPattern)
        .limit(FETCH_LIMIT);
      if (error) throw error;
      return data as AccountResult[];
    },
    enabled: searchEnabled,
  });

  const { data: contacts, isFetching: contactsFetching, isError: contactsError } = useQuery({
    queryKey: ["global-search", "contacts", debouncedQuery],
    queryFn: async () => {
      const orClause = buildPersonSearchClause(debouncedQuery, [
        "first_name",
        "last_name",
        "email",
        "email2",
        "email3",
      ]);
      let q = supabase
        .from("contacts")
        .select("id, first_name, last_name, email")
        .is("archived_at", null)
        // Pending imports are pen-only until promoted.
        .is("import_status", null);
      if (orClause) q = q.or(orClause);
      const { data, error } = await q.limit(FETCH_LIMIT);
      if (error) throw error;
      return data as ContactResult[];
    },
    enabled: searchEnabled,
  });

  const { data: opportunities, isFetching: opportunitiesFetching, isError: opportunitiesError } = useQuery({
    queryKey: ["global-search", "opportunities", debouncedQuery],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("id, name, stage, amount")
        .is("archived_at", null)
        .ilike("name", searchPattern)
        .limit(FETCH_LIMIT);
      if (error) throw error;
      return data as OpportunityResult[];
    },
    enabled: searchEnabled,
  });

  const { data: leads, isFetching: leadsFetching, isError: leadsError } = useQuery({
    queryKey: ["global-search", "leads", debouncedQuery],
    queryFn: async () => {
      const orClause = buildPersonSearchClause(debouncedQuery, [
        "first_name",
        "last_name",
        "email",
        "company",
      ]);
      // Hide converted + archived leads from global search.
      // A converted lead is a tombstone — the person now lives as a
      // contact, and surfacing both in search makes reps think the
      // conversion didn't take. Archived leads are user-archived and
      // intentionally out of working views.
      let q = supabase
        .from("leads")
        .select("id, first_name, last_name, email, company, status")
        .is("archived_at", null)
        .is("converted_at", null);
      if (orClause) q = q.or(orClause);
      const { data, error } = await q.limit(FETCH_LIMIT);
      if (error) throw error;
      return data as LeadResult[];
    },
    // Leads are admin-only — don't surface them in non-admins' search.
    enabled: searchEnabled && isAdmin,
  });

  function handleSelect(path: string) {
    handleOpenChange(false);
    navigate(path);
  }

  // Re-rank: prefix matches first, then alphabetical. Capped at
  // RESULTS_PER_ENTITY per group after ranking.
  const rankedAccounts = rankResults(accounts, debouncedQuery, (r) => r.name).slice(
    0,
    RESULTS_PER_ENTITY,
  );
  const rankedContacts = rankResults(
    contacts,
    debouncedQuery,
    (r) => `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
  ).slice(0, RESULTS_PER_ENTITY);
  const rankedOpportunities = rankResults(opportunities, debouncedQuery, (r) => r.name).slice(
    0,
    RESULTS_PER_ENTITY,
  );
  const rankedLeads = rankResults(
    leads,
    debouncedQuery,
    (r) => `${r.first_name ?? ""} ${r.last_name ?? ""} ${r.company ?? ""}`.trim(),
  ).slice(0, RESULTS_PER_ENTITY);

  const hasResults =
    rankedAccounts.length > 0 ||
    rankedContacts.length > 0 ||
    rankedOpportunities.length > 0 ||
    rankedLeads.length > 0;

  // Distinguish "still searching" and "search failed" from "genuinely empty"
  // so the palette never flashes a false "No results" mid-keystroke or hides
  // a real error as an empty CRM.
  const anyFetching =
    searchEnabled &&
    (accountsFetching || contactsFetching || opportunitiesFetching || (isAdmin && leadsFetching));
  const anyError =
    accountsError || contactsError || opportunitiesError || (isAdmin && leadsError);

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
        description="Search across accounts, contacts, and opportunities"
        // cmdk filters items client-side by default (fuzzy-matching the `value`
        // attr against the typed query). Our results come back already
        // server-filtered via Supabase ilike, so cmdk's filter just hides most
        // of them and can make the input appear "stuck" — results look empty
        // no matter what you type. Disable it so everything we render shows.
        shouldFilter={false}
      >
        <CommandInput
          placeholder="Search accounts, contacts, opportunities..."
          value={inputValue}
          onValueChange={setInputValue}
        />
        <CommandList>
          {searchEnabled && !hasResults && anyFetching && (
            <div className="py-6 text-center text-sm text-muted-foreground">Searching…</div>
          )}
          {searchEnabled && !hasResults && !anyFetching && anyError && (
            <div className="py-6 text-center text-sm text-destructive">
              Search failed — try again.
            </div>
          )}
          {searchEnabled && !hasResults && !anyFetching && !anyError && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}

          {/* Before the user types: recently-viewed records (from
              useRecentRecords localStorage), or a hint when there are none. */}
          {!searchEnabled && recentRecords.length > 0 && (
            <CommandGroup heading="Recent">
              {recentRecords.map((record) => {
                const Icon = recentIcons[record.entity];
                return (
                  <CommandItem
                    key={`${record.entity}-${record.id}`}
                    value={`recent-${record.entity}-${record.name}-${record.id}`}
                    onSelect={() => handleSelect(`${recentPaths[record.entity]}/${record.id}`)}
                  >
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{record.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          {!searchEnabled && recentRecords.length === 0 && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Start typing to search…
            </div>
          )}

          {rankedAccounts.length > 0 && (
            <CommandGroup heading="Accounts">
              {rankedAccounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={`account-${account.name}-${account.id}`}
                  onSelect={() => handleSelect(`/accounts/${account.id}`)}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{account.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {customerStatusLabel(account.customer_status)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {rankedContacts.length > 0 && (
            <CommandGroup heading="Contacts">
              {rankedContacts.map((contact) => (
                <CommandItem
                  key={contact.id}
                  value={`contact-${contact.first_name} ${contact.last_name}-${contact.id}`}
                  onSelect={() => handleSelect(`/contacts/${contact.id}`)}
                >
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">
                    {contact.first_name} {contact.last_name}
                  </span>
                  {contact.email && (
                    <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                      {contact.email}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {rankedOpportunities.length > 0 && (
            <CommandGroup heading="Opportunities">
              {rankedOpportunities.map((opp) => (
                <CommandItem
                  key={opp.id}
                  value={`opportunity-${opp.name}-${opp.id}`}
                  onSelect={() =>
                    handleSelect(`/opportunities/${opp.id}`)
                  }
                >
                  <Target className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{opp.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {stageLabels[opp.stage]} &middot; {formatCurrency(opp.amount)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {rankedLeads.length > 0 && (
            <CommandGroup heading="Imports">
              {rankedLeads.map((lead) => (
                <CommandItem
                  key={lead.id}
                  value={`lead-${lead.first_name} ${lead.last_name}-${lead.id}`}
                  onSelect={() => handleSelect(`/imports/${lead.id}`)}
                >
                  <Inbox className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">
                    {lead.first_name} {lead.last_name}
                    {lead.company && (
                      <span className="text-muted-foreground"> — {lead.company}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {leadStatusLabels[lead.status]}
                    {lead.email && ` · ${lead.email}`}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
