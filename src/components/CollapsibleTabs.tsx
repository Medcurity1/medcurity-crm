import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CollapsibleTabsItem {
  value: string;
  label: string;
  /** Rendered lazily when the tab is open + selected. */
  content: ReactNode;
}

/**
 * Tab group with the button row pinned at the top and the selected tab's
 * content collapsible. Defaults to closed so the detail page isn't
 * immediately flooded with related records; click any tab button to expand
 * to that tab, click the chevron to toggle.
 *
 * - TabsList stays visible always (rep can see the related-record counts
 *   and Tabs at a glance even when collapsed).
 * - Clicking the currently-open tab collapses the panel.
 * - Clicking a different tab switches + keeps it open.
 */
export function CollapsibleTabs({
  items,
  defaultValue,
  defaultOpen = false,
  className,
}: {
  items: CollapsibleTabsItem[];
  defaultValue: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState(defaultValue);

  function handleTabChange(next: string) {
    // Clicking the already-open tab toggles collapse instead of re-opening.
    if (open && next === value) {
      setOpen(false);
      return;
    }
    setValue(next);
    setOpen(true);
  }

  return (
    <Tabs
      value={value}
      onValueChange={handleTabChange}
      className={cn("mb-4", className)}
    >
      <div className="flex items-center justify-between gap-2 border rounded-lg px-2 py-1 bg-card">
        <TabsList className="bg-transparent">
          {items.map((i) => (
            <TabsTrigger key={i.value} value={i.value}>
              {i.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Collapse" : "Expand"}
          title={open ? "Collapse related records" : "Expand related records"}
          className="shrink-0"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              !open && "-rotate-90"
            )}
          />
        </Button>
      </div>
      {open && (
        <div className="mt-3">
          {items.map((i) => (
            <TabsContent key={i.value} value={i.value}>
              {i.content}
            </TabsContent>
          ))}
        </div>
      )}
    </Tabs>
  );
}
