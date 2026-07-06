// WidgetBuilder — the "Add a Widget" / edit flow (spec §4) in a side
// Sheet. All six widget types are creatable (Stage C): TypeConfigPanel
// switches on widget_type and renders a per-type panel receiving
// { config, onConfigChange }; validateWidgetConfig gates save.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Ban,
  BarChart3,
  Inbox,
  Kanban,
  ListTodo,
  Pin,
  Table2,
} from "lucide-react";
import { cn } from "@/lib/utils";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  useAddDefaultWidget,
  useAddWidget,
  useUpdateDefaultWidget,
  useUpdateWidget,
} from "./api";
import {
  NEXUS_WIDGET_COLORS,
  NEXUS_WIDGET_TYPES,
  PREVIEW_COUNTS,
  DEFAULT_PREVIEW_COUNT,
  REPORT_MAX_COLUMNS,
  REPORT_MIN_COLUMNS,
  type CustomReportWidgetConfig,
  type NexusWidget,
  type NexusWidgetColor,
  type NexusWidgetConfig,
  type NexusWidgetType,
  type PreviewCount,
} from "./types";
import { NEXUS_WIDGET_ICONS, WIDGET_ACCENT_CLASSES } from "./WidgetShell";
import { defaultReportConfig, normalizeReportConfig } from "./report-engine";
import { CustomReportPanel } from "./panels/CustomReportPanel";
import { MetricsPanel, normalizeMetricsConfig } from "./panels/MetricsPanel";
import { PinnedRecordsPanel, normalizePinnedConfig } from "./panels/PinnedRecordsPanel";
import { RequestsPanel, normalizeRequestsConfig } from "./panels/RequestsPanel";
import { getMetricDef } from "./metrics";


/** Starting config per type for a freshly-picked widget type. */
function defaultConfigFor(type: NexusWidgetType): NexusWidgetConfig {
  switch (type) {
    case "custom_report":
      return defaultReportConfig();
    case "metrics":
      return normalizeMetricsConfig(null);
    case "pinned_records":
      return normalizePinnedConfig(null);
    case "requests":
      return normalizeRequestsConfig(null);
    default:
      return {};
  }
}

/**
 * Normalize a stored config for editing so what the panel SHOWS is what
 * gets saved (stored configs are JSONB and can predate the panels —
 * e.g. the migration-seeded Requests widget).
 */
function normalizeConfigFor(
  type: NexusWidgetType,
  raw: NexusWidgetConfig,
): NexusWidgetConfig {
  switch (type) {
    case "custom_report":
      return normalizeReportConfig(raw);
    case "metrics":
      return normalizeMetricsConfig(raw);
    case "pinned_records":
      return normalizePinnedConfig(raw);
    case "requests":
      return normalizeRequestsConfig(raw);
    default:
      return {};
  }
}

/**
 * Validation on save (spec + Stage C rules): custom_report needs a valid
 * entity, 3–6 columns and a sort; zero filters is allowed. An EMPTY
 * pinned widget is legal (it has its own empty state). Returns the
 * blocking problem, or null when saveable.
 */
export function validateWidgetConfig(
  type: NexusWidgetType,
  config: NexusWidgetConfig,
): string | null {
  if (type === "custom_report") {
    const cfg = config as Partial<CustomReportWidgetConfig>;
    if (!cfg.entity) return "Pick an entity to report on.";
    const cols = Array.isArray(cfg.columns) ? cfg.columns : [];
    if (cols.length < REPORT_MIN_COLUMNS || cols.length > REPORT_MAX_COLUMNS) {
      return `Pick ${REPORT_MIN_COLUMNS}–${REPORT_MAX_COLUMNS} columns.`;
    }
    if (!cfg.sort?.field) return "Pick a sort column.";
  }
  if (type === "metrics") {
    const metric = (config as { metric?: string }).metric;
    if (!getMetricDef(metric)) return "Pick a metric.";
  }
  return null;
}

const TYPE_META: Record<
  NexusWidgetType,
  { label: string; description: string; icon: typeof ListTodo; defaultName: string }
> = {
  tasks: {
    label: "Today's Tasks",
    description: "Your open tasks, sorted by due date then priority.",
    icon: ListTodo,
    defaultName: "Today's Tasks",
  },
  pipeline: {
    label: "Current Pipeline",
    description: "Your open opportunities, closest close date first.",
    icon: Kanban,
    defaultName: "Current Pipeline",
  },
  custom_report: {
    label: "Custom Report",
    description: "Build a report: entity, filters, sort, and columns.",
    icon: Table2,
    defaultName: "Custom Report",
  },
  metrics: {
    label: "Metrics",
    description: "A key stat as a big number or mini chart.",
    icon: BarChart3,
    defaultName: "Metrics",
  },
  pinned_records: {
    label: "Pinned Records",
    description: "Hand-picked contacts, accounts, or opportunities.",
    icon: Pin,
    defaultName: "Pinned Records",
  },
  requests: {
    label: "Requests",
    description: "Requests routed to you to review, with approve/deny.",
    icon: Inbox,
    defaultName: "Requests",
  },
};

export interface WidgetBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, edit this widget (pre-filled); otherwise create a new one. */
  widget?: NexusWidget | null;
  /** Position for a newly created widget — max(position) + 1. */
  nextPosition: number;
  /** Admin configure-for-user (Stage D); defaults to the signed-in user. */
  targetUserId?: string;
  /**
   * "user" (default) writes nexus_widgets; "default" writes the system
   * default layout (nexus_default_widgets — admin editor). Same builder
   * UI either way.
   */
  mode?: "user" | "default";
}

export function WidgetBuilder({
  open,
  onOpenChange,
  widget,
  nextPosition,
  targetUserId,
  mode = "user",
}: WidgetBuilderProps) {
  const isDefaultMode = mode === "default";
  const addWidget = useAddWidget();
  const updateWidget = useUpdateWidget();
  const addDefaultWidget = useAddDefaultWidget();
  const updateDefaultWidget = useUpdateDefaultWidget();
  const savePending = isDefaultMode
    ? addDefaultWidget.isPending || updateDefaultWidget.isPending
    : addWidget.isPending || updateWidget.isPending;
  const isEdit = !!widget;

  const [type, setType] = useState<NexusWidgetType>("tasks");
  const [name, setName] = useState(TYPE_META.tasks.defaultName);
  const [color, setColor] = useState<NexusWidgetColor | null>(null);
  const [icon, setIcon] = useState<string | null>(null);
  const [previewCount, setPreviewCount] =
    useState<PreviewCount>(DEFAULT_PREVIEW_COUNT);
  const [config, setConfig] = useState<NexusWidgetConfig>({});

  // Re-seed the form every time the sheet opens (create = defaults,
  // edit = the widget's current settings).
  useEffect(() => {
    if (!open) return;
    if (widget) {
      setType(widget.widget_type);
      setName(widget.name);
      setColor(widget.color);
      setIcon(widget.icon);
      setPreviewCount(widget.preview_count);
      setConfig(normalizeConfigFor(widget.widget_type, widget.config));
    } else {
      setType("tasks");
      setName(TYPE_META.tasks.defaultName);
      setColor(null);
      setIcon(null);
      setPreviewCount(DEFAULT_PREVIEW_COUNT);
      setConfig({});
    }
  }, [open, widget]);

  function handleTypeChange(next: NexusWidgetType) {
    // Keep a user-typed name; swap defaults only if the name is still the
    // previous type's default (or blank).
    if (!name.trim() || name === TYPE_META[type].defaultName) {
      setName(TYPE_META[next].defaultName);
    }
    // Metrics hides the preview-rows control — reset a stale count picked
    // for a previous type so it isn't silently persisted on the widget.
    if (next === "metrics") {
      setPreviewCount(DEFAULT_PREVIEW_COUNT);
    }
    // Returning to the widget's original type restores its saved config;
    // any other switch starts from that type's defaults.
    if (widget && next === widget.widget_type) {
      setConfig(normalizeConfigFor(next, widget.config));
    } else {
      setConfig(defaultConfigFor(next));
    }
    setType(next);
  }

  const configError = validateWidgetConfig(type, config);
  // The name is only gated by config validity / pending — a blank or
  // whitespace-only name is allowed because we fall back to the type's
  // default name on save (see effectiveName). This guarantees a widget
  // never persists with an empty title (which renders as a blank card).
  const canSave = !configError && !savePending;

  function handleSave() {
    if (!canSave) return;
    const effectiveName = name.trim() || TYPE_META[type].defaultName;
    const shared = {
      name: effectiveName,
      color,
      icon,
      preview_count: previewCount,
    };
    if (isEdit && widget) {
      const mutation = isDefaultMode ? updateDefaultWidget : updateWidget;
      mutation.mutate(
        {
          id: widget.id,
          patch: {
            ...shared,
            widget_type: type,
            config,
          },
        },
        {
          onSuccess: () => {
            toast.success("Widget updated");
            onOpenChange(false);
          },
        },
      );
    } else if (isDefaultMode) {
      addDefaultWidget.mutate(
        {
          ...shared,
          widget_type: type,
          position: nextPosition,
          config,
        },
        {
          onSuccess: () => {
            toast.success("Widget added to the default layout");
            onOpenChange(false);
          },
        },
      );
    } else {
      addWidget.mutate(
        {
          ...shared,
          widget_type: type,
          position: nextPosition,
          config,
          userId: targetUserId,
        },
        {
          onSuccess: () => {
            toast.success("Widget added");
            onOpenChange(false);
          },
        },
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit Widget" : "Add a Widget"}</SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Change anything — the widget updates in place."
              : isDefaultMode
                ? "Pick a type, give it a name, and it appears at the bottom of the default layout. New users only."
                : "Pick a type, give it a name, and it appears at the bottom of your grid."}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-4">
          {/* 1. Type */}
          <div className="space-y-2">
            <Label>Widget type</Label>
            <div className="grid grid-cols-1 gap-2">
              {NEXUS_WIDGET_TYPES.map((t) => {
                const meta = TYPE_META[t];
                const Icon = meta.icon;
                const selected = type === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTypeChange(t)}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50",
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{meta.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {meta.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Name */}
          <div className="space-y-2">
            <Label htmlFor="widget-name">Name</Label>
            <Input
              id="widget-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name your widget"
              maxLength={60}
            />
          </div>

          {/* 3. Color */}
          <div className="space-y-2">
            <Label>Color accent</Label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setColor(null)}
                title="No accent"
                aria-label="No accent"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border text-muted-foreground",
                  color === null && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
              {NEXUS_WIDGET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  title={c}
                  aria-label={`${c} accent`}
                  className={cn(
                    "h-7 w-7 rounded-full",
                    WIDGET_ACCENT_CLASSES[c],
                    color === c &&
                      "ring-2 ring-ring ring-offset-2 ring-offset-background",
                  )}
                />
              ))}
            </div>
          </div>

          {/* 3b. Icon (optional) */}
          <div className="space-y-2">
            <Label>Icon (optional)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIcon(null)}
                title="No icon"
                aria-label="No icon"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md border text-muted-foreground",
                  icon === null && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
              >
                <Ban className="h-3.5 w-3.5" />
              </button>
              {Object.entries(NEXUS_WIDGET_ICONS).map(([key, Icon]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  title={key}
                  aria-label={`${key} icon`}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted/50",
                    icon === key &&
                      "ring-2 ring-ring ring-offset-2 ring-offset-background bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {/* 4-7. Per-type configuration */}
          <TypeConfigPanel type={type} config={config} onConfigChange={setConfig} />

          {/* 8. Preview count (not applicable to single-stat Metrics) */}
          {type !== "metrics" && (
            <div className="space-y-2">
              <Label>Preview rows</Label>
              <Select
                value={String(previewCount)}
                onValueChange={(v) => setPreviewCount(Number(v) as PreviewCount)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PREVIEW_COUNTS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} rows
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How many rows show before the View All link.
              </p>
            </div>
          )}
        </div>

        <SheetFooter className="flex-row items-center justify-end gap-2 px-4">
          {configError && (
            <p className="mr-auto text-xs text-destructive">{configError}</p>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {isEdit ? "Save Changes" : "Add Widget"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── Per-type config panels ───────────────────────────────────────────
// Each panel receives the draft config and a setter; the builder
// persists whatever the panel produced on save.

export interface TypeConfigPanelProps {
  type: NexusWidgetType;
  config: NexusWidgetConfig;
  onConfigChange: (config: NexusWidgetConfig) => void;
}

function TypeConfigPanel({ type, config, onConfigChange }: TypeConfigPanelProps) {
  switch (type) {
    case "tasks":
      return (
        <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-3">
          Always shows the page owner's open tasks — nothing to configure.
        </p>
      );
    case "pipeline":
      return (
        <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-3">
          Always shows the page owner's open opportunities — nothing to
          configure.
        </p>
      );
    case "custom_report":
      return <CustomReportPanel config={config} onConfigChange={onConfigChange} />;
    case "metrics":
      return <MetricsPanel config={config} onConfigChange={onConfigChange} />;
    case "pinned_records":
      return <PinnedRecordsPanel config={config} onConfigChange={onConfigChange} />;
    case "requests":
      return <RequestsPanel config={config} onConfigChange={onConfigChange} />;
  }
}
