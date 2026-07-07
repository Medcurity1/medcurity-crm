// Nexus Custom Report engine (jordan-v4-spec §6). Maps a
// CustomReportWidgetConfig ({entity, filters, sort, columns}) onto the
// same Supabase query semantics the full list pages use, then shapes the
// result into display rows the widget body can render dumbly.
//
// Design notes:
// - Filter semantics mirror each entity's api.ts: owner IN, tag filter via
//   the contact_tags!inner embed (Warm Leads preset), lowercase snake_case
//   stage values, archived_at IS NULL everywhere it exists.
// - `last_activity` on contacts isn't a column — it's derived from the
//   activities table (same coalesce the cold-call view uses). Filters or
//   sorts on it run client-side over a bounded fetch (CLIENT_EVAL_LIMIT),
//   which is plenty for a homepage preview widget.
// - Imports entity is the admin-only option; it reads import_runs the same
//   way importRunsApi.ts does (no archived concept there).

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  formatCurrency,
  formatDate,
  formatRelativeDate,
  formatName,
  stageLabel,
  statusLabel,
  customerStatusLabel,
  businessTypeLabel,
  teamLabel,
  industryCategoryLabel,
  ALL_STAGES,
  INDUSTRY_CATEGORY_LABELS,
} from "@/lib/formatters";
import type {
  AccountStatus,
  CustomerStatus,
  IndustryCategory,
  OpportunityBusinessType,
  OpportunityStage,
  OpportunityTeam,
  Tag,
} from "@/types/crm";
import type {
  CustomReportWidgetConfig,
  NexusReportEntity,
  NexusReportFilter,
} from "./types";
import { REPORT_MIN_COLUMNS, REPORT_MAX_COLUMNS } from "./types";

// ── Field / column registries ────────────────────────────────────────

export type ReportFilterKind = "multi" | "boolean" | "days" | "text";

export interface ReportFilterDef {
  field: string;
  label: string;
  kind: ReportFilterKind;
  /** For kind "multi": where the option list comes from. */
  optionsSource?: "owners" | "tags" | "picklist";
  /** For optionsSource "picklist": which admin-managed picklist to read
   *  (stays in sync when admins add/rename values — no code change). */
  picklistFieldKey?: string;
  staticOptions?: { value: string; label: string }[];
}

export interface ReportColumnDef {
  key: string;
  label: string;
  /** Sortable (server-side, or client-side for last_activity). */
  sortable: boolean;
  align?: "right";
}

const ACCOUNT_STATUS_OPTIONS = (
  ["discovery", "pending", "active", "inactive", "churned"] as AccountStatus[]
).map((v) => ({ value: v, label: statusLabel(v) }));

const CUSTOMER_STATUS_OPTIONS = (
  ["client", "prospect", "former_client"] as CustomerStatus[]
).map((v) => ({ value: v, label: customerStatusLabel(v) }));

const INDUSTRY_OPTIONS = Object.entries(INDUSTRY_CATEGORY_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

// Where a contact/opportunity came from (the public.lead_source enum). Lets
// reports filter e.g. "website leads" (Jordan's request).
const LEAD_SOURCE_OPTIONS = [
  { value: "website", label: "Website" },
  { value: "referral", label: "Referral" },
  { value: "cold_call", label: "Cold Call" },
  { value: "trade_show", label: "Trade Show" },
  { value: "partner", label: "Partner" },
  { value: "social_media", label: "Social Media" },
  { value: "email_campaign", label: "Email Campaign" },
  { value: "other", label: "Other" },
];

const STAGE_OPTIONS = ALL_STAGES.map((s) => ({ value: s, label: stageLabel(s) }));

const TEAM_OPTIONS = (["sales", "renewals"] as OpportunityTeam[]).map((v) => ({
  value: v,
  label: teamLabel(v),
}));

const BUSINESS_TYPE_OPTIONS = (
  [
    "new_business",
    "existing_business",
    "existing_business_new_product",
    "existing_business_new_service",
    "opportunity",
  ] as OpportunityBusinessType[]
).map((v) => ({ value: v, label: businessTypeLabel(v) }));

const IMPORT_STATUS_OPTIONS = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "reverted", label: "Reverted" },
  { value: "partially_reverted", label: "Partially reverted" },
];

const IMPORT_ENTITY_OPTIONS = [
  { value: "contacts", label: "Contacts" },
  { value: "accounts", label: "Accounts" },
  { value: "opportunities", label: "Opportunities" },
  { value: "leads", label: "Leads" },
];

const IMPORT_MODE_OPTIONS = [
  { value: "upsert", label: "Upsert" },
  { value: "update_specific_fields", label: "Update specific fields" },
];

export const REPORT_FILTERS: Record<NexusReportEntity, ReportFilterDef[]> = {
  contacts: [
    { field: "owner", label: "Owner", kind: "multi", optionsSource: "owners" },
    { field: "tags", label: "Tag", kind: "multi", optionsSource: "tags" },
    { field: "lead_source", label: "Lead Source", kind: "multi", staticOptions: LEAD_SOURCE_OPTIONS },
    { field: "last_activity", label: "Last Activity", kind: "days" },
    { field: "do_not_call", label: "Do Not Call", kind: "boolean" },
    { field: "no_longer_employed", label: "No Longer Employed", kind: "boolean" },
    { field: "do_not_contact", label: "Do Not Contact", kind: "boolean" },
    { field: "is_primary", label: "Primary Contact", kind: "boolean" },
    { field: "title", label: "Title contains", kind: "text" },
    { field: "state", label: "State (mailing)", kind: "text" },
    { field: "created", label: "Created", kind: "days" },
  ],
  accounts: [
    { field: "owner", label: "Owner", kind: "multi", optionsSource: "owners" },
    { field: "status", label: "Status", kind: "multi", staticOptions: ACCOUNT_STATUS_OPTIONS },
    { field: "customer_status", label: "Customer Status", kind: "multi", staticOptions: CUSTOMER_STATUS_OPTIONS },
    { field: "industry", label: "Industry", kind: "multi", staticOptions: INDUSTRY_OPTIONS },
    { field: "account_type", label: "Account Type contains", kind: "text" },
    { field: "partner_type", label: "Partner Type", kind: "multi", optionsSource: "picklist", picklistFieldKey: "accounts.partner_type" },
    { field: "state", label: "State (billing)", kind: "text" },
    { field: "created", label: "Created", kind: "days" },
  ],
  opportunities: [
    { field: "owner", label: "Owner", kind: "multi", optionsSource: "owners" },
    { field: "stage", label: "Stage", kind: "multi", staticOptions: STAGE_OPTIONS },
    { field: "team", label: "Team", kind: "multi", staticOptions: TEAM_OPTIONS },
    { field: "business_type", label: "Business Type", kind: "multi", staticOptions: BUSINESS_TYPE_OPTIONS },
    { field: "lead_source", label: "Lead Source", kind: "multi", staticOptions: LEAD_SOURCE_OPTIONS },
    { field: "created", label: "Created", kind: "days" },
  ],
  imports: [
    { field: "entity", label: "Entity", kind: "multi", staticOptions: IMPORT_ENTITY_OPTIONS },
    { field: "status", label: "Status", kind: "multi", staticOptions: IMPORT_STATUS_OPTIONS },
    { field: "mode", label: "Mode", kind: "multi", staticOptions: IMPORT_MODE_OPTIONS },
  ],
};

export const REPORT_COLUMNS: Record<NexusReportEntity, ReportColumnDef[]> = {
  contacts: [
    { key: "name", label: "Name", sortable: true },
    { key: "account", label: "Company", sortable: true },
    { key: "title", label: "Title", sortable: true },
    { key: "email", label: "Email", sortable: true },
    { key: "phone", label: "Phone", sortable: false },
    { key: "org_type", label: "Org Type", sortable: false },
    { key: "state", label: "State", sortable: false },
    { key: "tags", label: "Tags", sortable: false },
    { key: "last_activity", label: "Last Activity", sortable: true },
    { key: "owner", label: "Owner", sortable: false },
    { key: "created", label: "Created", sortable: true },
  ],
  accounts: [
    { key: "name", label: "Name", sortable: true },
    { key: "status", label: "Status", sortable: true },
    { key: "customer_status", label: "Customer Status", sortable: true },
    { key: "industry", label: "Industry", sortable: false },
    { key: "state", label: "State", sortable: true },
    { key: "contract_end", label: "Contract End", sortable: true },
    { key: "acv", label: "ACV", sortable: true, align: "right" },
    { key: "owner", label: "Owner", sortable: false },
    { key: "created", label: "Created", sortable: true },
  ],
  opportunities: [
    { key: "name", label: "Name", sortable: true },
    { key: "account", label: "Account", sortable: true },
    { key: "stage", label: "Stage", sortable: true },
    { key: "amount", label: "Amount", sortable: true, align: "right" },
    { key: "expected_close", label: "Expected Close", sortable: true },
    { key: "close_date", label: "Close Date", sortable: true },
    { key: "business_type", label: "Business Type", sortable: true },
    { key: "team", label: "Team", sortable: true },
    { key: "owner", label: "Owner", sortable: false },
    { key: "created", label: "Created", sortable: true },
  ],
  imports: [
    { key: "entity", label: "Entity", sortable: true },
    { key: "filename", label: "File", sortable: false },
    { key: "status", label: "Status", sortable: true },
    { key: "rows", label: "Rows", sortable: true, align: "right" },
    { key: "succeeded", label: "OK", sortable: true, align: "right" },
    { key: "failed", label: "Failed", sortable: true, align: "right" },
    { key: "user", label: "By", sortable: false },
    { key: "started", label: "Started", sortable: true },
  ],
};

/** Sensible starting columns per entity for a fresh widget. */
export const DEFAULT_REPORT_COLUMNS: Record<NexusReportEntity, string[]> = {
  contacts: ["name", "account", "title", "last_activity"],
  accounts: ["name", "status", "owner", "contract_end"],
  opportunities: ["name", "account", "stage", "amount"],
  imports: ["entity", "status", "rows", "started"],
};

export const DEFAULT_REPORT_SORT: Record<
  NexusReportEntity,
  { field: string; dir: "asc" | "desc" }
> = {
  contacts: { field: "created", dir: "desc" },
  accounts: { field: "created", dir: "desc" },
  opportunities: { field: "created", dir: "desc" },
  imports: { field: "started", dir: "desc" },
};

export function defaultReportConfig(
  entity: NexusReportEntity = "contacts",
): CustomReportWidgetConfig {
  return {
    entity,
    filters: [],
    sort: { ...DEFAULT_REPORT_SORT[entity] },
    columns: [...DEFAULT_REPORT_COLUMNS[entity]],
  };
}

/** Defensive normalize — widget configs come from JSONB and may be stale. */
export function normalizeReportConfig(raw: unknown): CustomReportWidgetConfig {
  const cfg = (raw ?? {}) as Partial<CustomReportWidgetConfig>;
  const entity: NexusReportEntity =
    cfg.entity && cfg.entity in REPORT_COLUMNS ? cfg.entity : "contacts";
  const registry = REPORT_COLUMNS[entity];
  const known = new Set(registry.map((c) => c.key));
  let columns = Array.isArray(cfg.columns)
    ? cfg.columns.filter((c) => known.has(c)).slice(0, REPORT_MAX_COLUMNS)
    : [];
  if (columns.length < REPORT_MIN_COLUMNS) {
    columns = [...DEFAULT_REPORT_COLUMNS[entity]];
  }
  const sortable = new Set(registry.filter((c) => c.sortable).map((c) => c.key));
  const sort =
    cfg.sort && sortable.has(cfg.sort.field)
      ? { field: cfg.sort.field, dir: cfg.sort.dir === "asc" ? ("asc" as const) : ("desc" as const) }
      : { ...DEFAULT_REPORT_SORT[entity] };
  const filterFields = new Set(REPORT_FILTERS[entity].map((f) => f.field));
  const filters = Array.isArray(cfg.filters)
    ? cfg.filters.filter((f) => f && filterFields.has(f.field))
    : [];
  return { entity, filters, sort, columns };
}

// ── Display row shape ────────────────────────────────────────────────

export type ReportCell =
  | { kind: "text"; text: string }
  | { kind: "tags"; tags: Tag[] };

export interface ReportRow {
  id: string;
  /** Detail link for the primary (name) cell; null for imports. */
  href: string | null;
  cells: Record<string, ReportCell>;
}

/** All searchable text in a row (in-widget search, spec §10). */
export function rowSearchText(row: ReportRow): string {
  return Object.values(row.cells)
    .map((c) => (c.kind === "text" ? c.text : c.tags.map((t) => t.name).join(" ")))
    .join(" ")
    .toLowerCase();
}

// ── Query building ───────────────────────────────────────────────────

/** Bound on the fetch when a filter/sort must be evaluated client-side. */
const CLIENT_EVAL_LIMIT = 200;

const ILIKE_ESCAPE = /[(),%]/g;

function daysAgoISO(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * Latest activity timestamp per related record (contact_id or
 * opportunity_id), derived exactly like the cold-call view: max
 * effective_at over non-archived activities. Chunked + ordered-desc so
 * each id's newest activity is seen first; bounded per chunk (a widget
 * preview doesn't need forensic precision on ancient records).
 */
export async function fetchLastActivityMap(
  idColumn: "contact_id" | "opportunity_id",
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const CHUNK = 25;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("activities")
      .select(`${idColumn}, effective_at`)
      .in(idColumn, chunk)
      .is("archived_at", null)
      .order("effective_at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Array<Record<string, string | null>>) {
      const id = row[idColumn];
      const at = row.effective_at;
      if (id && at && !map.has(id)) map.set(id, at);
    }
  }
  return map;
}

/** Tags per contact for a page of ids (mirrors useContactTagsMap). */
async function fetchContactTagsMap(ids: string[]): Promise<Map<string, Tag[]>> {
  const map = new Map<string, Tag[]>();
  if (!ids.length) return map;
  const { data, error } = await supabase
    .from("contact_tags")
    .select("contact_id, tag:tags(*)")
    .in("contact_id", ids);
  if (error) throw error;
  const rows = (data ?? []) as unknown as { contact_id: string; tag: Tag | null }[];
  for (const r of rows) {
    if (!r.tag) continue;
    const arr = map.get(r.contact_id) ?? [];
    arr.push(r.tag);
    map.set(r.contact_id, arr);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
  return map;
}

interface RawRecord {
  id: string;
  [key: string]: unknown;
}

/** Server-side ORDER BY spec for a sortable column key, per entity. */
function serverSortSpec(
  entity: NexusReportEntity,
  field: string,
): { column: string; referencedTable?: string } | null {
  const maps: Record<NexusReportEntity, Record<string, { column: string; referencedTable?: string }>> = {
    contacts: {
      name: { column: "last_name" },
      account: { column: "name", referencedTable: "account" },
      title: { column: "title" },
      email: { column: "email" },
      created: { column: "created_at" },
      // last_activity: client-side
    },
    accounts: {
      name: { column: "name" },
      status: { column: "status" },
      customer_status: { column: "customer_status" },
      state: { column: "billing_state" },
      contract_end: { column: "current_contract_end_date" },
      acv: { column: "acv" },
      created: { column: "created_at" },
    },
    opportunities: {
      name: { column: "name" },
      account: { column: "name", referencedTable: "account" },
      stage: { column: "stage" },
      amount: { column: "amount" },
      expected_close: { column: "expected_close_date" },
      close_date: { column: "close_date" },
      business_type: { column: "business_type" },
      team: { column: "team" },
      created: { column: "created_at" },
    },
    imports: {
      entity: { column: "entity" },
      status: { column: "status" },
      rows: { column: "total_rows" },
      succeeded: { column: "succeeded_count" },
      failed: { column: "failed_count" },
      started: { column: "started_at" },
    },
  };
  return maps[entity][field] ?? null;
}

/** DB column for a multi/boolean/text filter field, per entity. */
function filterColumn(entity: NexusReportEntity, field: string): string | null {
  const maps: Record<NexusReportEntity, Record<string, string>> = {
    contacts: {
      owner: "owner_user_id",
      lead_source: "lead_source",
      do_not_call: "do_not_call",
      no_longer_employed: "no_longer_employed",
      do_not_contact: "do_not_contact",
      is_primary: "is_primary",
      title: "title",
      state: "mailing_state",
      created: "created_at",
    },
    accounts: {
      owner: "owner_user_id",
      status: "status",
      customer_status: "customer_status",
      industry: "industry_category",
      account_type: "account_type",
      partner_type: "partner_type",
      state: "billing_state",
      created: "created_at",
    },
    opportunities: {
      owner: "owner_user_id",
      stage: "stage",
      team: "team",
      business_type: "business_type",
      lead_source: "lead_source",
      created: "created_at",
    },
    imports: {
      entity: "entity",
      status: "status",
      mode: "mode",
    },
  };
  return maps[entity][field] ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(entity: NexusReportEntity, query: any, filters: NexusReportFilter[]): any {
  for (const f of filters) {
    if (entity === "contacts" && f.field === "tags") {
      const ids = Array.isArray(f.value) ? f.value : [];
      if (ids.length) query = query.in("contact_tags.tag_id", ids);
      continue;
    }
    if (f.field === "last_activity") continue; // client-side
    const col = filterColumn(entity, f.field);
    if (!col) continue;
    switch (f.op) {
      case "in": {
        const vals = Array.isArray(f.value) ? f.value : [];
        if (vals.length) query = query.in(col, vals);
        break;
      }
      case "eq":
        query = query.eq(col, f.value);
        break;
      case "contains": {
        const term = String(f.value ?? "").replace(ILIKE_ESCAPE, " ").trim();
        if (term) query = query.ilike(col, `%${term}%`);
        break;
      }
      case "older_than_days": {
        const n = Number(f.value);
        if (Number.isFinite(n) && n > 0) query = query.lte(col, daysAgoISO(n));
        break;
      }
      case "newer_than_days": {
        const n = Number(f.value);
        if (Number.isFinite(n) && n > 0) query = query.gte(col, daysAgoISO(n));
        break;
      }
      default:
        break;
    }
  }
  return query;
}

// ── Cell rendering per entity ────────────────────────────────────────

function text(value: unknown): ReportCell {
  const s =
    value === null || value === undefined || value === "" ? "—" : String(value);
  return { kind: "text", text: s };
}

function contactCells(
  r: RawRecord,
  lastActivity: Map<string, string>,
  tags: Map<string, Tag[]>,
): Record<string, ReportCell> {
  const account = r.account as { name?: string; account_type?: string | null; billing_state?: string | null } | null;
  const owner = r.owner as { full_name?: string | null } | null;
  const la = lastActivity.get(r.id);
  return {
    name: text(formatName(String(r.first_name ?? ""), String(r.last_name ?? ""))),
    account: text(account?.name),
    title: text(r.title),
    email: text(r.email),
    phone: text(r.phone),
    org_type: text(account?.account_type),
    state: text((r.mailing_state as string | null) ?? account?.billing_state),
    tags: { kind: "tags", tags: tags.get(r.id) ?? [] },
    last_activity: text(la ? formatRelativeDate(la) : "No activity"),
    owner: text(owner?.full_name),
    created: text(formatDate(r.created_at as string)),
  };
}

function accountCells(r: RawRecord): Record<string, ReportCell> {
  const owner = r.owner as { full_name?: string | null } | null;
  return {
    name: text(r.name),
    status: text(r.status ? statusLabel(r.status as AccountStatus) : null),
    customer_status: text(customerStatusLabel(r.customer_status as CustomerStatus | null)),
    industry: text(
      r.industry_category
        ? industryCategoryLabel(r.industry_category as IndustryCategory)
        : (r.industry as string | null),
    ),
    state: text(r.billing_state),
    contract_end: text(formatDate(r.current_contract_end_date as string | null)),
    acv: text(r.acv == null ? null : formatCurrency(Number(r.acv))),
    owner: text(owner?.full_name),
    created: text(formatDate(r.created_at as string)),
  };
}

function opportunityCells(r: RawRecord): Record<string, ReportCell> {
  const account = r.account as { name?: string } | null;
  const owner = r.owner as { full_name?: string | null } | null;
  return {
    name: text(r.name),
    account: text(account?.name),
    stage: text(stageLabel(r.stage as OpportunityStage)),
    amount: text(formatCurrency(Number(r.amount ?? 0))),
    expected_close: text(formatDate(r.expected_close_date as string | null)),
    close_date: text(formatDate(r.close_date as string | null)),
    business_type: text(businessTypeLabel(r.business_type as OpportunityBusinessType | null)),
    team: text(teamLabel(r.team as OpportunityTeam)),
    owner: text(owner?.full_name),
    created: text(formatDate(r.created_at as string)),
  };
}

const IMPORT_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  IMPORT_STATUS_OPTIONS.map((o) => [o.value, o.label]),
);

function importCells(r: RawRecord): Record<string, ReportCell> {
  return {
    entity: text(r.entity),
    filename: text(r.filename),
    status: text(IMPORT_STATUS_LABELS[String(r.status)] ?? r.status),
    rows: text(r.total_rows),
    succeeded: text(r.succeeded_count),
    failed: text(r.failed_count),
    user: text(r.user_email),
    started: text(formatDate(r.started_at as string)),
  };
}

// ── The hook ─────────────────────────────────────────────────────────

const SELECTS: Record<NexusReportEntity, string> = {
  contacts:
    "id, first_name, last_name, title, email, phone, mailing_state, created_at, " +
    "account:accounts!account_id(id, name, account_type, billing_state), " +
    "owner:user_profiles!owner_user_id(id, full_name)",
  accounts:
    "id, name, status, customer_status, industry, industry_category, billing_state, " +
    "current_contract_end_date, acv, created_at, " +
    "owner:user_profiles!owner_user_id(id, full_name)",
  opportunities:
    "id, name, stage, amount, business_type, team, expected_close_date, close_date, created_at, " +
    "account:accounts!account_id(id, name), " +
    "owner:user_profiles!owner_user_id(id, full_name)",
  imports:
    "id, entity, filename, status, total_rows, succeeded_count, failed_count, user_email, started_at",
};

const TABLES: Record<NexusReportEntity, string> = {
  contacts: "contacts",
  accounts: "accounts",
  opportunities: "opportunities",
  imports: "import_runs",
};

export function useNexusReport(rawConfig: unknown, previewCount: number) {
  const config = normalizeReportConfig(rawConfig);
  return useQuery({
    queryKey: ["nexus-widget-data", "custom_report", config, previewCount],
    queryFn: async (): Promise<ReportRow[]> => {
      const { entity, filters, sort, columns } = config;

      const wantsLastActivity =
        entity === "contacts" &&
        (columns.includes("last_activity") ||
          sort.field === "last_activity" ||
          filters.some((f) => f.field === "last_activity"));
      const clientEval =
        entity === "contacts" &&
        (sort.field === "last_activity" ||
          filters.some((f) => f.field === "last_activity"));

      const hasTagFilter =
        entity === "contacts" &&
        filters.some((f) => f.field === "tags" && Array.isArray(f.value) && f.value.length > 0);
      const select =
        SELECTS[entity] + (hasTagFilter ? ", contact_tags!inner(tag_id)" : "");

      let query = supabase.from(TABLES[entity]).select(select);
      // Archive convention: import_runs has no archived_at; everything
      // else hides archived rows, matching the list pages.
      if (entity !== "imports") query = query.is("archived_at", null);
      query = applyFilters(entity, query, filters);

      // Sort server-side when we can; the client-eval path re-sorts below.
      const spec = clientEval ? null : serverSortSpec(entity, sort.field);
      if (spec) {
        query = query.order(spec.column, {
          ascending: sort.dir === "asc",
          nullsFirst: false,
          ...(spec.referencedTable ? { referencedTable: spec.referencedTable } : {}),
        });
      } else {
        const fallback = entity === "imports" ? "started_at" : "created_at";
        query = query.order(fallback, { ascending: false });
      }
      // Stable tiebreak (house convention).
      query = query.order("id", { ascending: true });
      query = query.limit(clientEval ? CLIENT_EVAL_LIMIT : previewCount);

      const { data, error } = await query;
      if (error) throw error;
      let rows = (data ?? []) as unknown as RawRecord[];

      // Client-side last_activity evaluation (contacts only).
      let lastActivity = new Map<string, string>();
      if (clientEval) {
        lastActivity = await fetchLastActivityMap(
          "contact_id",
          rows.map((r) => r.id),
        );
        for (const f of filters) {
          if (f.field !== "last_activity") continue;
          const n = Number(f.value);
          if (!Number.isFinite(n) || n <= 0) continue;
          const cutoff = Date.now() - n * 86_400_000;
          rows = rows.filter((r) => {
            const la = lastActivity.get(r.id);
            if (f.op === "older_than_days") {
              // Never-touched counts as "older than anything".
              return !la || new Date(la).getTime() <= cutoff;
            }
            return !!la && new Date(la).getTime() >= cutoff;
          });
        }
        if (sort.field === "last_activity") {
          const dir = sort.dir === "asc" ? 1 : -1;
          rows.sort((a, b) => {
            // asc = longest-untouched first; never-touched sorts oldest.
            const ta = lastActivity.get(a.id) ? new Date(lastActivity.get(a.id)!).getTime() : -Infinity;
            const tb = lastActivity.get(b.id) ? new Date(lastActivity.get(b.id)!).getTime() : -Infinity;
            return (ta - tb) * dir;
          });
        }
        rows = rows.slice(0, previewCount);
      }

      // Display-only enrichment for the final page of rows.
      const ids = rows.map((r) => r.id);
      if (wantsLastActivity && !clientEval) {
        lastActivity = await fetchLastActivityMap("contact_id", ids);
      }
      let tagsMap = new Map<string, Tag[]>();
      if (entity === "contacts" && columns.includes("tags")) {
        tagsMap = await fetchContactTagsMap(ids);
      }

      return rows.map((r): ReportRow => {
        const cellsAll =
          entity === "contacts"
            ? contactCells(r, lastActivity, tagsMap)
            : entity === "accounts"
              ? accountCells(r)
              : entity === "opportunities"
                ? opportunityCells(r)
                : importCells(r);
        const cells: Record<string, ReportCell> = {};
        for (const key of columns) {
          cells[key] = cellsAll[key] ?? text(null);
        }
        const href =
          entity === "contacts"
            ? `/contacts/${r.id}`
            : entity === "accounts"
              ? `/accounts/${r.id}`
              : entity === "opportunities"
                ? `/opportunities/${r.id}`
                : `/admin/imports/${r.id}`;
        return { id: r.id, href, cells };
      });
    },
  });
}

// ── View All link ────────────────────────────────────────────────────

/**
 * Deep link to the matching list page with equivalent URL filter params
 * when every configured filter is representable there; otherwise the
 * plain list page. Param names/formats mirror each list's useUrlState
 * hooks (comma-separated arrays, sort/sort_dir).
 */
export function buildViewAllLink(rawConfig: unknown): string {
  const { entity, filters, sort } = normalizeReportConfig(rawConfig);

  if (entity === "imports") return "/admin/imports";

  const base =
    entity === "contacts" ? "/contacts" : entity === "accounts" ? "/accounts" : "/opportunities";

  // filter field -> list URL param (only fields the list page can filter).
  const paramMap: Record<string, string> =
    entity === "contacts"
      ? { owner: "owner", tags: "tags" }
      : entity === "accounts"
        ? { owner: "owner", status: "status", customer_status: "customer", industry: "industry" }
        : { owner: "owner", stage: "stage", team: "team", business_type: "business_type" };

  const params = new URLSearchParams();
  for (const f of filters) {
    const param = paramMap[f.field];
    if (!param || f.op !== "in" || !Array.isArray(f.value) || !f.value.length) {
      return base; // not representable — fall back to the plain list
    }
    params.set(param, f.value.join(","));
  }

  // Sort is best-effort: include when the list page sorts by the same key.
  const sortKeyMap: Record<string, string> =
    entity === "contacts"
      ? { name: "last_name", account: "account.name", title: "title", email: "email" }
      : entity === "accounts"
        ? { name: "name", status: "status", customer_status: "customer_status", contract_end: "current_contract_end_date" }
        : {
            name: "name",
            account: "account.name",
            stage: "stage",
            business_type: "business_type",
            amount: "amount",
            expected_close: "expected_close_date",
          };
  const sortKey = sortKeyMap[sort.field];
  if (sortKey) {
    params.set("sort", sortKey);
    params.set("sort_dir", sort.dir);
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}
