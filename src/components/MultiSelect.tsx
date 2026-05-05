import { useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Multi-select filter dropdown. Behaves like the shadcn Select
 * trigger (same width / styling) but the popover lists checkbox-style
 * options the user can toggle freely. Empty selection = "no filter
 * applied" — pair with `useUrlArrayState` so filters are bookmarkable.
 *
 * Pattern lifted from Salesforce's list-view filters: the trigger
 * label collapses to "X selected" once you pick more than one option
 * to keep the toolbar from blowing out.
 */
export function MultiSelect({
  options,
  value,
  onChange,
  placeholder = "All",
  className,
  triggerClassName,
}: {
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);

  const triggerLabel = (() => {
    if (!value.length) return placeholder;
    if (value.length === 1) {
      return options.find((o) => o.value === value[0])?.label ?? value[0];
    }
    return `${value.length} selected`;
  })();

  function toggle(v: string) {
    if (value.includes(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  return (
    <div className={cn("relative inline-flex", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "justify-between font-normal",
              !value.length && "text-muted-foreground",
              triggerClassName
            )}
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        {/* bg-popover is applied by PopoverContent already, but we
            re-assert it here so that even when this MultiSelect is used
            inside a Dialog (which renders a dim backdrop), nothing
            beneath the popover bleeds through and makes options look
            translucent. Native overflow-y-auto + a fixed max-height
            scrolls reliably on long lists (e.g. the 24-item Industry
            picker) — Radix ScrollArea's display-table inner wrapper
            can swallow scroll inside popovers. */}
        <PopoverContent
          className="w-64 p-0 bg-popover text-popover-foreground"
          align="start"
        >
          <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground border-b bg-popover">
            <span>{value.length} selected</span>
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="hover:text-foreground inline-flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto overscroll-contain p-1">
            {options.map((opt) => {
              const checked = value.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    "w-full flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    checked && "bg-accent text-accent-foreground"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-sm border",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background"
                    )}
                  >
                    {checked && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate text-left">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
