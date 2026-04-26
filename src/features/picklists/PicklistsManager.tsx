import { useMemo, useState, useEffect } from "react";
import { Plus, Trash2, Pencil, Check, X, GripVertical } from "lucide-react";
import { toast } from "sonner";
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
import {
  usePicklistOptions,
  useCreatePicklistOption,
  useUpdatePicklistOption,
  useDeletePicklistOption,
  type PicklistOption,
} from "./api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Friendly catalog of editable picklists. Each entry maps a stable
 * field_key to a human label + which entity / column it controls.
 */
const FIELDS: { key: string; label: string; entity: string; help?: string }[] = [
  // Opportunity
  {
    key: "opportunities.contract_length_months",
    label: "Contract Length",
    entity: "Opportunity",
    help: "Stored as months (12, 36). Display labels are admin-editable.",
  },
  { key: "opportunities.contract_year",     label: "Contract Year",     entity: "Opportunity" },
  { key: "opportunities.payment_frequency", label: "Payment Frequency", entity: "Opportunity" },
  { key: "opportunities.lead_source",       label: "Lead Source",       entity: "Opportunity" },
  // Account
  { key: "accounts.account_type",           label: "Account Type",      entity: "Account" },
  { key: "accounts.industry",               label: "Industry",          entity: "Account" },
  { key: "accounts.renewal_type",           label: "Renewal Type",      entity: "Account" },
  // Contact
  { key: "contacts.credential",             label: "Credential",        entity: "Contact" },
  { key: "contacts.time_zone",              label: "Time Zone",         entity: "Contact" },
  { key: "contacts.type",                   label: "Contact Type",      entity: "Contact" },
  { key: "contacts.business_relationship_tag", label: "Relationship Tag", entity: "Contact" },
  { key: "contacts.lead_source",            label: "Lead Source",       entity: "Contact" },
  // Lead
  { key: "leads.status",                    label: "Status",            entity: "Lead" },
  { key: "leads.source",                    label: "Source",            entity: "Lead" },
  { key: "leads.qualification",             label: "Qualification",     entity: "Lead" },
  { key: "leads.type",                      label: "Lead Type",         entity: "Lead" },
  { key: "leads.project_segment",           label: "Lead Segment",      entity: "Lead" },
  { key: "leads.industry_category",         label: "Industry",          entity: "Lead" },
  { key: "leads.credential",                label: "Credential",        entity: "Lead" },
  { key: "leads.time_zone",                 label: "Time Zone",         entity: "Lead" },
  { key: "leads.business_relationship_tag", label: "Relationship Tag",  entity: "Lead" },
  { key: "leads.rating",                    label: "Lead Rating",       entity: "Lead" },
];

export function PicklistsManager() {
  const { data: byField, isLoading } = usePicklistOptions();
  const [activeKey, setActiveKey] = useState<string>(FIELDS[0].key);
  const create = useCreatePicklistOption();
  const update = useUpdatePicklistOption();
  const remove = useDeletePicklistOption();

  // Add-row state
  const [newValue, setNewValue] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  // Local copy of the row order so drag feels instant; synced from server
  // whenever the server data changes (different field selected, mutations
  // succeed, etc.)
  const serverOptions = useMemo(
    () => (byField?.get(activeKey) ?? []).slice().sort((a, b) => a.sort_order - b.sort_order),
    [byField, activeKey],
  );
  const [localOrder, setLocalOrder] = useState<PicklistOption[]>(serverOptions);
  useEffect(() => {
    setLocalOrder(serverOptions);
  }, [serverOptions]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeField = FIELDS.find((f) => f.key === activeKey);

  function startEdit(o: PicklistOption) {
    setEditingId(o.id);
    setEditLabel(o.label);
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    try {
      await update.mutateAsync({
        id,
        patch: { label: editLabel.trim() },
      });
      toast.success("Saved");
      setEditingId(null);
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    }
  }

  async function toggleActive(o: PicklistOption) {
    try {
      await update.mutateAsync({
        id: o.id,
        patch: { is_active: !o.is_active },
      });
    } catch (err) {
      toast.error(`Toggle failed: ${(err as Error).message}`);
    }
  }

  async function addOption() {
    if (!newValue.trim() || !newLabel.trim()) {
      toast.error("Value and label required");
      return;
    }
    try {
      // Append at the bottom by giving the new row a sort_order higher
      // than any existing row.
      const maxSort = localOrder.reduce((m, o) => Math.max(m, o.sort_order), 0);
      await create.mutateAsync({
        field_key: activeKey,
        value: newValue.trim(),
        label: newLabel.trim(),
        sort_order: maxSort + 10,
      });
      setNewValue("");
      setNewLabel("");
      toast.success("Added");
    } catch (err) {
      toast.error(`Add failed: ${(err as Error).message}`);
    }
  }

  async function deleteOption(o: PicklistOption) {
    if (
      !confirm(
        `Delete "${o.label}"? This won't affect existing records that already use this value.`,
      )
    )
      return;
    try {
      await remove.mutateAsync(o.id);
      toast.success("Deleted");
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  }

  /** When the user drops a row, persist the new order. We renumber every
   *  row in 10-step increments so future inserts have room without
   *  reshuffling everyone. */
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localOrder.findIndex((o) => o.id === active.id);
    const newIndex = localOrder.findIndex((o) => o.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(localOrder, oldIndex, newIndex);
    setLocalOrder(next); // optimistic

    // Persist new sort_order for every row whose order changed.
    const updates: Promise<unknown>[] = [];
    next.forEach((row, i) => {
      const newOrder = (i + 1) * 10;
      if (row.sort_order !== newOrder) {
        updates.push(
          update.mutateAsync({ id: row.id, patch: { sort_order: newOrder } }),
        );
      }
    });
    try {
      await Promise.all(updates);
    } catch (err) {
      toast.error(`Reorder failed: ${(err as Error).message}`);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Picklists</CardTitle>
        <p className="text-sm text-muted-foreground">
          Admin-editable dropdown values. Drag rows to reorder, toggle active to
          hide a value from new selections without breaking historical data.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 max-w-md">
            <Label htmlFor="picklist-field">Field</Label>
            <Select value={activeKey} onValueChange={setActiveKey}>
              <SelectTrigger id="picklist-field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELDS.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.entity} — {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground pb-2">
            <code className="bg-muted px-1 py-0.5 rounded">{activeKey}</code>
          </p>
        </div>

        {activeField?.help && (
          <p className="text-xs text-muted-foreground">{activeField.help}</p>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : localOrder.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center border rounded-lg">
            No options yet — add the first one below.
          </p>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-[40px_140px_1fr_80px_80px] gap-3 px-4 py-2 bg-muted/40 text-xs font-semibold text-muted-foreground">
              <div></div>
              <div>Stored Value</div>
              <div>Display Label</div>
              <div>Active</div>
              <div className="text-right">Actions</div>
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={localOrder.map((o) => o.id)}
                strategy={verticalListSortingStrategy}
              >
                {localOrder.map((o) => (
                  <SortableRow
                    key={o.id}
                    option={o}
                    editing={editingId === o.id}
                    editLabel={editLabel}
                    setEditLabel={setEditLabel}
                    onStartEdit={() => startEdit(o)}
                    onCancelEdit={cancelEdit}
                    onSaveEdit={() => saveEdit(o.id)}
                    onToggleActive={() => toggleActive(o)}
                    onDelete={() => deleteOption(o)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        )}

        {/* Add new option */}
        <Card className="border-dashed">
          <CardContent className="pt-4 grid grid-cols-12 gap-3 items-end">
            <div className="col-span-3">
              <Label htmlFor="new-value">Stored Value</Label>
              <Input
                id="new-value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g. premium_partner"
              />
            </div>
            <div className="col-span-7">
              <Label htmlFor="new-label">Display Label</Label>
              <Input
                id="new-label"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="e.g. Premium Partner"
              />
            </div>
            <div className="col-span-2">
              <Button onClick={addOption} disabled={create.isPending} className="w-full">
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>
      </CardContent>
    </Card>
  );
}

interface SortableRowProps {
  option: PicklistOption;
  editing: boolean;
  editLabel: string;
  setEditLabel: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}

function SortableRow({
  option,
  editing,
  editLabel,
  setEditLabel,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onToggleActive,
  onDelete,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: option.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`grid grid-cols-[40px_140px_1fr_80px_80px] gap-3 px-4 py-2 items-center border-t ${
        option.is_active ? "" : "opacity-60"
      } ${isDragging ? "bg-muted shadow-lg" : "hover:bg-muted/30"}`}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing flex items-center justify-center text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="font-mono text-xs truncate">{option.value}</div>
      <div className="text-sm">
        {editing ? (
          <Input
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            className="h-8"
            autoFocus
          />
        ) : (
          option.label
        )}
      </div>
      <div>
        <Switch checked={option.is_active} onCheckedChange={onToggleActive} />
      </div>
      <div className="flex gap-1 justify-end">
        {editing ? (
          <>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onSaveEdit}>
              <Check className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onCancelEdit}>
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onStartEdit}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
