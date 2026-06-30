import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Play,
  Save,
  Plus,
  X,
  FileText,
  Trash2,
  Share2,
  Loader2,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Columns3,
  Download,
  FileSpreadsheet,
  Table2,
  BarChart3,
  PieChartIcon,
  GripVertical,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";
// Drag-to-reorder for the selected report columns (Reports slice 5). The
// chip order IS the report's column display + export order (config.columns),
// so dragging a chip reorders the whole report. @dnd-kit is already a dep
// (the Pipeline board uses it).
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import {
  ENTITY_DEFS,
  ENTITY_KEYS,
  getEntityDef,
  getFilterColumnDef,
  getOperatorsForType,
  isRelationFilterType,
  type ColumnDef,
  type FilterColumnDef,
  type RelationFilterType,
} from "./report-config";
import {
  useSavedReports,
  useSavedReportFolders,
  useRunReport,
  fetchAllReportRows,
  useCreateReport,
  useUpdateReport,
  useDeleteReport,
} from "./report-api";
import { useAuth } from "@/features/auth/AuthProvider";
import { useUsers, useAccounts } from "@/features/accounts/api";
import { RelationCombobox } from "./RelationCombobox";
import { useContacts } from "@/features/contacts/api";
import { useOpportunities } from "@/features/opportunities/api";
import type { ReportConfig, ReportFilter, ReportSort, SavedReport } from "@/types/crm";
import {
  formatCurrency,
  formatDate,
  stageLabel,
  lifecycleLabel,
  activityLabel,
  kindLabel,
  teamLabel,
  renewalTypeLabel,
  leadSourceLabel,
  paymentFrequencyLabel,
} from "@/lib/formatters";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/MultiSelect";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableFooter,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";

// ---------------------------------------------------------------------------
// Relation lookup types
// ---------------------------------------------------------------------------

export interface RelationLookups {
  users: Array<{ id: string; full_name: string }>;
  accounts: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; first_name: string; last_name: string }>;
  opportunities: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENUM_LABEL_MAP: Record<string, (v: string) => string> = {
  lifecycle_status: (v) => lifecycleLabel(v as Parameters<typeof lifecycleLabel>[0]),
  status: (v) => {
    // "status" is used for both accounts (AccountStatus) and leads (LeadStatus).
    // Try lead status labels first, fall back to account status, then raw value.
    const leadLabels: Record<string, string> = {
      new: "New",
      contacted: "Contacted",
      qualified: "Qualified",
      unqualified: "Unqualified",
      converted: "Converted",
    };
    const accountLabels: Record<string, string> = {
      discovery: "Discovery",
      pending: "Pending",
      active: "Active",
      inactive: "Inactive",
      churned: "Churned",
    };
    return leadLabels[v] ?? accountLabels[v] ?? v;
  },
  stage: (v) => stageLabel(v as Parameters<typeof stageLabel>[0]),
  team: (v) => teamLabel(v as Parameters<typeof teamLabel>[0]),
  kind: (v) => kindLabel(v as Parameters<typeof kindLabel>[0]),
  activity_type: (v) => activityLabel(v as Parameters<typeof activityLabel>[0]),
  renewal_type: (v) => renewalTypeLabel(v as Parameters<typeof renewalTypeLabel>[0]),
  source: (v) => leadSourceLabel(v as Parameters<typeof leadSourceLabel>[0]),
  lead_source: (v) => leadSourceLabel(v as Parameters<typeof leadSourceLabel>[0]),
  payment_frequency: (v) => paymentFrequencyLabel(v as Parameters<typeof paymentFrequencyLabel>[0]),
};

/** Map a filterColumnDef's filterKey to the matching enum label map key. */
function getFilterEnumLabelFn(fcol: FilterColumnDef): ((v: string) => string) | undefined {
  // Try exact filterKey match first
  if (ENUM_LABEL_MAP[fcol.filterKey]) return ENUM_LABEL_MAP[fcol.filterKey];
  // Known aliases
  const aliasMap: Record<string, string> = {
    owner_user_id: "owner",
    account_id: "account",
    contact_id: "contact",
    opportunity_id: "opportunity",
    product_id: "product",
    primary_contact_id: "primary_contact",
  };
  const alias = aliasMap[fcol.filterKey];
  if (alias && ENUM_LABEL_MAP[alias]) return ENUM_LABEL_MAP[alias];
  return undefined;
}

function formatCellValue(value: unknown, colDef: ColumnDef | undefined): string {
  if (value === null || value === undefined) return "\u2014";

  // Handle join objects
  if (typeof value === "object" && value !== null) {
    const obj = value as Record<string, unknown>;
    if ("first_name" in obj && "last_name" in obj) {
      return `${obj.first_name ?? ""} ${obj.last_name ?? ""}`.trim() || "\u2014";
    }
    if ("name" in obj && "code" in obj) {
      return `${obj.name} (${obj.code})`;
    }
    if ("full_name" in obj) return String(obj.full_name ?? "\u2014");
    if ("name" in obj) return String(obj.name ?? "\u2014");
    return JSON.stringify(value);
  }

  if (!colDef) return String(value);

  switch (colDef.type) {
    case "currency":
      return formatCurrency(Number(value));
    case "date":
      return formatDate(String(value));
    case "boolean":
      return value ? "Yes" : "No";
    case "enum": {
      const labelFn = ENUM_LABEL_MAP[colDef.key];
      return labelFn ? labelFn(String(value)) : String(value);
    }
    default:
      return String(value);
  }
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportToCSV(
  columns: ColumnDef[],
  data: Record<string, unknown>[],
  entityName: string
) {
  const header = columns.map((col) => escapeCsvField(col.label)).join(",");
  const rows = data.map((row) =>
    columns
      .map((col) => {
        const raw = row[col.key];
        const formatted = formatCellValue(raw, col);
        return escapeCsvField(formatted);
      })
      .join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const link = document.createElement("a");
  link.href = url;
  link.download = `report-${entityName}-${timestamp}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Export the report to an XLSX (Excel) file. */
async function exportToXLSX(
  columns: ColumnDef[],
  data: Record<string, unknown>[],
  entityName: string
) {
  // Dynamically import xlsx (~95KB) only when someone actually exports, so the
  // Reports bundle stays light for everyone just viewing reports.
  const XLSX = await import("xlsx");
  const flat = data.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of columns) {
      // Use raw values for numeric/date columns so Excel can sort & filter them;
      // fall back to formatted label for enums/booleans/text.
      const raw = row[col.key];
      if (col.type === "currency" || col.type === "number") {
        const n = Number(raw);
        out[col.label] = Number.isFinite(n) ? n : null;
      } else if (col.type === "date") {
        out[col.label] = raw ? String(raw) : null;
      } else {
        out[col.label] = formatCellValue(raw, col);
      }
    }
    return out;
  });

  const ws = XLSX.utils.json_to_sheet(flat);
  // Auto-size columns to content (basic heuristic)
  const colWidths = columns.map((col) => ({
    wch: Math.min(
      Math.max(
        col.label.length,
        ...flat.map((r) => String(r[col.label] ?? "").length)
      ) + 2,
      60
    ),
  }));
  ws["!cols"] = colWidths;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, entityName.slice(0, 31));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  XLSX.writeFile(wb, `report-${entityName}-${timestamp}.xlsx`);
}

/** Map from entity key to the detail route prefix. */
const ENTITY_DETAIL_ROUTES: Record<string, string | null> = {
  accounts: "/accounts",
  contacts: "/contacts",
  opportunities: "/opportunities",
  leads: "/leads",
  activities: null, // no dedicated detail page
  opportunity_products: null,
};

/** Given an entity key and a row, return the URL to open the primary record, or null. */
function getRowDetailUrl(
  entityKey: string,
  row: Record<string, unknown>
): string | null {
  const prefix = ENTITY_DETAIL_ROUTES[entityKey];
  if (!prefix) {
    // For activities/line items: fall back to the parent account/opportunity detail
    if (entityKey === "activities") {
      if (typeof row.opportunity_id === "string")
        return `/opportunities/${row.opportunity_id}`;
      if (typeof row.contact_id === "string")
        return `/contacts/${row.contact_id}`;
      if (typeof row.account_id === "string")
        return `/accounts/${row.account_id}`;
      return null;
    }
    if (entityKey === "opportunity_products") {
      if (typeof row.opportunity_id === "string")
        return `/opportunities/${row.opportunity_id}`;
      return null;
    }
    return null;
  }
  const id = row.id;
  if (typeof id !== "string") return null;
  return `${prefix}/${id}`;
}

function makeDefaultConfig(entityKey: string): ReportConfig {
  const def = getEntityDef(entityKey);
  return {
    entity: entityKey as ReportConfig["entity"],
    columns: [...def.defaultColumns],
    filters: [],
    sort: undefined,
  };
}

/** Get the options for a relation filter type from the lookups. */
function getRelationOptions(
  type: RelationFilterType,
  lookups: RelationLookups
): Array<{ value: string; label: string }> {
  switch (type) {
    case "user":
      return lookups.users.map((u) => ({
        value: u.id,
        label: u.full_name,
      }));
    case "account":
      return lookups.accounts.map((a) => ({
        value: a.id,
        label: a.name,
      }));
    case "contact":
      return lookups.contacts.map((c) => ({
        value: c.id,
        label: `${c.first_name} ${c.last_name}`.trim(),
      }));
    case "opportunity":
      return lookups.opportunities.map((o) => ({
        value: o.id,
        label: o.name,
      }));
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EntitySelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>Entity</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ENTITY_KEYS.map((key) => (
            <SelectItem key={key} value={key}>
              {ENTITY_DEFS[key].label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column Picker — Sheet-based with grouped columns
// ---------------------------------------------------------------------------

/** Group columns by their `group` field. Ungrouped columns go to "Other". */
function groupColumns(columns: ColumnDef[]): Map<string, ColumnDef[]> {
  const groups = new Map<string, ColumnDef[]>();
  for (const col of columns) {
    const g = col.group ?? "Other";
    const list = groups.get(g) ?? [];
    list.push(col);
    groups.set(g, list);
  }
  return groups;
}

/** Preferred display order for column groups. */
const GROUP_ORDER = [
  "Basic Info",
  "Relations",
  "Company",
  "Financial",
  "Contract",
  "Dates",
  "Address",
  "System",
  "Other",
];

function sortedGroupEntries(groups: Map<string, ColumnDef[]>): Array<[string, ColumnDef[]]> {
  return Array.from(groups.entries()).sort(([a], [b]) => {
    const ai = GROUP_ORDER.indexOf(a);
    const bi = GROUP_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

/**
 * One selected-column chip that can be dragged to reorder. Rendered as a span
 * (not <Badge>, which doesn't forward a ref) styled with badgeVariants so the
 * @dnd-kit node ref attaches to a real DOM element. The grip is the drag
 * handle; the X still removes. `touch-none` lets it drag on touch devices.
 */
function SortableColumnChip({
  id,
  label,
  onRemove,
}: {
  id: string;
  label: string;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <span
      ref={setNodeRef}
      style={style}
      className={cn(
        badgeVariants({ variant: "secondary" }),
        "gap-1 pl-1 pr-1 cursor-default touch-none select-none",
        isDragging && "z-10 ring-1 ring-primary/40",
      )}
    >
      <button
        type="button"
        className="cursor-grab active:cursor-grabbing rounded-sm p-0.5 text-muted-foreground hover:bg-muted-foreground/20"
        aria-label={`Drag ${label} to reorder`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      {label}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
        aria-label={`Remove ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function ColumnPicker({
  entityKey,
  selected,
  onChange,
}: {
  entityKey: string;
  selected: string[];
  onChange: (cols: string[]) => void;
}) {
  const entity = getEntityDef(entityKey);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Draft selection lives inside the sheet — only committed on Apply.
  const [draft, setDraft] = useState<string[]>(selected);
  const [colSearch, setColSearch] = useState("");

  const openSheet = () => {
    setDraft(selected);
    setColSearch("");
    setSheetOpen(true);
  };

  const toggleDraft = (key: string) => {
    setDraft((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    );
  };

  const applyDraft = () => {
    onChange(draft);
    setSheetOpen(false);
  };

  const removeColumn = (key: string) => {
    onChange(selected.filter((c) => c !== key));
  };

  const grouped = useMemo(() => groupColumns(entity.columns), [entity.columns]);
  const sortedGroups = useMemo(() => sortedGroupEntries(grouped), [grouped]);

  // Filter the grouped columns by the in-sheet search; drop empty groups.
  const q = colSearch.trim().toLowerCase();
  const filteredGroups = useMemo(
    () =>
      sortedGroups
        .map(
          ([g, cols]) =>
            [
              g,
              q ? cols.filter((c) => c.label.toLowerCase().includes(q)) : cols,
            ] as [string, ColumnDef[]],
        )
        .filter(([, cols]) => cols.length > 0),
    [sortedGroups, q],
  );
  const visibleKeys = useMemo(
    () => filteredGroups.flatMap(([, cols]) => cols.map((c) => c.key)),
    [filteredGroups],
  );
  const allVisibleSelected =
    visibleKeys.length > 0 && visibleKeys.every((k) => draft.includes(k));
  const selectAllVisible = () =>
    setDraft((prev) => Array.from(new Set([...prev, ...visibleKeys])));
  const clearVisible = () =>
    setDraft((prev) => prev.filter((k) => !visibleKeys.includes(k)));

  const labelFor = (key: string) =>
    entity.columns.find((c) => c.key === key)?.label ?? key;

  // Drag-to-reorder the selected columns. A small activation distance lets the
  // X / Edit-Columns clicks fire without starting a drag; keyboard sorting is
  // supported for accessibility.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleColumnDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = selected.indexOf(String(active.id));
    const newIndex = selected.indexOf(String(over.id));
    if (oldIndex !== -1 && newIndex !== -1) {
      onChange(arrayMove(selected, oldIndex, newIndex));
    }
  };

  return (
    <div className="space-y-1.5">
      <Label>Columns</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleColumnDragEnd}
        >
          <SortableContext items={selected} strategy={horizontalListSortingStrategy}>
            {selected.map((key) => (
              <SortableColumnChip
                key={key}
                id={key}
                label={labelFor(key)}
                onRemove={() => removeColumn(key)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1"
          onClick={openSheet}
        >
          <Columns3 className="h-3.5 w-3.5" />
          Edit Columns
        </Button>
      </div>
      {selected.length > 1 && (
        <p className="text-[11px] text-muted-foreground">
          Drag the&nbsp;⠿&nbsp;handles to reorder columns. This order is used in the
          table and the CSV/Excel export.
        </p>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle>Select columns</SheetTitle>
          </SheetHeader>

          {/* Search + bulk controls */}
          <div className="space-y-2 px-4 pt-2">
            <Input
              placeholder="Search columns..."
              value={colSearch}
              onChange={(e) => setColSearch(e.target.value)}
              className="h-8"
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {draft.length} selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllVisible}
                  disabled={allVisibleSelected || visibleKeys.length === 0}
                  className="text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  Select all{q ? " matching" : ""}
                </button>
                <span className="text-muted-foreground/40">·</span>
                <button
                  type="button"
                  onClick={clearVisible}
                  disabled={visibleKeys.length === 0}
                  className="text-primary hover:underline disabled:opacity-40 disabled:no-underline"
                >
                  Clear{q ? " matching" : ""}
                </button>
              </div>
            </div>
          </div>

          {/* min-h-0 lets this flex child shrink so its content scrolls instead
              of growing past the viewport and pushing the Apply button off-screen. */}
          <ScrollArea className="flex-1 min-h-0 -mx-4 px-4">
            <div className="space-y-5 py-2">
              {filteredGroups.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No columns match “{colSearch}”.
                </p>
              ) : (
                filteredGroups.map(([groupName, cols]) => (
                  <div key={groupName}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {groupName}
                    </p>
                    <div className="space-y-1">
                      {cols.map((col) => (
                        <label
                          key={col.key}
                          className="flex items-center gap-2.5 text-sm cursor-pointer select-none py-1.5 px-2.5 rounded-md hover:bg-muted"
                        >
                          <Checkbox
                            checked={draft.includes(col.key)}
                            onCheckedChange={() => toggleDraft(col.key)}
                          />
                          <span>{col.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>

          <SheetFooter className="flex-row gap-2 justify-end border-t pt-4">
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyDraft}>Apply</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter components — now use filterColumns + relation lookups
// ---------------------------------------------------------------------------

function FilterValueInput({
  filterCol,
  value,
  onChange,
  lookups,
  operator,
}: {
  filterCol: FilterColumnDef;
  value: string;
  onChange: (v: string) => void;
  lookups: RelationLookups;
  operator: string;
}) {
  // "is one of" (multi-value OR). The stored value is a comma-separated string
  // that applyFilter() splits into an IN list. For enums we offer a multi-pick;
  // for free-text/number we take a comma-separated entry. (Summer's request.)
  if (operator === "in") {
    if (filterCol.type === "enum" && filterCol.enumValues) {
      const labelFn = getFilterEnumLabelFn(filterCol);
      const selected = value
        ? value.split(",").map((v) => v.trim()).filter(Boolean)
        : [];
      return (
        <div className="w-52">
          <MultiSelect
            options={filterCol.enumValues.map((ev) => ({
              value: ev,
              label: labelFn ? labelFn(ev) : ev,
            }))}
            value={selected}
            onChange={(next) => onChange(next.join(","))}
            placeholder="Select values"
          />
        </div>
      );
    }
    return (
      <Input
        className="w-52"
        placeholder="Comma-separated, e.g. Oregon, Washington"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  // Relation filter types: a type-to-search combobox (accounts are searched
  // server-side; contacts/owners/opps filter over the loaded lookups).
  if (isRelationFilterType(filterCol.type)) {
    const options = getRelationOptions(filterCol.type, lookups);
    return (
      <RelationCombobox type={filterCol.type} value={value} onChange={onChange} options={options} />
    );
  }

  if (filterCol.type === "enum" && filterCol.enumValues) {
    const labelFn = getFilterEnumLabelFn(filterCol);
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          {filterCol.enumValues.map((ev) => (
            <SelectItem key={ev} value={ev}>
              {labelFn ? labelFn(ev) : ev}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (filterCol.type === "boolean") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (filterCol.type === "date") {
    return (
      <Input
        type="date"
        className="w-52"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (filterCol.type === "number" || filterCol.type === "currency") {
    return (
      <Input
        type="number"
        className="w-52"
        placeholder="Value"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  return (
    <Input
      className="w-52"
      placeholder="Value"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FilterRow({
  entityKey,
  filter,
  index,
  onChange,
  onRemove,
  lookups,
}: {
  entityKey: string;
  filter: ReportFilter;
  index: number;
  onChange: (index: number, filter: ReportFilter) => void;
  onRemove: (index: number) => void;
  lookups: RelationLookups;
}) {
  const entity = getEntityDef(entityKey);
  const filterCol = getFilterColumnDef(entityKey, filter.field);
  const operators = filterCol ? getOperatorsForType(filterCol.type) : [];
  const needsValue = !["is_null", "is_not_null"].includes(filter.operator);

  return (
    <div className="flex items-end gap-2 flex-wrap">
      {/* Field */}
      <div className="w-48">
        <Select
          value={filter.field}
          onValueChange={(field) => {
            const newFilterCol = getFilterColumnDef(entityKey, field);
            const newOps = newFilterCol ? getOperatorsForType(newFilterCol.type) : [];
            const currentOpValid = newOps.some((op) => op.value === filter.operator);
            onChange(index, {
              field,
              operator: currentOpValid
                ? filter.operator
                : (newOps[0]?.value as ReportFilter["operator"]) ?? "eq",
              value: "",
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Field" />
          </SelectTrigger>
          <SelectContent>
            {entity.filterColumns.map((fcol) => (
              <SelectItem key={fcol.filterKey} value={fcol.filterKey}>
                {fcol.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Operator */}
      <div className="w-44">
        <Select
          value={filter.operator}
          onValueChange={(op) => {
            // Switching into/out of "is one of" flips the value between a
            // single value and a comma-separated list — clear it so a stale
            // single value doesn't sit in the multi-select (or vice versa).
            const crossesMulti = (op === "in") !== (filter.operator === "in");
            onChange(index, {
              ...filter,
              operator: op as ReportFilter["operator"],
              value: crossesMulti ? "" : filter.value,
            });
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder="Operator" />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op.value} value={op.value}>
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Value */}
      {needsValue && filterCol && (
        <FilterValueInput
          filterCol={filterCol}
          value={filter.value}
          onChange={(v) => onChange(index, { ...filter, value: v })}
          lookups={lookups}
          operator={filter.operator}
        />
      )}

      <Button variant="ghost" size="icon" onClick={() => onRemove(index)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FilterBuilder({
  entityKey,
  filters,
  onChange,
  lookups,
}: {
  entityKey: string;
  filters: ReportFilter[];
  onChange: (filters: ReportFilter[]) => void;
  lookups: RelationLookups;
}) {
  const entity = getEntityDef(entityKey);

  const addFilter = () => {
    const firstFC = entity.filterColumns[0];
    if (!firstFC) return;
    const ops = getOperatorsForType(firstFC.type);
    onChange([
      ...filters,
      {
        field: firstFC.filterKey,
        operator: (ops[0]?.value as ReportFilter["operator"]) ?? "eq",
        value: "",
      },
    ]);
  };

  const updateFilter = (index: number, filter: ReportFilter) => {
    const updated = [...filters];
    updated[index] = filter;
    onChange(updated);
  };

  const removeFilter = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <Label>Filters</Label>
      {filters.map((f, i) => (
        <FilterRow
          key={i}
          entityKey={entityKey}
          filter={f}
          index={i}
          onChange={updateFilter}
          onRemove={removeFilter}
          lookups={lookups}
        />
      ))}
      <Button variant="outline" size="sm" onClick={addFilter} className="mt-1">
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Filter
      </Button>
    </div>
  );
}

function SortSelector({
  entityKey,
  sort,
  onChange,
}: {
  entityKey: string;
  sort: ReportSort | undefined;
  onChange: (sort: ReportSort | undefined) => void;
}) {
  const entity = getEntityDef(entityKey);

  return (
    <div className="space-y-1.5">
      <Label>Sort</Label>
      <div className="flex items-center gap-2">
        <Select
          value={sort?.field ?? "__none__"}
          onValueChange={(field) => {
            if (field === "__none__") {
              onChange(undefined);
            } else {
              onChange({ field, direction: sort?.direction ?? "asc" });
            }
          }}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Default</SelectItem>
            {entity.columns.map((col) => (
              <SelectItem key={col.key} value={col.key}>
                {col.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {sort?.field && (
          <Select
            value={sort.direction}
            onValueChange={(dir) =>
              onChange({ field: sort.field, direction: dir as "asc" | "desc" })
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

type ViewMode = "table" | "bar" | "pie";

/** Returns true if a column type holds numeric data suitable for charting. */
function isNumericColType(type: ColumnDef["type"]): boolean {
  return type === "number" || type === "currency";
}

/** Returns true if a column type holds categorical / label data. */
function isLabelColType(type: ColumnDef["type"]): boolean {
  return type === "text" || type === "enum";
}

/** Auto-detect the best label column (first text/enum). */
function detectLabelColumn(cols: ColumnDef[]): ColumnDef | undefined {
  return cols.find((c) => isLabelColType(c.type));
}

/** Auto-detect the best value column (first numeric/currency). */
function detectValueColumn(cols: ColumnDef[]): ColumnDef | undefined {
  return cols.find((c) => isNumericColType(c.type));
}

/** Extract a raw number from a data row for charting. */
function extractNumber(row: Record<string, unknown>, key: string): number {
  const val = row[key];
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = Number(val.replace(/[,$]/g, ""));
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Results display — table + charts
// ---------------------------------------------------------------------------

function ResultsTable({
  entityKey,
  columns,
  data,
  isLoading,
  count,
}: {
  entityKey: string;
  columns: string[];
  data: Record<string, unknown>[];
  isLoading: boolean;
  count: number;
}) {
  const entity = getEntityDef(entityKey);
  const visibleCols = columns
    .map((key) => entity.columns.find((c) => c.key === key))
    .filter((c): c is ColumnDef => !!c);

  const numericCols = visibleCols.filter((c) => isNumericColType(c.type));
  const labelCols = visibleCols.filter((c) => isLabelColType(c.type));
  const hasChartableData = numericCols.length > 0 && data.length > 0;

  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // Click-to-sort the displayed rows (a transient DISPLAY sort layered on top of
  // the report's server-side sort — doesn't change the saved config). Null =
  // keep the order the rows came in.
  const [tableSort, setTableSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  // Axis selection state for bar chart
  const [barXKey, setBarXKey] = useState<string>(() => detectLabelColumn(visibleCols)?.key ?? "");
  const [barYKey, setBarYKey] = useState<string>(() => detectValueColumn(visibleCols)?.key ?? "");

  // Axis selection state for pie chart
  const [pieLabelKey, setPieLabelKey] = useState<string>(() => detectLabelColumn(visibleCols)?.key ?? "");
  const [pieValueKey, setPieValueKey] = useState<string>(() => detectValueColumn(visibleCols)?.key ?? "");

  // How to combine the value column per category. Defaulting to Sum is only
  // right for additive columns (Amount). For a percentage or FTE count, summing
  // is meaningless — Average or Count is what you want. Shared across bar/pie.
  const [chartAgg, setChartAgg] = useState<"sum" | "count" | "avg">("sum");

  // Re-detect defaults when columns change
  useMemo(() => {
    const defLabel = detectLabelColumn(visibleCols)?.key ?? "";
    const defValue = detectValueColumn(visibleCols)?.key ?? "";
    setBarXKey(defLabel);
    setBarYKey(defValue);
    setPieLabelKey(defLabel);
    setPieValueKey(defValue);
  }, [entityKey, columns.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="space-y-2 mt-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No results found. Adjust your filters or run the report.
      </div>
    );
  }

  // Build chart data — AGGREGATED by the selected category, not per-row.
  // (Previously this was a 1:1 row map, so X='Stage' rendered one bar per
  // opportunity instead of the sum of Amount per stage — the chart was
  // meaningless.) Inline (not useMemo) because we're past an early return,
  // where adding a hook would violate the rules of hooks.
  function aggregate(
    labelKey: string,
    valueKey: string,
    mode: "sum" | "count" | "avg",
  ) {
    // Count mode just tallies rows per category, so it doesn't need a value
    // column; sum/avg do.
    if (!labelKey || (mode !== "count" && !valueKey)) return [] as Record<string, unknown>[];
    const sums = new Map<string, number>();
    const counts = new Map<string, number>();
    const labelCol = visibleCols.find((c) => c.key === labelKey);
    for (const row of data) {
      const rawLabel = labelCol
        ? formatCellValue(row[labelKey], labelCol)
        : String(row[labelKey] ?? "");
      const label = rawLabel === "" || rawLabel == null ? "(blank)" : String(rawLabel);
      sums.set(label, (sums.get(label) ?? 0) + extractNumber(row, valueKey));
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, n]) => {
        const total = sums.get(label) ?? 0;
        const value = mode === "count" ? n : mode === "avg" ? (n ? total / n : 0) : total;
        return { [labelKey]: label, [valueKey]: value, __count: n };
      })
      .sort((a, b) => (b[valueKey] as number) - (a[valueKey] as number));
  }
  const barChartData = aggregate(barXKey, barYKey, chartAgg);
  const pieChartData = aggregate(pieLabelKey, pieValueKey, chartAgg);
  const aggLabel = chartAgg === "count" ? "Count" : chartAgg === "avg" ? "Average" : "Sum";

  // Click-to-sort: re-order the loaded rows by the active header. Numeric
  // columns sort numerically; everything else uses locale compare with blanks
  // pinned last. Inline (not a hook) because we're past the early returns.
  const toggleSort = (key: string) =>
    setTableSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );
  const sortedData = (() => {
    if (!tableSort) return data;
    const col = visibleCols.find((c) => c.key === tableSort.key);
    // The sorted column may have been removed since the click — fall back to the
    // unsorted order rather than silently sorting a now-gone column as text.
    if (!col) return data;
    const numeric = isNumericColType(col.type);
    const copy = [...data];
    copy.sort((a, b) => {
      const av = a[tableSort.key];
      const bv = b[tableSort.key];
      // Blank cells always sort last, regardless of direction or column type.
      const aEmpty = av == null || av === "";
      const bEmpty = bv == null || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;
      if (bEmpty) return -1;
      const cmp = numeric
        ? extractNumber(a, tableSort.key) - extractNumber(b, tableSort.key)
        : String(av).localeCompare(String(bv), undefined, {
            numeric: true,
            sensitivity: "base",
          });
      return tableSort.dir === "asc" ? cmp : -cmp;
    });
    return copy;
  })();

  // Totals row: sum each numeric/currency column across the LOADED rows. When
  // the set is capped at 1,000, totals cover the shown rows only (labeled).
  const columnTotals: Record<string, number> | null =
    numericCols.length > 0
      ? Object.fromEntries(
          numericCols.map((c) => [
            c.key,
            data.reduce((s, r) => s + extractNumber(r, c.key), 0),
          ]),
        )
      : null;
  const totalsCapped = data.length < count;
  const totalsLabelIndex = visibleCols.findIndex((c) => !isNumericColType(c.type));

  return (
    <div className="mt-6 space-y-3">
      {/* Header with result count and view mode toggle */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {count.toLocaleString()} result{count !== 1 ? "s" : ""}
          {count > 1000
            ? count > 100000
              ? ` (showing first 1,000 — export capped at 100,000 of ${count.toLocaleString()})`
              : ` (showing first 1,000 — export includes all ${count.toLocaleString()})`
            : ""}
        </p>

        {hasChartableData && (
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            <Button
              variant={viewMode === "table" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2.5 gap-1.5"
              onClick={() => setViewMode("table")}
            >
              <Table2 className="h-3.5 w-3.5" />
              Table
            </Button>
            <Button
              variant={viewMode === "bar" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2.5 gap-1.5"
              onClick={() => setViewMode("bar")}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              Bar Chart
            </Button>
            <Button
              variant={viewMode === "pie" ? "default" : "ghost"}
              size="sm"
              className="h-7 px-2.5 gap-1.5"
              onClick={() => setViewMode("pie")}
            >
              <PieChartIcon className="h-3.5 w-3.5" />
              Pie Chart
            </Button>
          </div>
        )}
      </div>

      {/* Table view */}
      {viewMode === "table" && (
        <div className="border rounded-md overflow-auto max-h-[70vh]">
          <Table>
            <TableHeader>
              <TableRow>
                {visibleCols.map((col) => {
                  const active = tableSort?.key === col.key;
                  return (
                    <TableHead
                      key={col.key}
                      className="sticky top-0 z-10 bg-background whitespace-nowrap"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        title="Sort by this column"
                      >
                        {col.label}
                        {active ? (
                          tableSort!.dir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((row, rowIdx) => {
                const detailUrl = getRowDetailUrl(entityKey, row);
                return (
                  <TableRow
                    // Stable identity so re-sorting reconciles rows by record,
                    // not by position. Falls back to the index when a report has
                    // no id column.
                    key={(row.id as string | undefined) ?? rowIdx}
                    className={detailUrl ? "cursor-pointer hover:bg-muted/50" : ""}
                    onClick={() => {
                      // Open in a new tab so the report (and the user's
                      // filters) stays put — they were losing their place
                      // every time they clicked into a record (#24).
                      if (detailUrl) window.open(detailUrl, "_blank", "noopener,noreferrer");
                    }}
                    title={detailUrl ? "Click to open record in a new tab" : undefined}
                  >
                    {visibleCols.map((col) => {
                      const rawValue = row[col.key];
                      const formatted = formatCellValue(rawValue, col);

                      return (
                        <TableCell key={col.key} className="whitespace-nowrap">
                          {col.type === "enum" ? (
                            <Badge variant="secondary">{formatted}</Badge>
                          ) : col.type === "boolean" ? (
                            <Badge variant={rawValue ? "default" : "outline"}>
                              {formatted}
                            </Badge>
                          ) : (
                            formatted
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
            {columnTotals && (
              <TableFooter>
                <TableRow>
                  {visibleCols.map((col, i) => {
                    let content = "";
                    if (isNumericColType(col.type)) {
                      content = formatCellValue(columnTotals[col.key] ?? 0, col);
                    } else if (i === totalsLabelIndex) {
                      content = `Totals${
                        totalsCapped ? ` (first ${data.length.toLocaleString()})` : ""
                      }`;
                    }
                    return (
                      <TableCell
                        key={col.key}
                        className="font-semibold whitespace-nowrap"
                      >
                        {content}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}

      {/* Bar Chart view */}
      {viewMode === "bar" && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <Label className="text-xs">X-Axis (Category)</Label>
              <Select value={barXKey} onValueChange={setBarXKey}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {labelCols.map((col) => (
                    <SelectItem key={col.key} value={col.key}>
                      {col.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Y-Axis (Value)</Label>
              <Select value={barYKey} onValueChange={setBarYKey} disabled={chartAgg === "count"}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {numericCols.map((col) => (
                    <SelectItem key={col.key} value={col.key}>
                      {col.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Combine by</Label>
              <Select value={chartAgg} onValueChange={(v) => setChartAgg(v as typeof chartAgg)}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sum">Sum</SelectItem>
                  <SelectItem value="avg">Average</SelectItem>
                  <SelectItem value="count">Count</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border rounded-md p-4">
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={barChartData}>
                <XAxis
                  dataKey={barXKey}
                  tick={{ fontSize: 12 }}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <RechartsTooltip />
                <RechartsLegend />
                <Bar
                  dataKey={barYKey}
                  name={
                    chartAgg === "count"
                      ? "Count"
                      : `${aggLabel} of ${visibleCols.find((c) => c.key === barYKey)?.label ?? barYKey}`
                  }
                >
                  {barChartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Pie Chart view */}
      {viewMode === "pie" && (
        <div className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Label</Label>
              <Select value={pieLabelKey} onValueChange={setPieLabelKey}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {labelCols.map((col) => (
                    <SelectItem key={col.key} value={col.key}>
                      {col.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Value</Label>
              <Select value={pieValueKey} onValueChange={setPieValueKey} disabled={chartAgg === "count"}>
                <SelectTrigger className="w-44 h-8 text-xs">
                  <SelectValue placeholder="Select column" />
                </SelectTrigger>
                <SelectContent>
                  {numericCols.map((col) => (
                    <SelectItem key={col.key} value={col.key}>
                      {col.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Combine by</Label>
              <Select value={chartAgg} onValueChange={(v) => setChartAgg(v as typeof chartAgg)}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sum">Sum</SelectItem>
                  <SelectItem value="avg">Average</SelectItem>
                  <SelectItem value="count">Count</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border rounded-md p-4">
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={pieChartData}
                  dataKey={pieValueKey}
                  nameKey={pieLabelKey}
                  cx="50%"
                  cy="50%"
                  outerRadius={150}
                  label
                >
                  {pieChartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <RechartsTooltip />
                <RechartsLegend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save Dialog — now includes folder
// ---------------------------------------------------------------------------

function SaveReportDialog({
  open,
  onOpenChange,
  onSave,
  defaultName,
  defaultFolder,
  defaultIsShared,
  existingFolders,
  isSaving,
  mode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string, isShared: boolean, folder: string | null) => void;
  defaultName: string;
  defaultFolder: string | null;
  defaultIsShared: boolean;
  existingFolders: string[];
  isSaving: boolean;
  mode: "create" | "update";
}) {
  const [name, setName] = useState(defaultName);
  const [isShared, setIsShared] = useState(defaultIsShared);
  const [folder, setFolder] = useState(defaultFolder ?? "");
  const [showNewFolder, setShowNewFolder] = useState(false);

  // Re-sync the form whenever the dialog opens or the target report
  // changes. (The old code used useState(initFn), which runs ONCE on
  // mount — so reopening for a different report kept the prior report's
  // name/folder/shared and could overwrite the wrong report.)
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setIsShared(defaultIsShared);
      setFolder(defaultFolder ?? "");
      setShowNewFolder(false);
    }
  }, [open, defaultName, defaultFolder, defaultIsShared]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Save Report" : "Update Report"}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Give your report a name so you can access it later."
              : "Update the saved report with your current configuration."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="report-name">Report Name</Label>
            <Input
              id="report-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Open Pipeline by Stage"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label>Folder (optional)</Label>
            {showNewFolder ? (
              <div className="flex items-center gap-2">
                <Input
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="New folder name"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowNewFolder(false);
                    setFolder("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Select
                  value={folder || "__none__"}
                  onValueChange={(v) => {
                    if (v === "__new__") {
                      setShowNewFolder(true);
                      setFolder("");
                    } else if (v === "__none__") {
                      setFolder("");
                    } else {
                      setFolder(v);
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="No folder" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No folder</SelectItem>
                    {existingFolders.map((f) => (
                      <SelectItem key={f} value={f}>
                        {f}
                      </SelectItem>
                    ))}
                    <SelectItem value="__new__">+ New folder...</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox
              checked={isShared}
              onCheckedChange={(checked) => setIsShared(checked === true)}
            />
            <span>Share with team</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || isSaving}
            onClick={() => onSave(name.trim(), isShared, folder.trim() || null)}
          >
            {isSaving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {mode === "create" ? "Save" : "Update"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarReportItem {
  report: SavedReport;
  isActive: boolean;
  isOwned: boolean;
  onLoad: () => void;
  onDelete: () => void;
}

function SidebarReportEntry({ report, isActive, isOwned, onLoad, onDelete }: SidebarReportItem) {
  return (
    <button
      onClick={onLoad}
      className={cn(
        "w-full text-left px-3 py-1.5 rounded-md text-sm flex items-center justify-between group transition-colors",
        isActive
          ? "bg-accent text-accent-foreground"
          : "hover:bg-muted"
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="truncate">{report.name}</span>
        {report.is_shared && (
          <Share2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        )}
      </div>
      {isOwned && (
        <button
          className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </button>
  );
}

function ReportsSidebar({
  savedReports,
  activeReportId,
  userId,
  onLoadReport,
  onDeleteReport,
  onNewReport,
}: {
  savedReports: SavedReport[];
  activeReportId: string | null;
  userId: string | undefined;
  onLoadReport: (report: SavedReport) => void;
  onDeleteReport: (id: string) => void;
  onNewReport: () => void;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (folder: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) {
        next.delete(folder);
      } else {
        next.add(folder);
      }
      return next;
    });
  };

  // Categorize reports
  const myReports = savedReports.filter(
    (r) => r.owner_user_id === userId && !r.folder
  );
  const sharedReports = savedReports.filter(
    (r) => r.owner_user_id !== userId && !r.folder
  );
  // Group foldered reports
  const folders = new Map<string, SavedReport[]>();
  for (const r of savedReports) {
    if (r.folder) {
      const list = folders.get(r.folder) ?? [];
      list.push(r);
      folders.set(r.folder, list);
    }
  }
  const sortedFolderNames = Array.from(folders.keys()).sort();

  const renderReport = (report: SavedReport) => (
    <SidebarReportEntry
      key={report.id}
      report={report}
      isActive={report.id === activeReportId}
      isOwned={report.owner_user_id === userId}
      onLoad={() => onLoadReport(report)}
      onDelete={() => onDeleteReport(report.id)}
    />
  );

  return (
    <div className="w-[250px] flex-shrink-0 border-r bg-muted/30 flex flex-col h-full">
      <div className="p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={onNewReport}
        >
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          New Report
        </Button>
      </div>

      <Separator />

      <ScrollArea className="flex-1 px-2 py-2">
        {/* My Reports */}
        {myReports.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
              My Reports
            </p>
            <div className="space-y-0.5">
              {myReports.map(renderReport)}
            </div>
          </div>
        )}

        {/* Shared Reports */}
        {sharedReports.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
              Shared
            </p>
            <div className="space-y-0.5">
              {sharedReports.map(renderReport)}
            </div>
          </div>
        )}

        {/* Folders */}
        {sortedFolderNames.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 mb-1">
              Folders
            </p>
            {sortedFolderNames.map((folderName) => {
              const isExpanded = expandedFolders.has(folderName);
              const folderReports = folders.get(folderName) ?? [];
              return (
                <div key={folderName}>
                  <button
                    onClick={() => toggleFolder(folderName)}
                    className="w-full text-left px-3 py-1.5 rounded-md text-sm flex items-center gap-1.5 hover:bg-muted transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{folderName}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {folderReports.length}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="ml-4 space-y-0.5">
                      {folderReports.map(renderReport)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state */}
        {savedReports.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground px-3">
            No saved reports yet. Build a report and save it to see it here.
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function ReportBuilder() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("builder");

  // Builder state
  const [config, setConfig] = useState<ReportConfig>(() => makeDefaultConfig("accounts"));
  const [hasRun, setHasRun] = useState(false);
  const [runTrigger, setRunTrigger] = useState(0);
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [activeReportName, setActiveReportName] = useState<string>("");
  const [activeReportFolder, setActiveReportFolder] = useState<string | null>(null);
  const [activeReportIsShared, setActiveReportIsShared] = useState(false);

  // Save dialog
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveMode, setSaveMode] = useState<"create" | "update">("create");

  // Queries
  const { data: savedReports } = useSavedReports();
  const { data: existingFolders } = useSavedReportFolders();
  const createReport = useCreateReport();
  const updateReport = useUpdateReport();
  const deleteReport = useDeleteReport();

  // Relation lookups for filter dropdowns
  const { data: usersData } = useUsers();
  const { data: accountsResult } = useAccounts();
  const accountsData = accountsResult?.data;
  const { data: contactsResult } = useContacts();
  const contactsData = contactsResult?.data;
  const { data: opportunitiesResult } = useOpportunities();
  const opportunitiesData = opportunitiesResult?.data;

  const lookups = useMemo<RelationLookups>(
    () => ({
      users: (usersData ?? []).map((u) => ({
        id: u.id as string,
        full_name: (u.full_name as string) ?? "Unknown",
      })),
      accounts: (accountsData ?? []).map((a) => ({
        id: a.id,
        name: a.name,
      })),
      contacts: (contactsData ?? []).map((c) => ({
        id: c.id,
        first_name: c.first_name,
        last_name: c.last_name,
      })),
      opportunities: (opportunitiesData ?? []).map((o) => ({
        id: o.id,
        name: o.name,
      })),
    }),
    [usersData, accountsData, contactsData, opportunitiesData]
  );

  // We pass a stable reference for the query to avoid re-fetching on every render
  const queryConfig = useMemo(() => (hasRun ? config : null), [hasRun, runTrigger]); // eslint-disable-line react-hooks/exhaustive-deps
  const {
    data: results,
    isLoading: resultsLoading,
    isFetching: resultsFetching,
  } = useRunReport(queryConfig, hasRun);

  // Exports must include EVERY row, not the 1,000-row display cap. Fetch
  // the full result set on demand (with a busy state) so a "complete"
  // CSV/XLSX can't silently drop most of the data.
  const [exporting, setExporting] = useState(false);
  const handleExport = useCallback(
    async (kind: "csv" | "xlsx") => {
      setExporting(true);
      try {
        const entity = getEntityDef(config.entity);
        const visibleCols = config.columns
          .map((key) => entity.columns.find((c) => c.key === key))
          .filter((c): c is ColumnDef => !!c);
        const rows = await fetchAllReportRows(config);
        if (rows.length >= 100000) {
          toast.warning(
            "Export is capped at 100,000 rows — some rows were omitted. Add filters to narrow the report.",
          );
        }
        if (kind === "csv") exportToCSV(visibleCols, rows, config.entity);
        else await exportToXLSX(visibleCols, rows, config.entity);
      } catch (err) {
        toast.error(
          "Export failed: " + (err instanceof Error ? err.message : String(err)),
        );
      } finally {
        setExporting(false);
      }
    },
    [config],
  );

  const handleEntityChange = useCallback((entityKey: string) => {
    setConfig(makeDefaultConfig(entityKey));
    setHasRun(false);
    setActiveReportId(null);
    setActiveReportName("");
    setActiveReportFolder(null);
    setActiveReportIsShared(false);
  }, []);

  const handleRunReport = () => {
    if (config.columns.length === 0) {
      toast.error("Select at least one column to run the report.");
      return;
    }
    setHasRun(true);
    setRunTrigger((t) => t + 1);
    // Make sure the user can see the results panel after they hit Run.
    setTimeout(() => {
      document
        .getElementById("report-results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  };

  const handleSave = async (name: string, isShared: boolean, folder: string | null) => {
    try {
      if (saveMode === "update" && activeReportId) {
        await updateReport.mutateAsync({
          id: activeReportId,
          name,
          config,
          is_shared: isShared,
          folder,
        });
        setActiveReportName(name);
        setActiveReportFolder(folder);
        setActiveReportIsShared(isShared);
        toast.success("Report updated.");
      } else {
        const saved = await createReport.mutateAsync({
          name,
          config,
          is_shared: isShared,
          folder,
        });
        setActiveReportId(saved.id);
        setActiveReportName(name);
        setActiveReportFolder(folder);
        setActiveReportIsShared(isShared);
        toast.success("Report saved.");
      }
      setSaveOpen(false);
    } catch {
      toast.error("Failed to save report.");
    }
  };

  const handleLoadReport = (report: SavedReport) => {
    setConfig(report.config);
    setActiveReportId(report.id);
    setActiveReportName(report.name);
    setActiveReportFolder(report.folder);
    setActiveReportIsShared(report.is_shared);
    // Auto-run when loading from the sidebar so the user sees rows
    // immediately instead of a blank builder + having to find the Run
    // button. They can still rebuild and re-run if they tweak filters.
    setHasRun(true);
    setRunTrigger((t) => t + 1);
    setActiveTab("builder");
    // Smoothly scroll to the results once they render.
    setTimeout(() => {
      document
        .getElementById("report-results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  };

  // Deep-link: the Reports landing opens a saved report via ?report=<id>.
  // Load it once (auto-runs), then strip the param so switching tabs or
  // re-rendering doesn't reload over the user's edits.
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkedRef = useRef<string | null>(null);
  useEffect(() => {
    // Accept ?report=<id> (the landing's cards) and the legacy ?load=<id>
    // (the dashboard SavedReportWidget links, which nothing consumed before).
    const id = searchParams.get("report") ?? searchParams.get("load");
    if (!id || !savedReports) return;
    if (deepLinkedRef.current === id) return;
    // Mark handled and strip the param up front — even if the report id is
    // missing/inaccessible — so a stale link doesn't linger in the URL and
    // re-fire this effect on every savedReports refetch.
    deepLinkedRef.current = id;
    const rep = savedReports.find((r) => r.id === id);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("report");
        next.delete("load");
        return next;
      },
      { replace: true },
    );
    if (rep) handleLoadReport(rep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, savedReports]);

  const handleDeleteReport = async (id: string) => {
    try {
      await deleteReport.mutateAsync(id);
      if (activeReportId === id) {
        setActiveReportId(null);
        setActiveReportName("");
        setActiveReportFolder(null);
        setActiveReportIsShared(false);
      }
      toast.success("Report deleted.");
    } catch {
      toast.error("Failed to delete report.");
    }
  };

  const handleNewReport = () => {
    setActiveReportId(null);
    setActiveReportName("");
    setActiveReportFolder(null);
    setActiveReportIsShared(false);
    setConfig(makeDefaultConfig("accounts"));
    setHasRun(false);
    setActiveTab("builder");
  };

  const handleOpenSave = () => {
    if (activeReportId) {
      setSaveMode("update");
    } else {
      setSaveMode("create");
    }
    setSaveOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Reports"
        description={activeReportName || "Build and run custom reports"}
      />

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <ReportsSidebar
          savedReports={savedReports ?? []}
          activeReportId={activeReportId}
          userId={user?.id}
          onLoadReport={handleLoadReport}
          onDeleteReport={handleDeleteReport}
          onNewReport={handleNewReport}
        />

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-auto">
          <div className="p-6">
            {/* Report Builder body (the old inner "Dashboard" sub-tab was
                removed 2026-04-19 — it duplicated the top-level Dashboards
                tab on /reports?tab=dashboards). activeTab is kept for
                future sub-tabs but currently always "builder". */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsContent value="builder" className="mt-0">
                {activeReportName && (
                  <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-lg font-semibold">{activeReportName}</h2>
                    {activeReportFolder && (
                      <Badge variant="outline" className="gap-1">
                        <FolderOpen className="h-3 w-3" />
                        {activeReportFolder}
                      </Badge>
                    )}
                    {activeReportIsShared && (
                      <Badge variant="secondary" className="gap-1">
                        <Share2 className="h-3 w-3" />
                        Shared
                      </Badge>
                    )}
                  </div>
                )}

                <Card>
                  <CardContent className="pt-6 space-y-6">
                    {/* Entity selector */}
                    <EntitySelector value={config.entity} onChange={handleEntityChange} />

                    {/* Column picker */}
                    <ColumnPicker
                      entityKey={config.entity}
                      selected={config.columns}
                      onChange={(columns) => setConfig((c) => ({ ...c, columns }))}
                    />

                    {/* Filters */}
                    <FilterBuilder
                      entityKey={config.entity}
                      filters={config.filters}
                      onChange={(filters) => setConfig((c) => ({ ...c, filters }))}
                      lookups={lookups}
                    />

                    {/* Sort */}
                    <SortSelector
                      entityKey={config.entity}
                      sort={config.sort}
                      onChange={(sort) => setConfig((c) => ({ ...c, sort }))}
                    />

                    {/* Action buttons */}
                    <div className="flex items-center gap-3 pt-2">
                      <Button onClick={handleRunReport} disabled={resultsFetching}>
                        {resultsFetching ? (
                          <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4 mr-1.5" />
                        )}
                        Run Report
                      </Button>
                      <Button variant="outline" onClick={handleOpenSave}>
                        <Save className="h-4 w-4 mr-1.5" />
                        {activeReportId ? "Save Changes" : "Save Report"}
                      </Button>
                      {activeReportId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSaveMode("create");
                            setSaveOpen(true);
                          }}
                        >
                          Save as New
                        </Button>
                      )}
                      {hasRun && (results?.data?.length ?? 0) > 0 && (
                        <>
                          <Button
                            variant="outline"
                            disabled={exporting}
                            onClick={() => handleExport("csv")}
                          >
                            <Download className="h-4 w-4 mr-1.5" />
                            {exporting ? "Exporting…" : "Export CSV"}
                          </Button>
                          <Button
                            variant="outline"
                            disabled={exporting}
                            onClick={() => handleExport("xlsx")}
                          >
                            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
                            {exporting ? "Exporting…" : "Export Excel"}
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Results */}
                    {hasRun && (
                      <div id="report-results">
                        <ResultsTable
                          entityKey={config.entity}
                          columns={config.columns}
                          data={results?.data ?? []}
                          isLoading={resultsLoading}
                          count={results?.count ?? 0}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      <SaveReportDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onSave={handleSave}
        defaultName={activeReportName}
        defaultFolder={activeReportFolder}
        defaultIsShared={activeReportIsShared}
        existingFolders={existingFolders ?? []}
        isSaving={createReport.isPending || updateReport.isPending}
        mode={saveMode}
      />
    </div>
  );
}
