// The pinned strip: up to two widgets promoted out of the grid and into
// the briefing area, right under the top-three cards and above the "Your
// widgets" divider (docket C2 round 4, Nathan's idea).
//
// One pin runs full width, two sit side by side. They are ordinary widget
// cards rendered through the same WidgetShell as everything in the grid,
// so a pinned widget behaves exactly like it did before it was pinned.
//
// Order follows `position`, the same number the grid sorts by. Dragging
// inside the strip permutes the positions those two widgets already hold,
// so nothing in the grid below shifts as a side effect.

import { useMemo } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { useRemoveWidget, useReorderWidgets } from "./api";
import { selectFeatured } from "./featured";
import { SortableWidget } from "./SortableWidget";
import type { NexusWidget } from "./types";

export interface FeaturedWidgetsProps {
  /** The user's full widget list; the pinned ones are picked out here. */
  widgets: NexusWidget[] | undefined;
  /** Page owner (admin editor passes a target user). */
  userId?: string;
  onEditWidget: (widget: NexusWidget) => void;
  onToggleFeatured?: (widget: NexusWidget) => void;
  /** Show the per-widget controls and allow dragging. */
  editable?: boolean;
  /** Apply the Customize-mode look. */
  customizing?: boolean;
  pinPending?: boolean;
}

export function FeaturedWidgets({
  widgets,
  userId,
  onEditWidget,
  onToggleFeatured,
  editable = false,
  customizing = false,
  pinPending,
}: FeaturedWidgetsProps) {
  const { user } = useAuth();
  const removeWidget = useRemoveWidget();
  const reorder = useReorderWidgets();

  const featured = useMemo(() => selectFeatured(widgets), [widgets]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (featured.length === 0) return null;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = featured.findIndex((w) => w.id === active.id);
    const to = featured.findIndex((w) => w.id === over.id);
    if (from === -1 || to === -1) return;
    // Hand the same set of positions back out in the new order, so the
    // widgets in the grid below keep the numbers they have.
    const slots = featured.map((w) => w.position).sort((a, b) => a - b);
    const items = arrayMove(featured, from, to).map((w, idx) => ({
      id: w.id,
      position: slots[idx],
    }));
    reorder.mutate({ items, userId: userId ?? user?.id });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={featured.map((w) => w.id)}
        strategy={rectSortingStrategy}
      >
        <div
          className={cn(
            "grid grid-cols-1 gap-4 items-start",
            featured.length > 1 && "lg:grid-cols-2",
          )}
        >
          {featured.map((widget) => (
            <SortableWidget
              key={widget.id}
              widget={widget}
              onEdit={() => onEditWidget(widget)}
              onRemove={() => removeWidget.mutate(widget.id)}
              editable={editable}
              customizing={customizing}
              featured
              onToggleFeatured={
                onToggleFeatured ? () => onToggleFeatured(widget) : undefined
              }
              pinPending={pinPending}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
