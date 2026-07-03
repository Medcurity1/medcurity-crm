// Pinned Records builder panel (jordan-v4-spec §4 step 6, §9): a
// debounced search box over contacts + accounts + opportunities (mixed
// types allowed), click a result to pin it, and a dnd-kit reorderable /
// removable pinned list whose order persists as the display order.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Pin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { searchPinnableRecords, usePinnedRecordInfos } from "../pinned-api";
import { PIN_TYPE_ICONS } from "../widgets/PinnedRecordsWidget";
import type {
  PinnedRecordRef,
  PinnedRecordsWidgetConfig,
  PinnedRecordType,
} from "../types";

const TYPE_LABELS: Record<PinnedRecordType, string> = {
  contact: "Contact",
  account: "Account",
  opportunity: "Opportunity",
};

function refKey(r: PinnedRecordRef): string {
  return `${r.type}:${r.id}`;
}

export function normalizePinnedConfig(raw: unknown): PinnedRecordsWidgetConfig {
  const cfg = (raw ?? {}) as Partial<PinnedRecordsWidgetConfig>;
  const records = Array.isArray(cfg.records)
    ? cfg.records.filter(
        (r): r is PinnedRecordRef =>
          !!r &&
          typeof r.id === "string" &&
          (r.type === "contact" || r.type === "account" || r.type === "opportunity"),
      )
    : [];
  return { records };
}

function SortablePinRow({
  record,
  name,
  onRemove,
}: {
  record: PinnedRecordRef;
  name: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: refKey(record) });
  const Icon = PIN_TYPE_ICONS[record.type];
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
      }}
      className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5"
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground touch-none"
        aria-label={`Drag to reorder ${name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Icon
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-label={TYPE_LABELS[record.type]}
      />
      <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onRemove}
        aria-label={`Unpin ${name}`}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function PinnedRecordsPanel({
  config: rawConfig,
  onConfigChange,
}: {
  config: unknown;
  onConfigChange: (config: PinnedRecordsWidgetConfig) => void;
}) {
  const config = normalizePinnedConfig(rawConfig);
  const records = config.records;

  // Debounced search over the three pinnable entities.
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  const { data: results, isFetching } = useQuery({
    queryKey: ["nexus-pin-search", debounced],
    queryFn: () => searchPinnableRecords(debounced),
    enabled: debounced.length >= 2,
  });

  // Names for already-pinned refs (both freshly added and pre-existing).
  const { data: infos } = usePinnedRecordInfos(records);
  const nameByKey = new Map(
    (infos ?? []).map((i) => [`${i.type}:${i.id}`, i.name]),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = records.findIndex((r) => refKey(r) === active.id);
    const newIndex = records.findIndex((r) => refKey(r) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onConfigChange({ records: arrayMove(records, oldIndex, newIndex) });
  }

  function pin(type: PinnedRecordType, id: string) {
    if (records.some((r) => r.type === type && r.id === id)) return;
    onConfigChange({ records: [...records, { type, id }] });
  }

  function unpin(record: PinnedRecordRef) {
    onConfigChange({
      records: records.filter((r) => refKey(r) !== refKey(record)),
    });
  }

  const pinnedKeys = new Set(records.map(refKey));

  return (
    <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
      {/* Search + pick */}
      <div className="space-y-2">
        <Label htmlFor="pin-search">Find records to pin</Label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="pin-search"
            className="h-8 pl-8 text-sm"
            placeholder="Search contacts, accounts, opportunities…"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {isFetching && (
            <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
        {debounced.length >= 2 && results && (
          <div className="max-h-48 overflow-y-auto rounded-md border bg-background">
            {results.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Nothing matches "{debounced}".
              </p>
            ) : (
              results.map((r) => {
                const Icon = PIN_TYPE_ICONS[r.type];
                const already = pinnedKeys.has(`${r.type}:${r.id}`);
                return (
                  <button
                    key={`${r.type}:${r.id}`}
                    type="button"
                    disabled={already}
                    onClick={() => pin(r.type, r.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors",
                      already
                        ? "opacity-50"
                        : "hover:bg-accent hover:text-accent-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">
                      {r.name}
                      {r.detail && (
                        <span className="text-muted-foreground"> · {r.detail}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {already ? "Pinned" : TYPE_LABELS[r.type]}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Pinned list (drag to reorder) */}
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Pin className="h-3.5 w-3.5" /> Pinned ({records.length})
        </Label>
        {records.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing pinned yet — search above and click a record to pin it.
            An empty widget is fine; you can add records any time.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={records.map(refKey)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {records.map((record) => (
                  <SortablePinRow
                    key={refKey(record)}
                    record={record}
                    name={nameByKey.get(refKey(record)) ?? "Loading…"}
                    onRemove={() => unpin(record)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
