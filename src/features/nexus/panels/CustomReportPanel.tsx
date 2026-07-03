// Custom Report builder panel (jordan-v4-spec §4 step 4, §6): entity →
// filter rows (add/remove, field-appropriate inputs) → sort → ordered
// columns (3–6, up/down reorder). Filter options reuse the same lists
// the full list-view filters use (owners, tags, stage/status enums).

import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { useUsers } from "@/features/accounts/api";
import { useTags } from "@/features/tags/api";
import { MultiSelect } from "@/components/MultiSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultReportConfig,
  normalizeReportConfig,
  REPORT_COLUMNS,
  REPORT_FILTERS,
  type ReportFilterDef,
} from "../report-engine";
import {
  REPORT_MAX_COLUMNS,
  REPORT_MIN_COLUMNS,
  type CustomReportWidgetConfig,
  type NexusReportEntity,
  type NexusReportFilter,
} from "../types";

const ENTITY_LABELS: Record<NexusReportEntity, string> = {
  contacts: "Contacts",
  accounts: "Accounts",
  opportunities: "Opportunities",
  imports: "Imports (admin)",
};

/** Fresh filter row with the right default op/value for the field kind. */
function newFilter(def: ReportFilterDef): NexusReportFilter {
  switch (def.kind) {
    case "multi":
      return { field: def.field, op: "in", value: [] };
    case "boolean":
      return { field: def.field, op: "eq", value: true };
    case "days":
      return { field: def.field, op: "older_than_days", value: 14 };
    case "text":
      return { field: def.field, op: "contains", value: "" };
  }
}

export function CustomReportPanel({
  config: rawConfig,
  onConfigChange,
}: {
  config: unknown;
  onConfigChange: (config: CustomReportWidgetConfig) => void;
}) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const config = normalizeReportConfig(rawConfig);
  const { data: users } = useUsers();
  const { data: tags } = useTags();

  const filterDefs = REPORT_FILTERS[config.entity];
  const columnDefs = REPORT_COLUMNS[config.entity];
  const sortableDefs = columnDefs.filter((c) => c.sortable);

  const entities = (
    Object.keys(ENTITY_LABELS) as NexusReportEntity[]
  ).filter((e) => e !== "imports" || isAdmin || config.entity === "imports");

  function patch(next: Partial<CustomReportWidgetConfig>) {
    onConfigChange({ ...config, ...next });
  }

  function setEntity(entity: NexusReportEntity) {
    if (entity === config.entity) return;
    // Filters / sort / columns are entity-specific — reset to defaults.
    onConfigChange(defaultReportConfig(entity));
  }

  function updateFilter(index: number, next: NexusReportFilter) {
    const filters = config.filters.map((f, i) => (i === index ? next : f));
    patch({ filters });
  }

  function removeFilter(index: number) {
    patch({ filters: config.filters.filter((_, i) => i !== index) });
  }

  function addFilter(field: string) {
    const def = filterDefs.find((d) => d.field === field);
    if (!def) return;
    patch({ filters: [...config.filters, newFilter(def)] });
  }

  function moveColumn(index: number, delta: -1 | 1) {
    const next = [...config.columns];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ columns: next });
  }

  function removeColumn(key: string) {
    if (config.columns.length <= REPORT_MIN_COLUMNS) return;
    patch({ columns: config.columns.filter((c) => c !== key) });
  }

  function addColumn(key: string) {
    if (config.columns.length >= REPORT_MAX_COLUMNS) return;
    patch({ columns: [...config.columns, key] });
  }

  function multiOptions(def: ReportFilterDef): { value: string; label: string }[] {
    if (def.optionsSource === "owners") {
      return ((users ?? []) as { id: string; full_name: string | null }[]).map(
        (u) => ({ value: u.id, label: u.full_name ?? "Unknown" }),
      );
    }
    if (def.optionsSource === "tags") {
      return (tags ?? []).map((t) => ({ value: t.id, label: t.name }));
    }
    return def.staticOptions ?? [];
  }

  const usedFilterFields = new Set(config.filters.map((f) => f.field));
  const addableFilters = filterDefs.filter((d) => !usedFilterFields.has(d.field));
  const addableColumns = columnDefs.filter((c) => !config.columns.includes(c.key));

  return (
    <div className="space-y-5 rounded-lg border bg-muted/20 p-3">
      {/* Entity */}
      <div className="space-y-2">
        <Label>Report on</Label>
        <Select value={config.entity} onValueChange={(v) => setEntity(v as NexusReportEntity)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {entities.map((e) => (
              <SelectItem key={e} value={e}>
                {ENTITY_LABELS[e]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <Label>Filters</Label>
        {config.filters.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No filters — the report shows everything. Add filters to narrow it.
          </p>
        )}
        <div className="space-y-2">
          {config.filters.map((filter, index) => {
            const def = filterDefs.find((d) => d.field === filter.field);
            if (!def) return null;
            return (
              <div key={def.field} className="flex items-start gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-medium">{def.label}</p>
                  {def.kind === "multi" && (
                    <MultiSelect
                      options={multiOptions(def)}
                      value={Array.isArray(filter.value) ? filter.value : []}
                      onChange={(vals) =>
                        updateFilter(index, { ...filter, op: "in", value: vals })
                      }
                      placeholder="Any"
                      className="w-full"
                      triggerClassName="w-full h-8 text-sm"
                    />
                  )}
                  {def.kind === "boolean" && (
                    <Select
                      value={filter.value === false ? "false" : "true"}
                      onValueChange={(v) =>
                        updateFilter(index, { ...filter, op: "eq", value: v === "true" })
                      }
                    >
                      <SelectTrigger className="h-8 w-full text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">Yes</SelectItem>
                        <SelectItem value="false">No</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  {def.kind === "days" && (
                    <div className="flex items-center gap-2">
                      <Select
                        value={filter.op === "newer_than_days" ? "newer_than_days" : "older_than_days"}
                        onValueChange={(v) =>
                          updateFilter(index, {
                            ...filter,
                            op: v as NexusReportFilter["op"],
                          })
                        }
                      >
                        <SelectTrigger className="h-8 flex-1 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="older_than_days">More than</SelectItem>
                          <SelectItem value="newer_than_days">Within the last</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        min={1}
                        className="h-8 w-20 text-sm"
                        value={String(filter.value ?? "")}
                        onChange={(e) =>
                          updateFilter(index, {
                            ...filter,
                            value: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                      />
                      <span className="text-xs text-muted-foreground shrink-0">
                        days ago
                      </span>
                    </div>
                  )}
                  {def.kind === "text" && (
                    <Input
                      className="h-8 text-sm"
                      placeholder="Contains…"
                      value={String(filter.value ?? "")}
                      onChange={(e) =>
                        updateFilter(index, { ...filter, op: "contains", value: e.target.value })
                      }
                    />
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 mt-5 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeFilter(index)}
                  aria-label={`Remove ${def.label} filter`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
        {addableFilters.length > 0 && (
          <Select value="" onValueChange={addFilter}>
            <SelectTrigger className="h-8 w-full text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add filter
              </span>
            </SelectTrigger>
            <SelectContent>
              {addableFilters.map((d) => (
                <SelectItem key={d.field} value={d.field}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Sort */}
      <div className="space-y-2">
        <Label>Sort by</Label>
        <div className="flex items-center gap-2">
          <Select
            value={config.sort.field}
            onValueChange={(field) => patch({ sort: { ...config.sort, field } })}
          >
            <SelectTrigger className="h-8 flex-1 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sortableDefs.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={config.sort.dir}
            onValueChange={(dir) =>
              patch({ sort: { ...config.sort, dir: dir as "asc" | "desc" } })
            }
          >
            <SelectTrigger className="h-8 w-32 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Columns */}
      <div className="space-y-2">
        <Label>
          Columns{" "}
          <span className="font-normal text-muted-foreground">
            ({config.columns.length} of {REPORT_MIN_COLUMNS}–{REPORT_MAX_COLUMNS})
          </span>
        </Label>
        <div className="space-y-1">
          {config.columns.map((key, index) => {
            const col = columnDefs.find((c) => c.key === key);
            if (!col) return null;
            return (
              <div
                key={key}
                className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{col.label}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={() => moveColumn(index, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${col.label} up`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={() => moveColumn(index, 1)}
                  disabled={index === config.columns.length - 1}
                  aria-label={`Move ${col.label} down`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => removeColumn(key)}
                  disabled={config.columns.length <= REPORT_MIN_COLUMNS}
                  aria-label={`Remove ${col.label} column`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
        {addableColumns.length > 0 && config.columns.length < REPORT_MAX_COLUMNS && (
          <Select value="" onValueChange={addColumn}>
            <SelectTrigger className="h-8 w-full text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add column
              </span>
            </SelectTrigger>
            <SelectContent>
              {addableColumns.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
