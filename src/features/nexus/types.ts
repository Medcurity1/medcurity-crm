// Nexus widget types — mirrors supabase/migrations/20260703000000_nexus_widgets.sql.
// The config JSONB shape is discriminated by widget_type (see nexus-plan.md).

// ── Shared consts ────────────────────────────────────────────────────
/** Hard cap enforced by a BEFORE INSERT trigger on nexus_widgets. */
export const MAX_WIDGETS = 8;

/** Allowed preview row counts (DB check constraint). */
export const PREVIEW_COUNTS = [3, 5, 10] as const;
export type PreviewCount = (typeof PREVIEW_COUNTS)[number];
export const DEFAULT_PREVIEW_COUNT: PreviewCount = 5;

/** The 7-color widget accent palette (spec §10). */
export const NEXUS_WIDGET_COLORS = [
  "navy",
  "blue",
  "green",
  "red",
  "purple",
  "orange",
  "gray",
] as const;
export type NexusWidgetColor = (typeof NEXUS_WIDGET_COLORS)[number];

export const NEXUS_WIDGET_TYPES = [
  "tasks",
  "pipeline",
  "custom_report",
  "pinned_records",
  "requests",
  "campaign_touches",
  "wins",
  "cold_call",
  "recents",
  "list",
] as const;
export type NexusWidgetType = (typeof NEXUS_WIDGET_TYPES)[number];

// ── config shapes per widget_type ────────────────────────────────────

/** System widgets are always scoped to the widget owner — no config. */
export type TasksWidgetConfig = Record<string, never>;
export type PipelineWidgetConfig = Record<string, never>;
/** Campaign Touches (S7) — MY upcoming campaign-generated tasks, scoped to
 *  the widget owner just like Tasks/Pipeline. No config. */
export type CampaignTouchesWidgetConfig = Record<string, never>;
/** Recent Wins (Nexus Phase 2) — team-wide closed-won feed. No config. */
export type ColdCallWidgetConfig = Record<string, never>;
export type WinsWidgetConfig = Record<string, never>;
/** Recents (Nexus Phase 2) — the signed-in user's recently visited
 *  records, read from localStorage. No config. */
export type RecentsWidgetConfig = Record<string, never>;

/** Entities the custom report builder can target. Imports is admin-only. */
export type NexusReportEntity = "contacts" | "accounts" | "opportunities" | "imports";

export type NexusFilterOp =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "not_empty"
  /** value = number of days; e.g. Last Activity > 14 days ago. */
  | "older_than_days"
  | "newer_than_days"
  /** value = number of days AHEAD; date between today and today+N. */
  | "due_within_days"
  /** date strictly before today (no value; NULLs never match). */
  | "overdue";

export interface NexusReportFilter {
  field: string;
  op: NexusFilterOp;
  value?: string | number | boolean | string[] | null;
}

export interface CustomReportWidgetConfig {
  entity: NexusReportEntity;
  /** AND logic between conditions. */
  filters: NexusReportFilter[];
  sort: { field: string; dir: "asc" | "desc" };
  /** 3–6 columns; array order = display order (draggable). */
  columns: string[];
}

export const REPORT_MIN_COLUMNS = 3;
export const REPORT_MAX_COLUMNS = 6;

// (The Metrics WIDGET and its metric-registry types were removed
// 2026-08-04 — Nathan: superseded by the MetricsStrip. Stored rows were
// deleted by migration 20260804200000, which kept a backup table.)

export type PinnedRecordType = "contact" | "account" | "opportunity";

export interface PinnedRecordRef {
  type: PinnedRecordType;
  id: string;
}

export interface PinnedRecordsWidgetConfig {
  /** Array order = display order (drag-to-arrange). */
  records: PinnedRecordRef[];
}

/** One lead list rendered as widget rows (Summer, 8/4). */
export interface ListWidgetConfig {
  list_id: string | null;
}

export type RequestsWidgetCategory = "collateral" | "product" | "crm" | "all";

export interface RequestsWidgetConfig {
  category: RequestsWidgetCategory;
}

// ── Row types ────────────────────────────────────────────────────────

export interface NexusWidgetConfigMap {
  tasks: TasksWidgetConfig;
  pipeline: PipelineWidgetConfig;
  custom_report: CustomReportWidgetConfig;
  pinned_records: PinnedRecordsWidgetConfig;
  requests: RequestsWidgetConfig;
  campaign_touches: CampaignTouchesWidgetConfig;
  wins: WinsWidgetConfig;
  cold_call: ColdCallWidgetConfig;
  recents: RecentsWidgetConfig;
  list: ListWidgetConfig;
}

/** Any widget config (use the discriminated row types to narrow). */
export type NexusWidgetConfig = NexusWidgetConfigMap[NexusWidgetType];

interface NexusWidgetBase {
  id: string;
  user_id: string;
  position: number;
  name: string;
  color: NexusWidgetColor | null;
  icon: string | null;
  preview_count: PreviewCount;
  /**
   * Pinned above the "Your widgets" divider, into the briefing area
   * (migration 20260729200000). Set from Customize mode. The two-pin cap
   * is a client rule, not a constraint — see featured.ts.
   */
  featured: boolean;
  created_at: string;
  updated_at: string;
}

/** nexus_widgets row, discriminated on widget_type so config narrows. */
export type NexusWidget = {
  [T in NexusWidgetType]: NexusWidgetBase & {
    widget_type: T;
    config: NexusWidgetConfigMap[T];
  };
}[NexusWidgetType];

/** nexus_default_widgets row — same shape minus user_id. */
export type NexusDefaultWidget = {
  [T in NexusWidgetType]: Omit<NexusWidgetBase, "user_id"> & {
    widget_type: T;
    config: NexusWidgetConfigMap[T];
  };
}[NexusWidgetType];
