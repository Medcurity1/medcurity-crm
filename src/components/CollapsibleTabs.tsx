import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CollapsibleTabsItem {
  value: string;
  label: string;
  /** Rendered lazily when the tab is open + selected. */
  content: ReactNode;
}

/**
 * Tab-style buttons pinned at the top of the detail body. Behavior:
 *   - All collapsed by default; no tab is pre-selected (none appears
 *     active), so clicking any tab has an obvious "something happened"
 *     effect.
 *   - Clicking a tab expands its content.
 *   - Clicking the currently-active tab collapses (rolls up) the panel.
 *   - Clicking a different tab switches to it (and keeps open).
 *
 * Brayden 2026-04-17: removed the separate chevron button — the tabs
 * themselves are enough, and the chevron lived inconveniently on the
 * far right.
 *
 * Implementation note: NOT using Radix Tabs because Radix always forces
 * a selected value (which visually pre-highlights the first tab even
 * when we want "nothing selected"). Plain buttons + our own state is
 * cleaner and lets "nothing selected" actually render that way.
 */
export function CollapsibleTabs({
  items,
  defaultValue,
  defaultOpen = false,
  className,
}: {
  items: CollapsibleTabsItem[];
  /**
   * Tab to show when the panel is expanded. Only used as a fallback if
   * the user has never clicked a tab yet in this session.
   */
  defaultValue: string;
  /**
   * When true, the panel starts open on the defaultValue tab. Usually
   * false so the page doesn't lead with a wall of related-record data.
   */
  defaultOpen?: boolean;
  className?: string;
}) {
  // activeValue === null means "no tab is selected; nothing is rendered
  // and no tab button is highlighted". We only move off null when the
  // user clicks a tab (or defaultOpen is true at mount).
  const [activeValue, setActiveValue] = useState<string | null>(
    defaultOpen ? defaultValue : null
  );

  function handleTabClick(next: string) {
    if (activeValue === next) {
      // Toggle collapse when clicking the active tab.
      setActiveValue(null);
      return;
    }
    setActiveValue(next);
  }

  const current = items.find((i) => i.value === activeValue) ?? null;

  return (
    <div className={cn("mb-4", className)}>
      <div className="flex flex-wrap items-center gap-1 border rounded-lg px-2 py-1 bg-card">
        {items.map((i) => {
          const active = activeValue === i.value;
          return (
            <button
              key={i.value}
              type="button"
              onClick={() => handleTabClick(i.value)}
              className={cn(
                "inline-flex items-center rounded-md px-3 py-1.5 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              aria-pressed={active}
            >
              {i.label}
            </button>
          );
        })}
      </div>
      {current && <div className="mt-3">{current.content}</div>}
    </div>
  );
}
