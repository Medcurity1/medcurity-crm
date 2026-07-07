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
        {/* When this MultiSelect is opened inside a Dialog (e.g. the
            Lead List filter editor), three things go wrong with the
            naive shadcn defaults:
              1. PopoverContent gets clipped by the available viewport
                 height without exposing a scrollbar — Radix sets
                 `--radix-popover-content-available-height` for exactly
                 this case, so we cap our scroll container by both that
                 and a max of 18rem.
              2. `overscroll-contain` on a nested scroller, combined
                 with Dialog's body-scroll-lock, can swallow wheel
                 events. Drop it; the popover is portaled at body level
                 so chained scroll isn't a hazard anyway.
              3. Without `bg-popover` re-asserted, a Dialog's dim
                 backdrop bleeds through and makes options look
                 translucent.
            We also force `pointer-events-auto` on the inner scroller
            because Radix Dialog sets `pointer-events: none` on body in
            modal mode and the portaled popover inherits it. */}
        <PopoverContent
          className="w-64 p-0 bg-popover text-popover-foreground pointer-events-auto"
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
          <div
            className="overflow-y-auto p-1"
            style={{
              maxHeight:
                "min(18rem, var(--radix-popover-content-available-height, 18rem))",
            }}
            // When this popover is portaled out of a MODAL Dialog/Sheet (e.g.
            // the Nexus widget-builder Sheet), the modal's react-remove-scroll
            // lock listens for wheel/touch on document and cancels them — so
            // the portaled list won't scroll. Stopping propagation here keeps
            // the event from reaching that lock; native scroll on this div then
            // works. Fixes "can't scroll owners" in the Nexus custom report.
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
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
