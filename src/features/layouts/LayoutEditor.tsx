import { useState, useMemo, useEffect } from "react";
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
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  GripVertical,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Columns2,
  Square,
  Columns3,
  ShieldCheck,
  Settings2,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { supabase } from "@/lib/supabase";
import {
  usePageLayout,
  useUpdatePageLayoutField,
  useUpdatePageLayoutSection,
  useCreatePageLayoutSection,
  useDeletePageLayoutSection,
  useCreatePageLayoutField,
  useDeletePageLayoutField,
} from "./api";
import type { LayoutEntity, PageLayoutSectionWithFields, PageLayoutField } from "./types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const ENTITY_OPTIONS: { value: LayoutEntity; label: string }[] = [
  { value: "accounts", label: "Account" },
  { value: "contacts", label: "Contact" },
  { value: "leads", label: "Lead" },
  { value: "opportunities", label: "Opportunity" },
  { value: "activities", label: "Activity" },
  { value: "products", label: "Product" },
  { value: "account_partners", label: "Partner Relationship" },
];

/**
 * Drag-and-drop page layout editor. Admins can:
 * - Reorder sections
 * - Reorder fields within a section
 * - Move fields between sections (drag handle)
 * - Add new sections
 * - Delete empty sections
 * - Add unassigned DB columns into a section
 * - Per-field gear popover: width (full/half/third), label, help text,
 *   read-only-on-form, admin-only-on-form, hide-on-form, hide-on-detail
 *
 * RLS gates ALL writes; non-admins see the editor in read-only mode
 * (the LayoutsViewer fallback).
 */
export function LayoutEditor() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [entity, setEntity] = useState<LayoutEntity>("accounts");
  const { data: layout, isLoading } = usePageLayout(entity);

  if (!isAdmin) {
    // Non-admins should never see this component (parent gates by role),
    // but defense in depth: render nothing.
    return (
      <div className="text-sm text-muted-foreground p-6 border rounded">
        Layout editing requires admin privileges.
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="h-5 w-5" />
          Page Layout Editor
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Drag sections and fields to rearrange. Per-field settings hide
          behind the gear icon. Changes save instantly and apply to every
          user immediately. Hidden fields keep their data — toggle them
          back any time.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-12 gap-3 items-end">
          <div className="col-span-4">
            <Label htmlFor="layout-entity">Entity</Label>
            <Select value={entity} onValueChange={(v) => setEntity(v as LayoutEntity)}>
              <SelectTrigger id="layout-entity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : !layout ? (
          <div className="text-sm text-muted-foreground border rounded-md p-6 text-center">
            No layout seeded for this entity yet.
          </div>
        ) : (
          <EditorBody entity={entity} layout={layout} />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Editor body — sections + fields with drag-and-drop
// ---------------------------------------------------------------------

interface ResolvedLayoutData {
  id: string;
  sections: PageLayoutSectionWithFields[];
}

function EditorBody({
  entity,
  layout,
}: {
  entity: LayoutEntity;
  layout: ResolvedLayoutData;
}) {
  const updateSection = useUpdatePageLayoutSection();
  const createSection = useCreatePageLayoutSection();

  const sections = layout.sections;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sections.findIndex((s) => s.id === active.id);
    const newIndex = sections.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sections, oldIndex, newIndex);
    // Persist new sort_orders sequentially
    try {
      await Promise.all(
        reordered.map((s, idx) =>
          updateSection.mutateAsync({ id: s.id, patch: { sort_order: idx + 1 } })
        )
      );
      toast.success("Sections reordered");
    } catch (err) {
      toast.error("Reorder failed: " + (err as Error).message);
    }
  }

  async function handleAddSection() {
    const title = window.prompt("New section title:");
    if (!title?.trim()) return;
    try {
      await createSection.mutateAsync({
        layout_id: layout.id,
        title: title.trim(),
        sort_order: sections.length + 1,
      });
      toast.success("Section added");
    } catch (err) {
      toast.error("Add failed: " + (err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {sections.map((section) => (
              <SectionEditor key={section.id} entity={entity} section={section} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleAddSection}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Section
        </Button>
        <UnassignedFieldsTray entity={entity} layout={layout} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// SectionEditor — one collapsible card with title edit + field DnD
// ---------------------------------------------------------------------

function SectionEditor({
  entity,
  section,
}: {
  entity: LayoutEntity;
  section: PageLayoutSectionWithFields;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const updateSection = useUpdatePageLayoutSection();
  const deleteSection = useDeletePageLayoutSection();
  const updateField = useUpdatePageLayoutField();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(section.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setTitleDraft(section.title), [section.title]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function handleFieldDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = section.fields.findIndex((f) => f.id === active.id);
    const newIndex = section.fields.findIndex((f) => f.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(section.fields, oldIndex, newIndex);
    try {
      await Promise.all(
        reordered.map((f, idx) =>
          updateField.mutateAsync({ id: f.id, patch: { sort_order: idx + 1 } })
        )
      );
    } catch (err) {
      toast.error("Reorder failed: " + (err as Error).message);
    }
  }

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === section.title) {
      setEditingTitle(false);
      setTitleDraft(section.title);
      return;
    }
    try {
      await updateSection.mutateAsync({ id: section.id, patch: { title: trimmed } });
      setEditingTitle(false);
      toast.success("Section renamed");
    } catch (err) {
      toast.error("Rename failed: " + (err as Error).message);
    }
  }

  async function handleDelete() {
    try {
      await deleteSection.mutateAsync(section.id);
      toast.success("Section deleted");
    } catch (err) {
      toast.error("Delete failed: " + (err as Error).message);
    }
  }

  return (
    <div ref={setNodeRef} style={style} className="border rounded-md bg-card">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            type="button"
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          {editingTitle ? (
            <>
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") {
                    setEditingTitle(false);
                    setTitleDraft(section.title);
                  }
                }}
                className="h-7 text-sm flex-1 max-w-xs"
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={saveTitle}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => {
                  setEditingTitle(false);
                  setTitleDraft(section.title);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <span className="font-medium text-sm">{section.title}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setEditingTitle(true)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </>
          )}
          {section.collapsed_by_default && (
            <Badge variant="outline" className="text-[10px]">
              Collapsed by default
            </Badge>
          )}
          {section.detail_only && (
            <Badge variant="outline" className="text-[10px]">
              Detail only
            </Badge>
          )}
          {section.form_only && (
            <Badge variant="outline" className="text-[10px]">
              Form only
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <SectionSettingsPopover section={section} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                disabled={section.fields.length > 0}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {section.fields.length > 0
                ? "Move all fields out before deleting the section"
                : "Delete this section"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="p-2">
        {section.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-2 py-3 text-center">
            No fields placed. Drag from the Unassigned Fields tray below.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleFieldDragEnd}
          >
            <SortableContext
              items={section.fields.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="divide-y">
                {section.fields.map((f) => (
                  <FieldRow
                    key={f.id}
                    field={f}
                    sectionForm={!!section.detail_only}
                    sectionDetail={!!section.form_only}
                    entity={entity}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{section.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The section will be removed from both Detail and Form pages. Fields
              are unaffected (must be empty to delete).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------
// SectionSettingsPopover — collapsed-by-default, detail/form-only flags
// ---------------------------------------------------------------------

function SectionSettingsPopover({ section }: { section: PageLayoutSectionWithFields }) {
  const updateSection = useUpdatePageLayoutSection();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-7 w-7">
          <Settings2 className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" align="end">
        <div className="text-xs font-medium text-muted-foreground">Section Settings</div>
        <ToggleRow
          label="Collapsed by default"
          checked={section.collapsed_by_default}
          onChange={(v) =>
            updateSection.mutate({ id: section.id, patch: { collapsed_by_default: v } })
          }
        />
        <ToggleRow
          label="Detail page only"
          checked={section.detail_only}
          disabled={section.form_only}
          onChange={(v) => updateSection.mutate({ id: section.id, patch: { detail_only: v } })}
        />
        <ToggleRow
          label="Form page only"
          checked={section.form_only}
          disabled={section.detail_only}
          onChange={(v) => updateSection.mutate({ id: section.id, patch: { form_only: v } })}
        />
      </PopoverContent>
    </Popover>
  );
}

function ToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------
// FieldRow — single field with drag handle + visibility toggles + gear
// ---------------------------------------------------------------------

function FieldRow({
  field,
  sectionForm,
  sectionDetail,
}: {
  field: PageLayoutField;
  sectionForm: boolean; // true if section is form-only
  sectionDetail: boolean; // true if section is detail-only
  entity: LayoutEntity;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const updateField = useUpdatePageLayoutField();
  const deleteField = useDeletePageLayoutField();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 px-2 py-1.5">
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <WidthIcon width={field.width} />
      <span className="font-mono text-xs truncate flex-1">
        {field.label_override ?? field.field_key}
      </span>
      {field.read_only_on_form && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[9px]">
              read-only
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Cannot be edited on Form (auto-calc / imported)</TooltipContent>
        </Tooltip>
      )}
      {field.admin_only_on_form && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-[9px] gap-0.5">
              <ShieldCheck className="h-2.5 w-2.5" />
              admin only
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Editable on Form for admin/super_admin only</TooltipContent>
        </Tooltip>
      )}
      <div className="flex items-center gap-2 shrink-0">
        <FieldVisibilityToggle
          label="Detail"
          checked={!field.hide_on_detail}
          disabled={sectionForm}
          onChange={(v) =>
            updateField.mutate({ id: field.id, patch: { hide_on_detail: !v } })
          }
        />
        <FieldVisibilityToggle
          label="Form"
          checked={!field.hide_on_form}
          disabled={sectionDetail}
          onChange={(v) =>
            updateField.mutate({ id: field.id, patch: { hide_on_form: !v } })
          }
        />
        <FieldSettingsPopover field={field} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove from this layout (data preserved)</TooltipContent>
        </Tooltip>
      </div>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{field.field_key}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The field will move to Unassigned Fields. Its column and data
              are NOT touched. You can drag it back into any section later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteField.mutate(field.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FieldSettingsPopover({ field }: { field: PageLayoutField }) {
  const updateField = useUpdatePageLayoutField();
  const [labelDraft, setLabelDraft] = useState(field.label_override ?? "");
  const [helpDraft, setHelpDraft] = useState(field.help_text ?? "");

  useEffect(() => setLabelDraft(field.label_override ?? ""), [field.label_override]);
  useEffect(() => setHelpDraft(field.help_text ?? ""), [field.help_text]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" className="h-6 w-6">
          <Settings2 className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        <div className="text-xs font-medium text-muted-foreground">Field Settings</div>

        <div className="space-y-1">
          <Label className="text-xs">Width</Label>
          <Select
            value={field.width}
            onValueChange={(v) =>
              updateField.mutate({
                id: field.id,
                patch: { width: v as "full" | "half" | "third" },
              })
            }
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full row</SelectItem>
              <SelectItem value="half">Half row (default)</SelectItem>
              <SelectItem value="third">Third row</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Label override</Label>
          <Input
            value={labelDraft}
            placeholder="Use field name as label"
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={() => {
              const v = labelDraft.trim();
              if ((v || null) !== field.label_override) {
                updateField.mutate({ id: field.id, patch: { label_override: v || null } });
              }
            }}
            className="h-8"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Help text (shown below the field)</Label>
          <Input
            value={helpDraft}
            placeholder="Optional"
            onChange={(e) => setHelpDraft(e.target.value)}
            onBlur={() => {
              const v = helpDraft.trim();
              if ((v || null) !== field.help_text) {
                updateField.mutate({ id: field.id, patch: { help_text: v || null } });
              }
            }}
            className="h-8"
          />
        </div>

        <div className="border-t pt-2 space-y-2">
          <ToggleRow
            label="Read-only on Form"
            checked={field.read_only_on_form}
            onChange={(v) =>
              updateField.mutate({ id: field.id, patch: { read_only_on_form: v } })
            }
          />
          <ToggleRow
            label="Admin only on Form"
            checked={field.admin_only_on_form}
            onChange={(v) =>
              updateField.mutate({ id: field.id, patch: { admin_only_on_form: v } })
            }
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FieldVisibilityToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1">
          <Switch
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
            className="h-4 w-7"
          />
          <span className="text-[10px] text-muted-foreground">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {disabled
          ? `Section is ${label === "Detail" ? "form-only" : "detail-only"}`
          : `Show this field on the ${label} page`}
      </TooltipContent>
    </Tooltip>
  );
}

function WidthIcon({ width }: { width: "full" | "half" | "third" }) {
  const meta = {
    full: { Icon: Square, label: "Full row" },
    half: { Icon: Columns2, label: "Half row" },
    third: { Icon: Columns3, label: "Third row" },
  }[width];
  const { Icon, label } = meta;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------
// UnassignedFieldsTray — DB columns not placed in any section
// ---------------------------------------------------------------------

function UnassignedFieldsTray({
  entity,
  layout,
}: {
  entity: LayoutEntity;
  layout: ResolvedLayoutData;
}) {
  const [open, setOpen] = useState(false);
  const createField = useCreatePageLayoutField();

  // All fields currently placed
  const placed = useMemo(() => {
    const set = new Set<string>();
    for (const s of layout.sections) {
      for (const f of s.fields) set.add(f.field_key);
    }
    return set;
  }, [layout]);

  // Pull all DB columns for the entity from the field inventory view
  const { data: allFields } = useQuery({
    queryKey: ["field_inventory_for_entity", entity],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_field_inventory")
        .select("field, ordinal_position")
        .eq("entity", entity)
        .order("ordinal_position", { ascending: true });
      if (error) throw error;
      return data as Array<{ field: string; ordinal_position: number }>;
    },
    enabled: open,
  });

  const PLUMBING = new Set([
    "id",
    "created_at",
    "updated_at",
    "archived_at",
    "archived_by",
    "archive_reason",
    "custom_fields",
    "verified",
    "verified_at",
    "verified_by",
    "imported_at",
    "outlook_event_id",
    "outlook_sync_error",
    "outlook_synced_at",
    "last_reminder_sent_at",
  ]);

  const unassigned = (allFields ?? []).filter(
    (f) => !placed.has(f.field) && !PLUMBING.has(f.field)
  );

  async function placeIntoFirstSection(fieldKey: string) {
    const target = layout.sections.find((s) => !s.detail_only && !s.form_only) ?? layout.sections[0];
    if (!target) {
      toast.error("Add a section first");
      return;
    }
    try {
      await createField.mutateAsync({
        section_id: target.id,
        field_key: fieldKey,
        sort_order: target.fields.length + 1,
      });
      toast.success(`Added to "${target.title}"`);
    } catch (err) {
      toast.error("Add failed: " + (err as Error).message);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {open ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
          Unassigned Fields
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-h-96 overflow-auto" align="start">
        <div className="text-xs font-medium text-muted-foreground mb-2">
          Database columns not yet placed in any section
        </div>
        {unassigned.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            All fields are placed. Add new columns via Object Manager → Custom Fields.
          </p>
        ) : (
          <div className="space-y-1">
            {unassigned.map((f) => (
              <div
                key={f.field}
                className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-muted/50"
              >
                <span className="font-mono text-xs truncate">{f.field}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => placeIntoFirstSection(f.field)}
                >
                  <Plus className="h-3 w-3 mr-0.5" />
                  Add
                </Button>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
