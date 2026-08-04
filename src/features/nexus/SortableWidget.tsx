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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active,
  } = useSortable({ id: widget.id, disabled: !editable });
  // Drag rework (Nathan 8/4, "glitchy and odd"): a DragOverlay clone
  // follows the pointer (see NexusGrid/FeaturedWidgets), so the card
  // itself stays PUT while dragged — it fades into the "this is the slot
  // you left" ghost, and the card under the pointer lights up as the drop
  // target. No transform is applied mid-drag; the noop sorting strategy
  // means neighbors don't mispredict shifts in the two variable-height
  // stacks (the old rectSortingStrategy assumed a uniform grid and made
  // everything jump around).
  const style = {
    transform: isDragging ? undefined : CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
  };
  const isDropTarget = isOver && !isDragging && !!active;

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
        customizing && !isDragging && !isDropTarget && "opacity-95",
        isDragging && "opacity-30 grayscale",
        isDropTarget && "scale-[0.97] ring-2 ring-primary/70",
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

/**
 * The DragOverlay clone: the picked-up card that follows the pointer.
 * Presentational only — no sortable hooks, no controls — with a lift
 * (shadow + tiny tilt) so it reads as "in your hand". Bodies render from
 * the same react-query cache as the real card, so it appears instantly.
 */
export function DragOverlayCard({ widget }: { widget: NexusWidget }) {
  const Body = WIDGET_BODIES[widget.widget_type] ?? UnknownWidgetBody;
  return (
    <div className="pointer-events-none rotate-1 cursor-grabbing rounded-xl shadow-2xl ring-2 ring-primary/50">
      <WidgetShell
        widget={widget}
        searchQuery=""
        onSearchQueryChange={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
        editable={false}
      >
        <Body widget={widget} searchQuery="" />
      </WidgetShell>
    </div>
  );
}
