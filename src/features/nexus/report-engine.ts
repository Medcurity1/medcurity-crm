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
  customerStatusLabel,
  businessTypeLabel,
  teamLabel,
  industryCategoryLabel,
  ALL_STAGES,
  OPEN_STAGES,
  INDUSTRY_CATEGORY_LABELS,
} from "@/lib/formatters";
import { formatPhone } from "@/components/PhoneInput";
import type {
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

/** "days" = past window (older/newer than N days ago); "due" = future
 *  window on a date column (due within N days / overdue). */
export type ReportFilterKind = "multi" | "boolean" | "days" | "due" | "text";

export interface ReportFilterDef {
  field: string;
  label: string;
  kind: ReportFilterKind;
  /** For kind "multi": where the option list comes from. */
  optionsSource?: "owners" | "tags" | "picklist" | "account_types" | "timezones";
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

const CUSTOMER_STATUS_OPTIONS = (
  ["client", "prospect", "former_client"] as CustomerStatus[]
).map((v) => ({ value: v, label: customerStatusLabel(v) }));

const INDUSTRY_OPTIONS = Object.entries(INDUSTRY_CATEGORY_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

/**
 * Synthetic "any open stage" stage-filter value (Jordan's doc: reps had to
 * hand-pick all four open stages to approximate "Status = Open"). Expanded
 * into OPEN_STAGES (incl. legacy stage names, so nothing filters to zero)
 * at query/link time — it never reaches the database as a literal.
 */
export const OPEN_STAGE_SENTINEL = "__open__";

function expandStageValues(vals: string[]): string[] {
  if (!vals.includes(OPEN_STAGE_SENTINEL)) return vals;
  return [
    ...new Set<string>([...OPEN_STAGES, ...vals.filter((v) => v !== OPEN_STAGE_SENTINEL)]),
  ];
}

const STAGE_OPTIONS = [
  { value: OPEN_STAGE_SENTINEL, label: "Open (any open stage)" },
  ...ALL_STAGES.map((s) => ({ value: s, label: stageLabel(s) })),
];

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
  // "leads" retired 2026-07-20 — imports are contacts now.
];

const IMPORT_MODE_OPTIONS = [
  { value: "upsert", label: "Upsert" },
  { value: "update_specific_fields", label: "Update specific fields" },
];

export const REPORT_FILTERS: Record<NexusReportEntity, ReportFilterDef[]> = {
  contacts: [
    { field: "owner", label: "Owner", kind: "multi", optionsSource: "owners" },
    { field: "tags", label: "Tag", kind: "multi", optionsSource: "tags" },
    // Lead Source pulls its options from the SAME admin-managed picklist the
    // ContactForm uses (contacts.lead_source), NOT a hardcoded list — so it
    // exposes every value in use (webinar, conference, …) and stays in sync
    // when admins add/rename values. The old staticOptions list was a stale
    // 8-value subset that omitted the values dominating the data, which is
    // why the filter appeared "not to work" (Jordan).
    { field: "lead_source", label: "Lead Source", kind: "multi", optionsSource: "picklist", picklistFieldKey: "contacts.lead_source" },
    // "Called By" = a user who has logged a CALL against the contact
    // (v_contact_callers → activities.owner_user_id on call activities).
    // Resolved to contact ids in the hook, then filtered via .in("id", …).
    { field: "called_by", label: "Called By", kind: "multi", optionsSource: "owners" },
    // "Org Type" = the contact's ACCOUNT account_type (CHC, FQHC, PCA, … —
    // live SF-imported values, hence data-driven options). Filters via an
    // inner-join on the account embed (Jordan's doc / Molly's CHC-FQHC widget).
    { field: "org_type", label: "Org Type", kind: "multi", optionsSource: "account_types" },
    // Time Zone: contacts' own time_zone enum is effectively unpopulated, so
    // this filters on the LINKED account's (free-text, SF-imported) timezone.
    // Options are the distinct values actually in the data (the enum constant
    // list would match zero rows — accounts store "US/Eastern", not "eastern").
    { field: "timezone", label: "Time Zone", kind: "multi", optionsSource: "timezones" },
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
    // Surfaced as "Account Status" per the 2026-07 status restructure
    // (stored values unchanged: client / prospect / former_client). The old
    // discovery/pending/active/inactive/churned "status" filter is retired.
    { field: "customer_status", label: "Account Status", kind: "multi", staticOptions: CUSTOMER_STATUS_OPTIONS },
    // Sales-working fields (2026-07 restructure). sales_status options come
    // from the admin-managed accounts.sales_status picklist (partner_type
    // pattern) so they stay in sync when admins add/rename values.
    { field: "sales_active", label: "Working (Active/Inactive)", kind: "boolean" },
    { field: "sales_status", label: "Sales Status", kind: "multi", optionsSource: "picklist", picklistFieldKey: "accounts.sales_status" },
    { field: "next_follow_up_date", label: "Next Follow Up", kind: "due" },
    { field: "industry", label: "Industry", kind: "multi", staticOptions: INDUSTRY_OPTIONS },
    // Exact-match picklist over the account_type values actually in the data
    // (was a fragile free-text "contains" — Jordan's doc). Old saved configs
    // with op "contains" are coerced to exact-match in normalizeReportConfig.
    { field: "account_type", label: "Account Type", kind: "multi", optionsSource: "account_types" },
    { field: "partner_type", label: "Partner Type", kind: "multi", optionsSource: "picklist", picklistFieldKey: "accounts.partner_type" },
    // Time Zone: accounts.timezone is free-text SF-imported data ("US/Eastern",
    // …), so options come from the distinct values actually present.
    { field: "timezone", label: "Time Zone", kind: "multi", optionsSource: "timezones" },
    { field: "state", label: "State (billing)", kind: "text" },
    { field: "last_activity", label: "Last Activity", kind: "days" },
    { field: "created", label: "Created", kind: "days" },
  ],
  opportunities: [
    { field: "owner", label: "Owner", kind: "multi", optionsSource: "owners" },
    { field: "stage", label: "Stage", kind: "multi", staticOptions: STAGE_OPTIONS },
    { field: "team", label: "Team", kind: "multi", staticOptions: TEAM_OPTIONS },
    { field: "business_type", label: "Business Type", kind: "multi", staticOptions: BUSINESS_TYPE_OPTIONS },
    // Data-driven from the admin-managed opportunities.lead_source picklist
    // (see the contacts note above) — not a stale hardcoded subset.
    { field: "lead_source", label: "Lead Source", kind: "multi", optionsSource: "picklist", picklistFieldKey: "opportunities.lead_source" },
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
    // "Status" for a contact = their ACCOUNT's Account Status (contacts have
    // no status of their own; this is what Molly's CHC/FQHC widget wants).
    // Sourced from the linked account's customer_status (client / prospect /
    // former_client) now that accounts.status is retired. Key stays "status"
    // for saved-config compatibility.
    { key: "status", label: "Account Status", sortable: false },
    { key: "state", label: "State", sortable: false },
    { key: "tags", label: "Tags", sortable: false },
    { key: "notes", label: "Notes", sortable: false },
    { key: "last_activity", label: "Last Activity", sortable: true },
    // Dedicated "last touch" from v_contact_last_activity (display-only; fails
    // soft to blank until the view is deployed).
    { key: "last_touch", label: "Last Touch", sortable: false },
    { key: "owner", label: "Owner", sortable: false },
    { key: "created", label: "Created", sortable: true },
  ],
  accounts: [
    { key: "name", label: "Name", sortable: true },
    { key: "customer_status", label: "Account Status", sortable: true },
    { key: "account_type", label: "Account Type", sortable: true },
    { key: "industry", label: "Industry", sortable: false },
    { key: "phone", label: "Phone", sortable: false },
    { key: "state", label: "State", sortable: true },
    { key: "contract_end", label: "Contract End", sortable: true },
    { key: "next_follow_up_date", label: "Next Follow Up", sortable: true },
    { key: "acv", label: "ACV", sortable: true, align: "right" },
    { key: "notes", label: "Notes", sortable: false },
    { key: "last_activity", label: "Last Activity", sortable: true },
    // Dedicated "last touch" from v_account_last_activity (display-only).
    { key: "last_touch", label: "Last Touch", sortable: false },
    { key: "owner", label: "Owner", sortable: false },
    { key: "created", label: "Created", sortable: true },
  ],
  opportunities: [
    { key: "name", label: "Name", sortable: true },
    { key: "account", label: "Account", sortable: true },
    { key: "contact", label: "Contact", sortable: true },
    { key: "stage", label: "Stage", sortable: true },
    { key: "amount", label: "Amount", sortable: true, align: "right" },
    { key: "next_step", label: "Next Step", sortable: false },
    { key: "expected_close", label: "Expected Close", sortable: true },
    { key: "close_date", label: "Close Date", sortable: true },
    { key: "business_type", label: "Business Type", sortable: true },
    { key: "team", label: "Team", sortable: true },
    { key: "notes", label: "Notes", sortable: false },
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
  accounts: ["name", "customer_status", "owner", "contract_end"],
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
  const filterDefs = new Map(REPORT_FILTERS[entity].map((f) => [f.field, f]));
  const filters = (
    Array.isArray(cfg.filters) ? cfg.filters.filter((f) => f && filterDefs.has(f.field)) : []
  ).map((f) => {
    // A field upgraded from text-"contains" to an exact-match multi filter
    // (account_type, per Jordan's doc) may still be saved with the old op.
    // Coerce so old widgets keep filtering AND the editor renders correctly.
    const def = filterDefs.get(f.field);
    if (def?.kind === "multi" && f.op === "contains") {
      const v = String(f.value ?? "").trim();
      return { ...f, op: "in" as const, value: v ? [v] : [] };
    }
    return f;
  });
  return { entity, filters, sort, columns };
}

// ── Display row shape ────────────────────────────────────────────────

export type ReportCell =
  /** tone "danger" renders the cell red (e.g. an overdue follow-up date). */
  | { kind: "text"; text: string; tone?: "danger" }
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
 * Local YYYY-MM-DD offset by N days. The "due" ops compare DATE columns
 * (next_follow_up_date) against date literals so "today" means the user's
 * local day, not the UTC day.
 */
function localYMD(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
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

/**
 * Per-record "last touch" from a dedicated activity view
 * (v_contact_last_activity / v_account_last_activity — the parallel
 * migration 20260708190000). Display-only, over the small final page of
 * ids (≤ preview_count), so no chunking needed.
 *
 * FAILS SOFT: any error (most importantly the view not being deployed yet)
 * returns an empty map, so the Last Touch column renders blank rather than
 * erroring the whole widget.
 */
async function fetchLastTouchMap(
  view: "v_contact_last_activity" | "v_account_last_activity",
  idColumn: "contact_id" | "account_id",
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!ids.length) return map;
  try {
    const { data, error } = await supabase
      .from(view)
      .select(`${idColumn}, last_activity_at`)
      .in(idColumn, ids);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as Array<Record<string, string | null>>) {
      const id = row[idColumn];
      const at = row.last_activity_at;
      if (id && at) map.set(id, at);
    }
  } catch {
    return new Map(); // view absent / not yet deployed → blank cells
  }
  return map;
}

/**
 * Cap on how many caller→contact ids feed the `.in("id", …)` filter, so the
 * request URL stays bounded. A very prolific caller's widget then considers
 * only this many of their called contacts — fine for a preview widget that
 * is sorted + limited to preview_count downstream anyway.
 */
const CALLED_BY_ID_CAP = 250;

/**
 * Contact ids that any of `callerUserIds` have logged a CALL against, from
 * v_contact_callers (parallel migration 20260708190000).
 *
 * FAILS SOFT: any error (most importantly the view not being deployed yet)
 * returns [] — the caller filter then yields "no results" instead of
 * crashing the widget.
 */
async function fetchCallerContactIds(callerUserIds: string[]): Promise<string[]> {
  if (!callerUserIds.length) return [];
  try {
    const { data, error } = await supabase
      .from("v_contact_callers")
      .select("contact_id")
      .in("caller_user_id", callerUserIds)
      .limit(CALLED_BY_ID_CAP);
    if (error) throw error;
    const ids = new Set<string>();
    for (const row of (data ?? []) as { contact_id: string | null }[]) {
      if (row.contact_id) ids.add(row.contact_id);
    }
    return [...ids];
  } catch {
    return []; // view absent / not yet deployed → filter matches nothing
  }
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

/**
 * Server-side ORDER BY spec for a sortable column key, per entity.
 *
 * Joined-column sorts use PostgREST's EMBED-PATH form ("account(name)") —
 * NOT order(col, { referencedTable }): that variant only reorders rows
 * INSIDE the embed (a no-op for to-one joins), silently leaving the parent
 * rows in tiebreak order. Verified against staging PostgREST.
 */
function serverSortSpec(
  entity: NexusReportEntity,
  field: string,
): { column: string } | null {
  const maps: Record<NexusReportEntity, Record<string, { column: string }>> = {
    contacts: {
      name: { column: "last_name" },
      account: { column: "account(name)" },
      title: { column: "title" },
      email: { column: "email" },
      created: { column: "created_at" },
      // last_activity: client-side
    },
    accounts: {
      name: { column: "name" },
      customer_status: { column: "customer_status" },
      account_type: { column: "account_type" },
      state: { column: "billing_state" },
      contract_end: { column: "current_contract_end_date" },
      next_follow_up_date: { column: "next_follow_up_date" },
      acv: { column: "acv" },
      // Only reachable when the query targets v_accounts_with_activity
      // (any last_activity use flips the table — see useNexusReport).
      // Never NULL: falls back to created_at, so asc = longest-untouched
      // first with never-touched sorting by account age (opps precedent).
      last_activity: { column: "effective_last_touch" },
      created: { column: "created_at" },
    },
    opportunities: {
      name: { column: "name" },
      account: { column: "account(name)" },
      contact: { column: "primary_contact(last_name)" },
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
      customer_status: "customer_status",
      sales_active: "sales_active",
      sales_status: "sales_status",
      next_follow_up_date: "next_follow_up_date",
      industry: "industry_category",
      account_type: "account_type",
      partner_type: "partner_type",
      timezone: "timezone",
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
    if (entity === "contacts" && f.field === "org_type") {
      // Filter on the joined account's account_type. The select swaps the
      // account embed to !inner when this filter is active (see the hook),
      // so contacts whose account doesn't match — or who have no account —
      // are excluded server-side.
      const vals = Array.isArray(f.value) ? f.value : [];
      if (vals.length) query = query.in("account.account_type", vals);
      continue;
    }
    if (entity === "contacts" && f.field === "called_by") {
      // Resolved in the hook: needs an async pre-fetch of contact ids from
      // v_contact_callers, then an .in("id", …). Skipped here.
      continue;
    }
    if (entity === "contacts" && f.field === "timezone") {
      // Contacts have no reliable OWN timezone (the time_zone enum column is
      // ~unpopulated), so filter on the LINKED account's free-text timezone.
      // Like org_type, the select flips the account embed to !inner when this
      // filter is active, so contacts with a non-matching/absent account drop.
      const vals = Array.isArray(f.value) ? f.value : [];
      if (vals.length) query = query.in("account.timezone", vals);
      continue;
    }
    if (f.field === "last_activity") {
      if (entity === "accounts") {
        // Server-side over v_accounts_with_activity. Two different columns
        // on purpose (mirrors the contacts client-side semantics):
        //  - "more than N days ago" uses effective_last_touch (created_at
        //    fallback, never NULL) so never-touched accounts count as
        //    untouched — the whole point of the outreach report.
        //  - "within the last N days" uses the raw last_activity_at so a
        //    brand-new account with zero logged activity does NOT pass as
        //    "recently worked" (gte on NULL excludes it).
        const n = Number(f.value);
        if (Number.isFinite(n) && n > 0) {
          query =
            f.op === "older_than_days"
              ? query.lte("effective_last_touch", daysAgoISO(n))
              : query.gte("last_activity_at", daysAgoISO(n));
        }
      }
      continue; // contacts: client-side
    }
    const col = filterColumn(entity, f.field);
    if (!col) continue;
    switch (f.op) {
      case "in": {
        let vals = Array.isArray(f.value) ? (f.value as string[]) : [];
        if (entity === "opportunities" && f.field === "stage") {
          vals = expandStageValues(vals);
        }
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
      case "due_within_days": {
        // Future window: today .. today+N inclusive (date column).
        const n = Number(f.value);
        if (Number.isFinite(n) && n >= 0) {
          query = query.gte(col, localYMD(0)).lte(col, localYMD(n));
        }
        break;
      }
      case "overdue":
        // Strictly before today; NULLs never satisfy <, so they're excluded.
        query = query.lt(col, localYMD(0));
        break;
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

/** Date cell that renders red when the date has already passed (overdue). */
function dueDateText(value: unknown): ReportCell {
  if (!value) return text(null);
  const ymd = String(value).slice(0, 10); // YYYY-MM-DD compares lexically
  return {
    kind: "text",
    text: formatDate(ymd),
    tone: ymd < localYMD(0) ? "danger" : undefined,
  };
}

/** Notes can be essays — clamp for a widget cell (CSS truncates the rest). */
function noteText(value: unknown): ReportCell {
  const s = value === null || value === undefined || value === "" ? null : String(value);
  return text(s && s.length > 140 ? s.slice(0, 140).trimEnd() + "…" : s);
}

function contactCells(
  r: RawRecord,
  lastActivity: Map<string, string>,
  tags: Map<string, Tag[]>,
  lastTouch: Map<string, string>,
): Record<string, ReportCell> {
  const account = r.account as {
    name?: string;
    account_type?: string | null;
    billing_state?: string | null;
    customer_status?: string | null;
  } | null;
  const owner = r.owner as { full_name?: string | null } | null;
  const la = lastActivity.get(r.id);
  const lt = lastTouch.get(r.id);
  return {
    name: text(formatName(String(r.first_name ?? ""), String(r.last_name ?? ""))),
    account: text(account?.name),
    title: text(r.title),
    email: text(r.email),
    phone: text(r.phone ? formatPhone(String(r.phone)) : null),
    org_type: text(account?.account_type),
    status: text(account?.customer_status ? customerStatusLabel(account.customer_status as CustomerStatus) : null),
    state: text((r.mailing_state as string | null) ?? account?.billing_state),
    tags: { kind: "tags", tags: tags.get(r.id) ?? [] },
    notes: noteText(r.notes),
    last_activity: text(la ? formatRelativeDate(la) : "No activity"),
    // Fails soft to blank when v_contact_last_activity isn't deployed yet.
    last_touch: text(lt ? formatRelativeDate(lt) : null),
    owner: text(owner?.full_name),
    created: text(formatDate(r.created_at as string)),
  };
}

function accountCells(
  r: RawRecord,
  lastTouch: Map<string, string>,
): Record<string, ReportCell> {
  const owner = r.owner as { full_name?: string | null } | null;
  const lt = lastTouch.get(r.id);
  return {
    name: text(r.name),
    customer_status: text(customerStatusLabel(r.customer_status as CustomerStatus | null)),
    account_type: text(r.account_type),
    industry: text(
      r.industry_category
        ? industryCategoryLabel(r.industry_category as IndustryCategory)
        : (r.industry as string | null),
    ),
    phone: text(r.phone ? formatPhone(String(r.phone)) : null),
    state: text(r.billing_state),
    contract_end: text(formatDate(r.current_contract_end_date as string | null)),
    next_follow_up_date: dueDateText(r.next_follow_up_date),
    acv: text(r.acv == null ? null : formatCurrency(Number(r.acv))),
    notes: noteText(r.notes),
    // Present only when the query targeted v_accounts_with_activity (the
    // hook flips tables whenever last_activity is used).
    last_activity: text(
      r.last_activity_at ? formatRelativeDate(r.last_activity_at as string) : "No activity",
    ),
    // Dedicated last-touch from v_account_last_activity (already deployed).
    last_touch: text(lt ? formatRelativeDate(lt) : null),
    owner: text(owner?.full_name),
    created: text(formatDate(r.created_at as string)),
  };
}

function opportunityCells(r: RawRecord): Record<string, ReportCell> {
  const account = r.account as { name?: string } | null;
  const owner = r.owner as { full_name?: string | null } | null;
  const contact = r.primary_contact as
    | { first_name?: string | null; last_name?: string | null }
    | null;
  return {
    name: text(r.name),
    account: text(account?.name),
    contact: text(
      contact ? formatName(String(contact.first_name ?? ""), String(contact.last_name ?? "")) : null,
    ),
    stage: text(stageLabel(r.stage as OpportunityStage)),
    amount: text(formatCurrency(Number(r.amount ?? 0))),
    next_step: text(r.next_step),
    expected_close: text(formatDate(r.expected_close_date as string | null)),
    close_date: text(formatDate(r.close_date as string | null)),
    business_type: text(businessTypeLabel(r.business_type as OpportunityBusinessType | null)),
    team: text(teamLabel(r.team as OpportunityTeam)),
    notes: noteText(r.notes),
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
    "id, first_name, last_name, title, email, phone, mailing_state, notes, created_at, " +
    "account:accounts!account_id(id, name, account_type, billing_state, customer_status), " +
    "owner:user_profiles!owner_user_id(id, full_name)",
  accounts:
    "id, name, customer_status, sales_active, sales_status, next_follow_up_date, " +
    "account_type, industry, industry_category, phone, billing_state, " +
    "current_contract_end_date, acv, notes, created_at, " +
    "owner:user_profiles!owner_user_id(id, full_name)",
  opportunities:
    "id, name, stage, amount, next_step, notes, business_type, team, expected_close_date, close_date, created_at, " +
    "account:accounts!account_id(id, name), " +
    "primary_contact:contacts!primary_contact_id(id, first_name, last_name), " +
    "owner:user_profiles!owner_user_id(id, full_name)",
  imports:
    "id, entity, filename, status, total_rows, succeeded_count, failed_count, user_email, started_at",
};

// v_accounts_with_activity path: PostgREST embeds don't resolve through a
// VIEW (FK metadata lives on the table — same reason opportunities/api.ts
// selects plain columns from v_opportunities_with_activity), so this select
// has NO embeds; owner names are merged by id after the fetch.
// NOTE: v_accounts_with_activity snapshots accounts.* at CREATE — the view
// must be recreated after the sales_active/sales_status/next_follow_up_date
// column migration or these selects will 400 on the activity path.
const ACCOUNTS_ACTIVITY_SELECT =
  "id, name, customer_status, sales_active, sales_status, next_follow_up_date, " +
  "account_type, industry, industry_category, phone, billing_state, " +
  "current_contract_end_date, acv, notes, created_at, owner_user_id, last_activity_at";

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
      const hasOrgTypeFilter =
        entity === "contacts" &&
        filters.some((f) => f.field === "org_type" && Array.isArray(f.value) && f.value.length > 0);
      // Contacts filter on the LINKED account's timezone (their own is empty);
      // like org_type it needs the account embed to be inner.
      const hasContactTimezoneFilter =
        entity === "contacts" &&
        filters.some((f) => f.field === "timezone" && Array.isArray(f.value) && f.value.length > 0);
      const hasCalledByFilter =
        entity === "contacts" &&
        filters.some((f) => f.field === "called_by" && Array.isArray(f.value) && f.value.length > 0);
      // Any last_activity use on ACCOUNTS flips the query to the
      // v_accounts_with_activity view so sort/filter run server-side over
      // ALL accounts (accurate "longest without touch", per Jordan's doc) —
      // not a client-side page. Other account reports keep the plain table.
      const accountsActivity =
        entity === "accounts" &&
        (sort.field === "last_activity" ||
          columns.includes("last_activity") ||
          filters.some((f) => f.field === "last_activity"));

      let select = accountsActivity
        ? ACCOUNTS_ACTIVITY_SELECT
        : SELECTS[entity] + (hasTagFilter ? ", contact_tags!inner(tag_id)" : "");
      if (hasOrgTypeFilter || hasContactTimezoneFilter) {
        // These filters match on the JOINED account (account_type / timezone);
        // the embed must be inner so contacts with no/non-matching account
        // drop out server-side.
        select = select.replace("account:accounts!account_id(", "account:accounts!account_id!inner(");
      }

      const table = accountsActivity ? "v_accounts_with_activity" : TABLES[entity];
      let query = supabase.from(table).select(select);
      // Archive convention: import_runs has no archived_at; everything
      // else hides archived rows, matching the list pages.
      if (entity !== "imports") query = query.is("archived_at", null);
      // Pending pen imports stay out of Nexus contact widgets, matching
      // every other contact read surface (lead-type retirement, 2026-07-20).
      if (entity === "contacts") query = query.is("import_status", null);
      query = applyFilters(entity, query, filters);

      // "Called By": resolve the chosen users to the contact ids they've
      // logged a call against (v_contact_callers), then constrain by id. An
      // empty set (nobody matched, OR the view isn't deployed yet) short-
      // circuits to no rows rather than an unfiltered result.
      if (hasCalledByFilter) {
        const callerIds = filters
          .filter((f) => f.field === "called_by" && Array.isArray(f.value))
          .flatMap((f) => f.value as string[]);
        const contactIds = await fetchCallerContactIds(callerIds);
        if (!contactIds.length) return [];
        query = query.in("id", contactIds);
      }

      // Sort server-side when we can; the client-eval path re-sorts below.
      const spec = clientEval ? null : serverSortSpec(entity, sort.field);
      if (spec) {
        query = query.order(spec.column, {
          ascending: sort.dir === "asc",
          nullsFirst: false,
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

      // View path has no owner embed — merge owner names by id (the same
      // batch-fetch pattern opportunities/api.ts uses for its view).
      if (accountsActivity && rows.length) {
        const ownerIds = [
          ...new Set(rows.map((r) => r.owner_user_id).filter(Boolean)),
        ] as string[];
        if (ownerIds.length) {
          const { data: owners } = await supabase
            .from("user_profiles")
            .select("id, full_name")
            .in("id", ownerIds);
          const nameById = new Map(
            ((owners ?? []) as { id: string; full_name: string | null }[]).map((o) => [
              o.id,
              o.full_name,
            ]),
          );
          for (const r of rows) {
            r.owner = { full_name: nameById.get(r.owner_user_id as string) ?? null };
          }
        }
      }

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

      // "Last Touch" column: dedicated per-entity activity view. Fails soft
      // (blank) when the contact view isn't deployed yet.
      let lastTouch = new Map<string, string>();
      if (columns.includes("last_touch")) {
        if (entity === "contacts") {
          lastTouch = await fetchLastTouchMap("v_contact_last_activity", "contact_id", ids);
        } else if (entity === "accounts") {
          lastTouch = await fetchLastTouchMap("v_account_last_activity", "account_id", ids);
        }
      }

      return rows.map((r): ReportRow => {
        const cellsAll =
          entity === "contacts"
            ? contactCells(r, lastActivity, tagsMap, lastTouch)
            : entity === "accounts"
              ? accountCells(r, lastTouch)
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
        ? { owner: "owner", customer_status: "customer", industry: "industry" }
        : { owner: "owner", stage: "stage", team: "team", business_type: "business_type" };

  const params = new URLSearchParams();
  for (const f of filters) {
    // Sales-working filters map to the accounts list's dedicated params
    // (?sales=active|inactive&sub=…&follow_up=due|overdue — 2026-07
    // restructure) rather than the generic in-list form.
    if (entity === "accounts" && f.field === "sales_active" && f.op === "eq") {
      params.set("sales", f.value === false ? "inactive" : "active");
      continue;
    }
    if (
      entity === "accounts" &&
      f.field === "sales_status" &&
      f.op === "in" &&
      Array.isArray(f.value) &&
      f.value.length
    ) {
      params.set("sub", (f.value as string[]).join(","));
      continue;
    }
    if (entity === "accounts" && f.field === "next_follow_up_date") {
      if (f.op === "due_within_days") {
        params.set("follow_up", "due");
        continue;
      }
      if (f.op === "overdue") {
        params.set("follow_up", "overdue");
        continue;
      }
      return base; // not representable — fall back to the plain list
    }
    const param = paramMap[f.field];
    if (!param || f.op !== "in" || !Array.isArray(f.value) || !f.value.length) {
      return base; // not representable — fall back to the plain list
    }
    // The synthetic "Open" stage value must reach the list page as real
    // stage names — expand it exactly like the query does.
    const vals =
      entity === "opportunities" && f.field === "stage"
        ? expandStageValues(f.value as string[])
        : (f.value as string[]);
    params.set(param, vals.join(","));
  }

  // Sort is best-effort: include when the list page sorts by the same key.
  const sortKeyMap: Record<string, string> =
    entity === "contacts"
      ? { name: "last_name", account: "account.name", title: "title", email: "email" }
      : entity === "accounts"
        ? { name: "name", customer_status: "customer_status", contract_end: "current_contract_end_date", next_follow_up_date: "next_follow_up_date" }
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
