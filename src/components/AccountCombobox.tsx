// Searchable single-select account picker.
//
// Searches accounts SERVER-SIDE (typed query + a small LIMIT), mirroring
// reports/RelationCombobox. The previous version fetched the ENTIRE
// non-archived roster (~thousands of rows) into every opp/contact form via
// useAccountsList and rendered one un-virtualized <CommandItem> per account,
// spiking the popover open on the hottest create/edit flows. Server search
// keeps the list to ~50 rows and the payload tiny.

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useAccounts, useAccount } from "@/features/accounts/api";

export function AccountCombobox({
  value,
  onChange,
  placeholder = "Select account…",
  disabled = false,
  allowClear = false,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Debounce the typed query so we fire one server search after the user
  // pauses, not one per keystroke.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isFetching } = useAccounts({
    search: debounced || undefined,
    pageSize: 50,
  });
  const accounts = data?.data ?? [];

  // Always resolve the currently-selected account's label, even when it isn't
  // in the (search-narrowed) result page — fetch it by id. Works for archived
  // accounts too (e.g. editing a contact whose account was archived later).
  const { data: selectedAccount } = useAccount(value ?? undefined);
  const selectedLabel = value
    ? accounts.find((a) => a.id === value)?.name ??
      selectedAccount?.name ??
      "Loading…"
    : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>
            {selectedLabel || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        {/* shouldFilter off — the server already narrowed to matches; cmdk must
            not re-filter the 50-row page against the raw input. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search accounts…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{isFetching ? "Searching…" : "No matches."}</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value="— None —"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                  <span className="text-muted-foreground">— None —</span>
                </CommandItem>
              )}
              {accounts.map((a) => (
                <CommandItem
                  key={a.id}
                  // Unique value (name::id) so same-named accounts don't collide.
                  value={`${a.name}::${a.id}`}
                  onSelect={() => {
                    onChange(a.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === a.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{a.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
