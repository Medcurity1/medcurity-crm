// Searchable single-select account picker over the already-cached
// useAccountsList() data. Replaces the plain <Select> account dropdowns
// (OpportunityForm, ContactForm) that couldn't be typed into — with
// thousands of accounts, scroll-to-find was unusable.
//
// Unlike reports/RelationCombobox (which searches server-side because the
// ReportBuilder only had a capped 25-row lookup), the full accounts list is
// already in the react-query cache here, so cmdk's default client-side
// filtering over item values (= account names) is all we need.

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useAccountsList } from "@/features/accounts/api";

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
  const { data: accounts } = useAccountsList();

  // Resolve the trigger label from the same cached list. A set value that
  // isn't in the (non-archived) list — e.g. editing a contact whose account
  // was archived later — still shows a marker instead of pretending nothing
  // is selected.
  const selectedLabel = value
    ? accounts?.find((a) => a.id === value)?.name ??
      (accounts ? "(archived account)" : "Loading…")
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
        {/* Default cmdk filtering ON — items carry the account name as their
            value, so typing narrows by name with no extra wiring. */}
        <Command>
          <CommandInput placeholder="Search accounts…" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
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
              {(accounts ?? []).map((a) => (
                <CommandItem
                  key={a.id}
                  value={a.name}
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
