// One draggable widget card. Lives on its own so the grid (NexusGrid) and
// the pinned row above the divider (FeaturedWidgets) render the exact same
// thing, through the exact same WidgetShell.
//
// In Customize mode the card takes a light touch of chrome: it eases back
// a hair and picks up a soft ring, which is the phone-home-screen "you can
// move me" hint without the jitter. Everything else about the card is
// unchanged, so what you arrange is what you get when you press Done.

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { WidgetShell } from "./WidgetShell";
import { WIDGET_BODIES } from "./widget-bodies";
import type { NexusWidget } from "./types";

export interface SortableWidgetProps {
  widget: NexusWidget;
  onEdit: () => void;
  onRemove: () => void;
  removeDescription?: string;
  /** Show the layout controls (drag, edit, remove, pin). */
  editable?: boolean;
  /** Apply the Customize-mode look. */
  customizing?: boolean;
  /** Pin state and toggle. Omit the toggle to hide the pin control. */
  featured?: boolean;
  onToggleFeatured?: () => void;
  pinPending?: boolean;
}

function UnknownWidgetBody() {
  return (
    <p className="text-sm text-muted-foreground py-2">
      This widget needs a newer version of Pulse. Refresh to update.
    </p>
  );
}

export function SortableWidget({
  widget,
  onEdit,
  onRemove,
  removeDescription,
  editable = true,
  customizing = false,
  featured = false,
  onToggleFeatured,
  pinPending,
}: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id, disabled: !editable });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [dataUpdatedAt, setDataUpdatedAt] = useState<number | undefined>();
  // Unknown type = a newer schema row rendered by an older build (e.g. a
  // frontend rollback after someone saved a wins/recents widget). Render a
  // quiet placeholder instead of throwing the whole page into the error
  // boundary (pre-promote sweep #4).
  const Body = WIDGET_BODIES[widget.widget_type] ?? UnknownWidgetBody;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative rounded-xl transition-all duration-200",
        customizing && "scale-[0.985] ring-2 ring-primary/25",
        customizing && !isDragging && "opacity-95",
      )}
    >
      <WidgetShell
        widget={widget}
        dataUpdatedAt={dataUpdatedAt}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onEdit={onEdit}
        onRemove={onRemove}
        dragHandleProps={{ ...attributes, ...listeners }}
        removeDescription={removeDescription}
        editable={editable}
        featured={featured}
        onToggleFeatured={onToggleFeatured}
        pinPending={pinPending}
      >
        <Body
          widget={widget}
          searchQuery={searchQuery}
          onDataUpdated={setDataUpdatedAt}
        />
      </WidgetShell>
    </div>
  );
}
