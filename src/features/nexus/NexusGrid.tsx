// NexusGrid — the 2-column widget grid (spec §3). Widgets order by
// position, pairs left-to-right then down; single column below lg keeps
// the same order. Drag-to-reorder by the header handle (rectSortingStrategy)
// persists via useReorderWidgets. Takes an optional userId so the admin
// "configure for user" editor can render any rep's grid, and a mode prop
// ("default") that points the SAME grid at nexus_default_widgets for the
// admin system-default editor — bodies preview with the signed-in
// admin's own data since default rows have no owner.

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
import type { NexusWidget, NexusWidgetType } from "./types";

/**
 * Body component per widget type. All seven are live as of the Campaigns
 * overhaul S7 (Campaign Touches added to the original Stage C six); each
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
};

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

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={ordered.map((w) => w.id)}
        strategy={rectSortingStrategy}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {ordered.map((widget) => (
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
          ))}
        </div>
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
