// Type-to-search picker for relation filters (Account / Contact / Opportunity /
// Owner) in the Report Builder. Replaces a plain <Select> that both couldn't be
// searched AND silently showed only the first ~25 rows.
//
// Account, Contact, and Opportunity are searched SERVER-SIDE (those lists are
// long — capping them at the ReportBuilder's 25-row lookup hid most records).
// Owner/user (a short, fully-loaded list) filters client-side over the options
// it's handed. Each relation type mounts exactly ONE data hook (via a dedicated
// component) so we never fire queries for lists we aren't showing.

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useAccounts } from "@/features/accounts/api";
import { useContacts } from "@/features/contacts/api";
import { useOpportunities } from "@/features/opportunities/api";

type Opt = { value: string; label: string };

export function RelationCombobox(props: {
  type: string;
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
}) {
  // Dispatch to a type-specific component so only the relevant data hook runs.
  switch (props.type) {
    case "account":
      return <AccountCombo {...props} />;
    case "contact":
      return <ContactCombo {...props} />;
    case "opportunity":
      return <OpportunityCombo {...props} />;
    default:
      // Owner/user and anything else: client-side filter over the given options.
      return <StaticCombo {...props} />;
  }
}

// ── Server-searched variants ─────────────────────────────────────────────────

function AccountCombo({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Opt[] }) {
  const [search, setSearch] = useState("");
  const { data, isFetching } = useAccounts({ search: search.trim() || undefined, pageSize: 50 });
  const items = (data?.data ?? []).map((a: { id: string; name: string }) => ({ value: a.id, label: a.name }));
  return <Shell {...{ value, onChange, options, items, isFetching, search, setSearch, serverFiltered: true }} />;
}

function ContactCombo({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Opt[] }) {
  const [search, setSearch] = useState("");
  const { data, isFetching } = useContacts({ search: search.trim() || undefined, pageSize: 50 });
  const items = (data?.data ?? []).map((c: { id: string; first_name?: string | null; last_name?: string | null }) => ({
    value: c.id,
    label: [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)",
  }));
  return <Shell {...{ value, onChange, options, items, isFetching, search, setSearch, serverFiltered: true }} />;
}

function OpportunityCombo({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Opt[] }) {
  const [search, setSearch] = useState("");
  const { data, isFetching } = useOpportunities({ search: search.trim() || undefined, pageSize: 50 });
  const items = (data?.data ?? []).map((o: { id: string; name?: string | null }) => ({ value: o.id, label: o.name || "(untitled)" }));
  return <Shell {...{ value, onChange, options, items, isFetching, search, setSearch, serverFiltered: true }} />;
}

function StaticCombo({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: Opt[] }) {
  const [search, setSearch] = useState("");
  return <Shell {...{ value, onChange, options, items: options, isFetching: false, search, setSearch, serverFiltered: false }} />;
}

// ── Shared presentational shell ──────────────────────────────────────────────

function Shell({
  value, onChange, options, items, isFetching, search, setSearch, serverFiltered,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Opt[];
  items: Opt[];
  isFetching: boolean;
  search: string;
  setSearch: (s: string) => void;
  serverFiltered: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Opt | null>(null);

  // Keep the trigger label stable even after the (search-narrowed) list changes:
  // prefer what the user actually picked, then the current items, then the
  // ReportBuilder-supplied options (label fallback), then a generic marker.
  const selectedLabel =
    (value && picked?.value === value && picked.label) ||
    items.find((o) => o.value === value)?.label ||
    options.find((o) => o.value === value)?.label ||
    (value ? "Selected" : "");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-52 justify-between font-normal">
          <span className="truncate">{selectedLabel || "Select…"}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        {/* shouldFilter off for server-searched lists; on for static ones. */}
        <Command shouldFilter={!serverFiltered}>
          <CommandInput placeholder="Search…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{serverFiltered && isFetching ? "Searching…" : "No matches."}</CommandEmpty>
            <CommandGroup>
              {items.map((o) => (
                <CommandItem
                  key={o.value}
                  value={`${o.label}::${o.value}`}
                  onSelect={() => {
                    onChange(o.value);
                    setPicked({ value: o.value, label: o.label });
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
