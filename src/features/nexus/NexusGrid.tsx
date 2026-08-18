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
//
// Two things arrived with Customize mode (docket C2 round 4): the grid can
// be told to leave pinned widgets out (they render above the divider, see
// FeaturedWidgets), and the per-widget controls plus the Add tile only
// appear while Customize is on. Both default to the old behavior, so the
// admin editors are untouched.

import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { LayoutDashboard, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryError";
import { useAuth } from "@/features/auth/AuthProvider";
import {
  useDefaultWidgets,
  useNexusWidgets,
  useRemoveDefaultWidget,
  useRemoveWidget,
  useReorderDefaultWidgets,
  useReorderWidgets,
} from "./api";
import { selectUnfeatured } from "./featured";
import { DragOverlayCard, SortableWidget } from "./SortableWidget";
import { MAX_WIDGETS, type NexusWidget } from "./types";

/**
 * No live re-sorting mid-drag (Nathan 8/4 drag rework). The two-stack
 * layout has variable-height cards in independent columns, which
 * rectSortingStrategy (built for uniform grids) mispredicted — cards
 * jumped and overlapped while dragging. Instead: cards hold still, the
 * DragOverlay clone follows the pointer, the hovered card highlights as
 * the drop target, and the real reorder happens on drop.
 */
const STATIC_WHILE_DRAGGING: SortingStrategy = () => null;

/** Re-measure droppable rects while dragging — cheap at ≤8 widgets, and
 * it keeps drop-target hit boxes honest as the page scrolls mid-drag. */
const MEASURING = { droppable: { strategy: MeasuringStrategy.Always } };

/** Settle animation for the dropped card. */
const DROP_ANIMATION = { duration: 200, easing: "cubic-bezier(0.2, 0, 0, 1)" };

// Kept as a re-export so anything that imported the registry from here
// still resolves. The registry itself now lives in widget-bodies.ts.
export { WIDGET_BODIES } from "./widget-bodies";

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
  /**
   * Show the per-widget layout controls and allow dragging. Defaults to
   * true, which is what the admin editors want: they are an editing screen
   * already. The Nexus page passes the Customize state instead.
   */
  editable?: boolean;
  /** Customize mode: the card treatment plus the Add tile. */
  customizing?: boolean;
  /** Leave pinned widgets out of the stacks (the Nexus page renders them). */
  excludeFeatured?: boolean;
  /** Opens the widget gallery from the Add tile. */
  onAddWidget?: () => void;
  /** Pin / unpin a widget. Omit to hide the pin control. */
  onToggleFeatured?: (widget: NexusWidget) => void;
  /** A pin write is in flight. */
  pinPending?: boolean;
}

export function NexusGrid({
  userId,
  onEditWidget,
  mode = "user",
  editable = true,
  customizing = false,
  excludeFeatured = false,
  onAddWidget,
  onToggleFeatured,
  pinPending,
}: NexusGridProps) {
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
  const isError = isDefault ? defaultQuery.isError : userQuery.isError;
  const isFetching = isDefault ? defaultQuery.isFetching : userQuery.isFetching;
  const refetch = isDefault ? defaultQuery.refetch : userQuery.refetch;
  const removeWidget = isDefault ? removeDefaults : removeUser;

  // Pinned widgets render above the divider (FeaturedWidgets), so the
  // stacks skip them. Only the Nexus page asks for that; the admin
  // editors keep showing every row, since nothing up there renders a
  // pinned strip and a hidden widget would look like a lost one.
  const gridWidgets = useMemo<NexusWidget[] | undefined>(
    () =>
      !widgets ? undefined : excludeFeatured ? selectUnfeatured(widgets) : widgets,
    [widgets, excludeFeatured],
  );
  const hasHiddenFeatured =
    !!widgets && !!gridWidgets && gridWidgets.length < widgets.length;

  // Optimistic order so the grid doesn't snap back while the position
  // updates round-trip. Cleared once the server order catches up.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);

  const ordered = useMemo(() => {
    const list = gridWidgets ?? [];
    if (!localOrder) return list;
    const byId = new Map(list.map((w) => [w.id, w]));
    const arranged = localOrder
      .map((id) => byId.get(id))
      .filter((w): w is NexusWidget => !!w);
    for (const w of list) {
      if (!localOrder.includes(w.id)) arranged.push(w);
    }
    return arranged;
  }, [gridWidgets, localOrder]);

  useEffect(() => {
    if (!localOrder || !gridWidgets) return;
    if (gridWidgets.map((w) => w.id).join(",") === localOrder.join(",")) {
      setLocalOrder(null);
    }
  }, [gridWidgets, localOrder]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The widget currently in hand; drives the DragOverlay clone.
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeWidget = useMemo(
    () => (activeId ? (ordered.find((w) => w.id === activeId) ?? null) : null),
    [activeId, ordered],
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

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
   *
   * When pinned widgets are being rendered elsewhere, the grid holds only
   * part of the list, so renumbering 0..n-1 would walk over the pinned
   * widgets' positions. In that case the grid reuses the positions its own
   * widgets already occupy, handing them out in the new order: the pinned
   * rows keep their numbers and nothing collides.
   */
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ordered.findIndex((w) => w.id === active.id);
    const newIndex = ordered.findIndex((w) => w.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(ordered, oldIndex, newIndex);
    setLocalOrder(next.map((w) => w.id));
    const slots = hasHiddenFeatured
      ? ordered.map((w) => w.position).sort((a, b) => a - b)
      : null;
    const items = next.map((w, idx) => ({
      id: w.id,
      position: slots ? slots[idx] : idx,
    }));
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

  if (isError) {
    // A failed widget fetch must never fall through to "Nothing here
    // yet" below — that reads as "your whole page config is gone"
    // instead of "this didn't load", on a page that's now the default
    // landing page.
    return (
      <QueryError
        message="Couldn't load this page's widgets."
        onRetry={() => refetch()}
        isRetrying={isFetching}
      />
    );
  }

  if (!ordered.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <LayoutDashboard className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">
              {hasHiddenFeatured ? "Everything is pinned up top" : "Nothing here yet"}
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {hasHiddenFeatured
                ? "Your pinned widgets are above the divider. Add another to fill this space."
                : onAddWidget
                  ? "Add a widget to start building this page. Tasks, pipeline, and more."
                  : "Use Customize to start building this page. Tasks, pipeline, and more."}
            </p>
          </div>
          {onAddWidget && (
            <button
              type="button"
              onClick={onAddWidget}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted/50"
            >
              <Plus className="h-4 w-4" />
              Add a widget
            </button>
          )}
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
      editable={editable}
      customizing={customizing}
      featured={widget.featured}
      onToggleFeatured={
        onToggleFeatured ? () => onToggleFeatured(widget) : undefined
      }
      pinPending={pinPending}
    />
  );

  const [leftStack, rightStack] = splitIntoStacks(ordered);

  // The Add tile is the gallery's doorway and only exists in Customize
  // mode. It sits in the slot the next widget would take, so the grid
  // reads as "here is where the new one lands".
  const atCap = (widgets?.length ?? 0) >= MAX_WIDGETS;
  const addTile =
    customizing && onAddWidget ? (
      <AddWidgetTile key="add-tile" atCap={atCap} onClick={onAddWidget} />
    ) : null;
  const addTileOnLeft = ordered.length % 2 === 0;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={MEASURING}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {/*
        `items` stays in global position order, which is also the reading
        order of the two-stack layout (slot i sits at row i/2 of stack i%2),
        so a drop index converts straight back to a position number.
      */}
      <SortableContext
        items={ordered.map((w) => w.id)}
        strategy={STATIC_WHILE_DRAGGING}
      >
        {twoStacks ? (
          // Two independent stacks. `items-start` stops a column from being
          // stretched by its neighbour; each stack's own gap-6 spaces the
          // widgets, so a short widget is followed immediately by the next
          // one instead of waiting for a shared row to end.
          <div className="grid grid-cols-2 gap-6 items-start">
            <div className="flex flex-col gap-6">
              {leftStack.map(renderWidget)}
              {addTileOnLeft ? addTile : null}
            </div>
            <div className="flex flex-col gap-6">
              {rightStack.map(renderWidget)}
              {addTileOnLeft ? null : addTile}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {ordered.map(renderWidget)}
            {addTile}
          </div>
        )}
      </SortableContext>
      {/* The picked-up card, following the pointer above everything. */}
      <DragOverlay dropAnimation={DROP_ANIMATION}>
        {activeWidget ? <DragOverlayCard widget={activeWidget} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

/**
 * The dashed "Add" slot in Customize mode. At the widget cap it stops
 * being a button and says why, rather than opening a gallery that cannot
 * finish what it starts.
 */
function AddWidgetTile({
  atCap,
  onClick,
}: {
  atCap: boolean;
  onClick: () => void;
}) {
  if (atCap) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">Page is full</p>
        <p className="text-xs text-muted-foreground">
          {MAX_WIDGETS} widgets is the limit. Remove one to add another.
        </p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-32 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
        <Plus className="h-5 w-5" />
      </span>
      <span className="text-sm font-medium">Add a widget</span>
      <span className="text-xs text-muted-foreground">
        Pick from the gallery
      </span>
    </button>
  );
}

