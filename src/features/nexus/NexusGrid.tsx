// NexusGrid — the two-stack widget layout (spec §3, revised docket C2).
// Widgets order by a single global `position`; that order is dealt into two
// INDEPENDENT vertical stacks by alternating index (0 left, 1 right, 2 left,
// ...). Each widget is exactly as tall as its content and the next widget in
// the same stack starts right below it, so a short widget beside a tall one
// leaves no dead space (the old CSS grid row-aligned pairs and did). Below lg
// there is one stack in plain position order. Drag-to-reorder by the header
// handle still moves the widget within the single position order — see
// handleDragEnd. Takes an optional userId so the admin "configure for user"
// editor can render any rep's grid, and a mode prop ("default") that points
// the SAME layout at nexus_default_widgets for the admin system-default
// editor — bodies preview with the signed-in admin's own data since default
// rows have no owner.

import { useEffect, useMemo, useState, type ComponentType } from "react";
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
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LayoutDashboard } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  useDefaultWidgets,
  useNexusWidgets,
  useRemoveDefaultWidget,
  useRemoveWidget,
  useReorderDefaultWidgets,
  useReorderWidgets,
} from "./api";
import { WidgetShell, type NexusWidgetBodyProps } from "./WidgetShell";
import { TasksWidget } from "./widgets/TasksWidget";
import { PipelineWidget } from "./widgets/PipelineWidget";
import { CustomReportWidget } from "./widgets/CustomReportWidget";
import { MetricsWidget } from "./widgets/MetricsWidget";
import { PinnedRecordsWidget } from "./widgets/PinnedRecordsWidget";
import { RequestsWidget } from "./widgets/RequestsWidget";
import { CampaignTouchesWidget } from "./widgets/CampaignTouchesWidget";
import { WinsWidget } from "./widgets/WinsWidget";
import { ColdCallListWidget } from "./widgets/ColdCallListWidget";
import { RecentsWidget } from "./widgets/RecentsWidget";
import type { NexusWidget, NexusWidgetType } from "./types";

/**
 * Body component per widget type. Nine are live as of Nexus Phase 2
 * (Wins + Recents added to the Campaigns-overhaul seven); each
 * implements NexusWidgetBodyProps.
 */
export const WIDGET_BODIES: Record<
  NexusWidgetType,
  ComponentType<NexusWidgetBodyProps>
> = {
  tasks: TasksWidget,
  pipeline: PipelineWidget,
  custom_report: CustomReportWidget,
  metrics: MetricsWidget,
  pinned_records: PinnedRecordsWidget,
  requests: RequestsWidget,
  campaign_touches: CampaignTouchesWidget,
  wins: WinsWidget,
  cold_call: ColdCallListWidget,
  recents: RecentsWidget,
};

/**
 * Deal a position-ordered list into the two stacks: even indexes left, odd
 * indexes right. Exported so the mapping is testable and so anything that
 * needs to reason about "which stack is this widget in" uses one rule.
 *
 * The global index is the source of truth in both directions:
 *   stack       = index % 2 === 0 ? "left" : "right"
 *   row in stack = Math.floor(index / 2)
 * so a drop anywhere in the layout converts straight back to a single
 * position number (see handleDragEnd).
 */
export function splitIntoStacks<T>(items: T[]): [T[], T[]] {
  const left: T[] = [];
  const right: T[] = [];
  items.forEach((item, i) => {
    if (i % 2 === 0) left.push(item);
    else right.push(item);
  });
  return [left, right];
}

/** Tailwind's `lg` breakpoint — the point the layout goes from 1 to 2 stacks. */
const TWO_STACK_QUERY = "(min-width: 1024px)";

/**
 * True when there is room for two stacks. This is a JS breakpoint rather
 * than a CSS one because the DOM order differs between the two layouts:
 * two stacks render left-column-then-right-column, one stack renders in
 * plain position order. Doing it in CSS would need `order` overrides that
 * lie to keyboard and screen-reader users about the reading order.
 */
function useTwoStackLayout(): boolean {
  const [wide, setWide] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    return window.matchMedia(TWO_STACK_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(TWO_STACK_QUERY);
    const onChange = () => setWide(mql.matches);
    onChange();
    // addEventListener on MediaQueryList is missing in Safari below 14,
    // which this app still has to boot in — fall back to addListener.
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, []);

  return wide;
}

export interface NexusGridProps {
  /** Defaults to the signed-in user; admins pass a target user (Stage D). */
  userId?: string;
  /** Open the builder pre-filled with this widget (edit pencil). */
  onEditWidget: (widget: NexusWidget) => void;
  /**
   * "user" (default) edits nexus_widgets; "default" points the grid at
   * nexus_default_widgets (admin system-default editor). In default mode
   * the bodies preview with the signed-in admin's own data.
   */
  mode?: "user" | "default";
}

export function NexusGrid({ userId, onEditWidget, mode = "user" }: NexusGridProps) {
  const isDefault = mode === "default";
  const { user } = useAuth();
  const twoStacks = useTwoStackLayout();

  // Both hook pairs are called unconditionally (rules of hooks); the
  // inactive side is disabled / unused.
  const userQuery = useNexusWidgets(userId, { enabled: !isDefault });
  const defaultQuery = useDefaultWidgets({ enabled: isDefault });
  const reorderUser = useReorderWidgets();
  const reorderDefaults = useReorderDefaultWidgets();
  const removeUser = useRemoveWidget();
  const removeDefaults = useRemoveDefaultWidget();

  const widgets = useMemo<NexusWidget[] | undefined>(() => {
    if (!isDefault) return userQuery.data;
    if (!defaultQuery.data) return undefined;
    // Default rows have no owner — synthesize the admin's id so the
    // bodies can render a live preview ("your data" — noted in the UI).
    const previewUid = user?.id ?? "";
    return defaultQuery.data.map(
      (w) => ({ ...w, user_id: previewUid }) as NexusWidget,
    );
  }, [isDefault, userQuery.data, defaultQuery.data, user?.id]);

  const isLoading = isDefault ? defaultQuery.isLoading : userQuery.isLoading;
  const removeWidget = isDefault ? removeDefaults : removeUser;

  // Optimistic order so the grid doesn't snap back while the position
  // updates round-trip. Cleared once the server order catches up.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  const ordered = useMemo(() => {
    const list = widgets ?? [];
    if (!localOrder) return list;
    const byId = new Map(list.map((w) => [w.id, w]));
    const arranged = localOrder
      .map((id) => byId.get(id))
      .filter((w): w is NexusWidget => !!w);
    for (const w of list) {
      if (!localOrder.includes(w.id)) arranged.push(w);
    }
    return arranged;
  }, [widgets, localOrder]);

  useEffect(() => {
    if (!localOrder || !widgets) return;
    if (widgets.map((w) => w.id).join(",") === localOrder.join(",")) {
      setLocalOrder(null);
    }
  }, [widgets, localOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * A drop maps back to a position index through the widget it landed on.
   * Every visual slot in the two-stack layout IS a global index (stack =
   * index % 2, row = index / 2), so the widget the pointer is over carries
   * its own index: take the drop target's index in `ordered`, arrayMove the
   * dragged widget there, and renumber 0..n-1. The dragged widget therefore
   * ends up in exactly the slot it was dropped on — same stack or the other
   * one, no special case — and the widgets after the insertion point shift
   * by one, which flips their stack. That flip is inherent to alternating
   * distribution and is what keeps a single `position` order enough.
   */
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex((w) => w.id === active.id);
    const newIndex = ordered.findIndex((w) => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(ordered, oldIndex, newIndex);
    setLocalOrder(next.map((w) => w.id));
    const items = next.map((w, idx) => ({ id: w.id, position: idx }));
    if (isDefault) {
      reorderDefaults.mutate(items);
    } else {
      // Page owner (self unless the admin editor passed a target user) —
      // used to scope the cache invalidation to that user's grid.
      reorderUser.mutate({ items, userId: userId ?? user?.id });
    }
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (!ordered.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">Nothing here yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Click "Add a Widget" in the top right to start building this
            page — tasks, pipeline, and more.
          </p>
        </div>
      </div>
    );
  }

  const renderWidget = (widget: NexusWidget) => (
    <SortableWidget
      key={widget.id}
      widget={widget}
      onEdit={() => onEditWidget(widget)}
      onRemove={() => removeWidget.mutate(widget.id)}
      removeDescription={
        isDefault
          ? `"${widget.name}" will be removed from the system default layout. Pages that already exist are not affected.`
          : undefined
      }
    />
  );

  const [leftStack, rightStack] = splitIntoStacks(ordered);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {/*
        `items` stays in global position order, which is also the reading
        order of the two-stack layout (slot i sits at row i/2 of stack i%2).
        That keeps rectSortingStrategy's measured rects in the same order the
        user reads them, so the drag preview shifts the way the drop will.
      */}
      <SortableContext
        items={ordered.map((w) => w.id)}
        strategy={rectSortingStrategy}
      >
        {twoStacks ? (
          // Two independent stacks. `items-start` stops a column from being
          // stretched by its neighbour; each stack's own gap-6 spaces the
          // widgets, so a short widget is followed immediately by the next
          // one instead of waiting for a shared row to end.
          <div className="grid grid-cols-2 gap-6 items-start">
            <div className="flex flex-col gap-6">{leftStack.map(renderWidget)}</div>
            <div className="flex flex-col gap-6">{rightStack.map(renderWidget)}</div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">{ordered.map(renderWidget)}</div>
        )}
      </SortableContext>
    </DndContext>
  );
}

function SortableWidget({
  widget,
  onEdit,
  onRemove,
  removeDescription,
}: {
  widget: NexusWidget;
  onEdit: () => void;
  onRemove: () => void;
  removeDescription?: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: widget.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [dataUpdatedAt, setDataUpdatedAt] = useState<number | undefined>();
  const Body = WIDGET_BODIES[widget.widget_type];

  return (
    <div ref={setNodeRef} style={style} className="relative">
      <WidgetShell
        widget={widget}
        dataUpdatedAt={dataUpdatedAt}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onEdit={onEdit}
        onRemove={onRemove}
        dragHandleProps={{ ...attributes, ...listeners }}
        removeDescription={removeDescription}
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
