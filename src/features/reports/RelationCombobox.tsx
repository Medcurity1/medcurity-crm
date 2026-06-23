// Type-to-search picker for relation filters (Account / Contact / Owner /
// Opportunity) in the Report Builder. Replaces a plain <Select> that both
// couldn't be searched AND silently showed only the first ~25 accounts.
// Accounts are searched SERVER-SIDE (the list is long); the others filter
// client-side over the lookups they already have.

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useAccounts } from "@/features/accounts/api";

export function RelationCombobox({
  type,
  value,
  onChange,
  options,
}: {
  type: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<{ value: string; label: string } | null>(null);
  const isAccount = type === "account";

  // Accounts: server-side search (their ilike path covers name + parent-by-contact).
  const { data: acctResult, isFetching } = useAccounts(
    isAccount ? { search: search.trim() || undefined, pageSize: 50 } : undefined,
  );
  const items = isAccount
    ? (acctResult?.data ?? []).map((a: { id: string; name: string }) => ({ value: a.id, label: a.name }))
    : options;

  // Keep the trigger label stable even after the search list changes/clears.
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
        {/* shouldFilter off for accounts (server-filtered); on for the rest. */}
        <Command shouldFilter={!isAccount}>
          <CommandInput placeholder="Search…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{isAccount && isFetching ? "Searching…" : "No matches."}</CommandEmpty>
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
