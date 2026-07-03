// WidgetShell — the shared chrome every Nexus widget renders inside.
// Per jordan-v4-spec §10: color accent (left edge), optional icon, custom
// name, "Updated X ago", in-widget search toggle, edit pencil, remove X,
// and a header drag handle. The body (children) flows the height — the
// shell never fixes a height; preview_count drives row counts inside the
// body components.

import { useEffect, useState, type ReactNode } from "react";
import {
  GripVertical,
  Pencil,
  Search,
  X,
  ListTodo,
  Target,
  Star,
  Flame,
  Users,
  Building2,
  Phone,
  Mail,
  Calendar,
  Bell,
  TrendingUp,
  Pin,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeDate } from "@/lib/formatters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { NexusWidget, NexusWidgetColor } from "./types";

// ── Shared contracts (Stage C widgets implement/reuse these) ─────────

/**
 * Every widget body component receives exactly this. Register new bodies
 * in WIDGET_BODIES (NexusGrid.tsx).
 */
export interface NexusWidgetBodyProps {
  widget: NexusWidget;
  /**
   * The shell's in-widget search string ("" when the search is closed).
   * Bodies filter their ALREADY-LOADED preview rows client-side — never
   * refetch on this.
   */
  searchQuery: string;
  /**
   * Report react-query's dataUpdatedAt so the shell can show
   * "Updated X ago". Call from an effect whenever it changes.
   */
  onDataUpdated?: (timestamp: number) => void;
}

/**
 * The 7-token accent palette (types.ts NEXUS_WIDGET_COLORS), dark-mode
 * safe. Used for the left-edge strip here and the swatches in the builder.
 */
export const WIDGET_ACCENT_CLASSES: Record<NexusWidgetColor, string> = {
  navy: "bg-blue-900 dark:bg-blue-700",
  blue: "bg-blue-500 dark:bg-blue-400",
  green: "bg-emerald-500 dark:bg-emerald-400",
  red: "bg-red-500 dark:bg-red-400",
  purple: "bg-purple-500 dark:bg-purple-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  gray: "bg-gray-400 dark:bg-gray-500",
};

/**
 * The curated icon set for widget labeling. Stored in nexus_widgets.icon
 * as the key string; unknown keys render no icon (forward-compatible).
 */
export const NEXUS_WIDGET_ICONS: Record<string, LucideIcon> = {
  list: ListTodo,
  target: Target,
  star: Star,
  flame: Flame,
  users: Users,
  building: Building2,
  phone: Phone,
  mail: Mail,
  calendar: Calendar,
  bell: Bell,
  chart: TrendingUp,
  pin: Pin,
};

// ── Shell ────────────────────────────────────────────────────────────

export interface WidgetShellProps {
  widget: NexusWidget;
  /** react-query dataUpdatedAt from the body (ms epoch). */
  dataUpdatedAt?: number;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  /** Opens the builder pre-filled with this widget. */
  onEdit: () => void;
  /** Called after the user confirms "Remove this widget?". */
  onRemove: () => void;
  /** Spread of useSortable's {...attributes, ...listeners}. */
  dragHandleProps?: Record<string, unknown>;
  /** Override the remove-confirm body copy (admin default-layout mode). */
  removeDescription?: string;
  children: ReactNode;
}

export function WidgetShell({
  widget,
  dataUpdatedAt,
  searchQuery,
  onSearchQueryChange,
  onEdit,
  onRemove,
  dragHandleProps,
  removeDescription,
  children,
}: WidgetShellProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Metrics widgets are a single stat / mini chart — no rows to filter,
  // so the in-widget search control is hidden (spec §10).
  const searchable = widget.widget_type !== "metrics";

  // "Updates in real time" (spec §10): re-render every minute so the
  // relative label ("Updated 3 minutes ago") stays honest.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!dataUpdatedAt) return;
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, [dataUpdatedAt]);

  const Icon = widget.icon ? NEXUS_WIDGET_ICONS[widget.icon] : undefined;
  const accent = widget.color ? WIDGET_ACCENT_CLASSES[widget.color] : undefined;

  function toggleSearch() {
    if (searchOpen) onSearchQueryChange("");
    setSearchOpen((o) => !o);
  }

  return (
    <Card className="relative overflow-hidden gap-3 py-4">
      {accent && (
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-1", accent)}
        />
      )}

      <CardHeader className="flex flex-row items-center gap-2 space-y-0 px-4">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none"
              aria-label="Drag to reorder widget"
              {...dragHandleProps}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Drag to reorder</TooltipContent>
        </Tooltip>

        <div className="min-w-0 flex-1">
          <CardTitle className="text-base flex items-center gap-2 min-w-0">
            {Icon && (
              <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="truncate">{widget.name}</span>
          </CardTitle>
          {dataUpdatedAt ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              Updated {formatRelativeDate(new Date(dataUpdatedAt).toISOString())}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          {searchable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn("h-7 w-7", searchOpen && "bg-muted")}
                  onClick={toggleSearch}
                  aria-label="Filter rows"
                >
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Filter the visible rows</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={onEdit}
                aria-label="Edit widget"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit widget</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 hover:text-destructive"
                onClick={() => setConfirmRemove(true)}
                aria-label="Remove widget"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove widget</TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>

      {searchable && searchOpen && (
        <div className="px-4">
          <Input
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Filter rows…"
            className="h-8 text-sm"
            autoFocus
          />
        </div>
      )}

      <CardContent className="px-4">{children}</CardContent>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove this widget?"
        description={
          removeDescription ??
          `"${widget.name}" will be removed from your Nexus page. You can add it back any time.`
        }
        confirmLabel="Remove"
        destructive
        onConfirm={onRemove}
      />
    </Card>
  );
}
