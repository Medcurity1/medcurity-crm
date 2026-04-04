import { useState, useCallback, useMemo } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { ReportsDashboard } from "./ReportsDashboard";
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
  useCreateReport,
  useUpdateReport,
  useDeleteReport,
} from "./report-api";
import { useAuth } from "@/features/auth/AuthProvider";
import { useUsers, useAccounts } from "@/features/accounts/api";
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
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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

  const openSheet = () => {
    setDraft(selected);
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

  const labelFor = (key: string) =>
    entity.columns.find((c) => c.key === key)?.label ?? key;

  return (
    <div className="space-y-1.5">
      <Label>Columns</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((key) => (
          <Badge
            key={key}
            variant="secondary"
            className="gap-1 pr-1 cursor-default"
          >
            {labelFor(key)}
            <button
              type="button"
              onClick={() => removeColumn(key)}
              className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
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

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md flex flex-col">
          <SheetHeader>
            <SheetTitle>Select Columns</SheetTitle>
          </SheetHeader>

          <ScrollArea className="flex-1 -mx-4 px-4">
            <div className="space-y-5 py-2">
              {sortedGroups.map(([groupName, cols]) => (
                <div key={groupName}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {groupName}
                  </p>
                  <div className="space-y-1">
                    {cols.map((col) => (
                      <label
                        key={col.key}
                        className="flex items-center gap-2 text-sm cursor-pointer select-none py-1 px-1 rounded-md hover:bg-muted"
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
              ))}
            </div>
          </ScrollArea>

          <SheetFooter className="flex-row gap-2 justify-end border-t pt-4">
            <Button
              variant="outline"
              onClick={() => setSheetOpen(false)}
            >
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
}: {
  filterCol: FilterColumnDef;
  value: string;
  onChange: (v: string) => void;
  lookups: RelationLookups;
}) {
  // Relation filter types: render a Select with lookup data
  if (isRelationFilterType(filterCol.type)) {
    const options = getRelationOptions(filterCol.type, lookups);
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Select..." />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
          onValueChange={(op) =>
            onChange(index, { ...filter, operator: op as ReportFilter["operator"] })
          }
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

  return (
    <div className="mt-6 space-y-2">
      <p className="text-sm text-muted-foreground">
        {count.toLocaleString()} result{count !== 1 ? "s" : ""}
        {count > 1000 ? " (showing first 1,000)" : ""}
      </p>
      <div className="border rounded-md overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleCols.map((col) => (
                <TableHead key={col.key} className="whitespace-nowrap">
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((row, rowIdx) => (
              <TableRow key={rowIdx}>
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
            ))}
          </TableBody>
        </Table>
      </div>
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

  // Reset form when dialog opens with new defaults
  const resetKey = `${defaultName}-${defaultFolder}-${defaultIsShared}-${open}`;
  useState(() => {
    setName(defaultName);
    setIsShared(defaultIsShared);
    setFolder(defaultFolder ?? "");
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} key={resetKey}>
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
    setHasRun(false);
    setActiveTab("builder");
  };

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
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                <TabsTrigger value="builder">Report Builder</TabsTrigger>
              </TabsList>

              <TabsContent value="dashboard" className="mt-6">
                <ReportsDashboard />
              </TabsContent>

              <TabsContent value="builder" className="mt-6">
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
                        <Button
                          variant="outline"
                          onClick={() => {
                            const entity = getEntityDef(config.entity);
                            const visibleCols = config.columns
                              .map((key) => entity.columns.find((c) => c.key === key))
                              .filter((c): c is ColumnDef => !!c);
                            exportToCSV(visibleCols, results?.data ?? [], config.entity);
                          }}
                        >
                          <Download className="h-4 w-4 mr-1.5" />
                          Export CSV
                        </Button>
                      )}
                    </div>

                    {/* Results */}
                    {hasRun && (
                      <ResultsTable
                        entityKey={config.entity}
                        columns={config.columns}
                        data={results?.data ?? []}
                        isLoading={resultsLoading}
                        count={results?.count ?? 0}
                      />
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
