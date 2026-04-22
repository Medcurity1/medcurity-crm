import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, Users, Target, Search, UserPlus } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { supabase } from "@/lib/supabase";
import { formatCurrency } from "@/lib/formatters";
import type {
  Account,
  Contact,
  Opportunity,
  Lead,
  AccountLifecycle,
  OpportunityStage,
  LeadStatus,
} from "@/types/crm";

type AccountResult = Pick<Account, "id" | "name" | "lifecycle_status">;
type ContactResult = Pick<Contact, "id" | "first_name" | "last_name" | "email">;
type OpportunityResult = Pick<Opportunity, "id" | "name" | "stage" | "amount">;
type LeadResult = Pick<Lead, "id" | "first_name" | "last_name" | "email" | "company" | "status">;

const DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;
const RESULTS_PER_ENTITY = 5;

const lifecycleLabels: Record<AccountLifecycle, string> = {
  prospect: "Prospect",
  customer: "Customer",
  former_customer: "Former Customer",
};

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

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const navigate = useNavigate();

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

  const { data: accounts } = useQuery({
    queryKey: ["global-search", "accounts", debouncedQuery],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, name, lifecycle_status")
        .is("archived_at", null)
        .ilike("name", searchPattern)
        .limit(RESULTS_PER_ENTITY);
      if (error) throw error;
      return data as AccountResult[];
    },
    enabled: searchEnabled,
  });

  const { data: contacts } = useQuery({
    queryKey: ["global-search", "contacts", debouncedQuery],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, email")
        .is("archived_at", null)
        .or(
          `first_name.ilike.${searchPattern},last_name.ilike.${searchPattern},email.ilike.${searchPattern}`
        )
        .limit(RESULTS_PER_ENTITY);
      if (error) throw error;
      return data as ContactResult[];
    },
    enabled: searchEnabled,
  });

  const { data: opportunities } = useQuery({
    queryKey: ["global-search", "opportunities", debouncedQuery],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("id, name, stage, amount")
        .is("archived_at", null)
        .ilike("name", searchPattern)
        .limit(RESULTS_PER_ENTITY);
      if (error) throw error;
      return data as OpportunityResult[];
    },
    enabled: searchEnabled,
  });

  const { data: leads } = useQuery({
    queryKey: ["global-search", "leads", debouncedQuery],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, email, company, status")
        .or(
          `first_name.ilike.${searchPattern},last_name.ilike.${searchPattern},email.ilike.${searchPattern},company.ilike.${searchPattern}`
        )
        .limit(RESULTS_PER_ENTITY);
      if (error) throw error;
      return data as LeadResult[];
    },
    enabled: searchEnabled,
  });

  function handleSelect(path: string) {
    handleOpenChange(false);
    navigate(path);
  }

  const hasResults =
    (accounts && accounts.length > 0) ||
    (contacts && contacts.length > 0) ||
    (opportunities && opportunities.length > 0) ||
    (leads && leads.length > 0);

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
        description="Search across accounts, contacts, opportunities, and leads"
        // cmdk filters items client-side by default (fuzzy-matching the `value`
        // attr against the typed query). Our results come back already
        // server-filtered via Supabase ilike, so cmdk's filter just hides most
        // of them and can make the input appear "stuck" — results look empty
        // no matter what you type. Disable it so everything we render shows.
        shouldFilter={false}
      >
        <CommandInput
          placeholder="Search accounts, contacts, opportunities, leads..."
          value={inputValue}
          onValueChange={setInputValue}
        />
        <CommandList>
          {searchEnabled && !hasResults && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}

          {!searchEnabled && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search...
            </div>
          )}

          {accounts && accounts.length > 0 && (
            <CommandGroup heading="Accounts">
              {accounts.map((account) => (
                <CommandItem
                  key={account.id}
                  value={`account-${account.name}`}
                  onSelect={() => handleSelect(`/accounts/${account.id}`)}
                >
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{account.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {lifecycleLabels[account.lifecycle_status]}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {contacts && contacts.length > 0 && (
            <CommandGroup heading="Contacts">
              {contacts.map((contact) => (
                <CommandItem
                  key={contact.id}
                  value={`contact-${contact.first_name} ${contact.last_name}`}
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

          {opportunities && opportunities.length > 0 && (
            <CommandGroup heading="Opportunities">
              {opportunities.map((opp) => (
                <CommandItem
                  key={opp.id}
                  value={`opportunity-${opp.name}`}
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

          {leads && leads.length > 0 && (
            <CommandGroup heading="Leads">
              {leads.map((lead) => (
                <CommandItem
                  key={lead.id}
                  value={`lead-${lead.first_name} ${lead.last_name}`}
                  onSelect={() => handleSelect(`/leads/${lead.id}`)}
                >
                  <UserPlus className="h-4 w-4 text-muted-foreground" />
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
