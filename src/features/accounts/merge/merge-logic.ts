/**
 * Pure decision logic for the guarded account pair-merge (no network).
 *
 * Jordan-proof wording rule applies here too: every label is the plain
 * name a rep would say out loud, and the review screen shows EVERY field
 * below — including blanks — so nothing merges invisibly.
 *
 * The field list mirrors the server-side whitelist in migration
 * 20260812000000 (merge_account_pair's c_whitelist) EXACTLY. If you add a
 * field here, add it there first — the server rejects unknown keys, so a
 * client-only addition fails loudly at merge time (by design).
 *
 * Intentionally NOT mergeable through this tool:
 *  - account_number, created_at, archived_* (system/identity — the kept
 *    record keeps its own)
 *  - customer_status* (derived from deal history; the moved deals carry
 *    the truth and the daily sweep recomputes)
 *  - sales_active / sales_status / next_follow_up_date (the kept record's
 *    working state stays as-is; merging someone's queue state would
 *    surprise them)
 *  - acv / lifetime_value / churn_* / contracts / current_contract_*
 *    (financial summaries maintained by deals + automation — same boundary
 *    the June admin fill rule drew)
 *  - billing_latitude / billing_longitude (geocode artifacts; regenerated)
 *  - custom_fields (jsonb blob; no per-key review UI yet — survivor keeps
 *    its own)
 *  - notes (legacy column retired from the form)
 *  - do_not_contact / partner_prospect are NOT choosable: the server ORs
 *    them (if either record says "don't contact", the merged record does).
 */

export type MergeFieldKind = "text" | "multiline" | "number" | "currency" | "owner" | "cadence";

export interface MergeFieldDef {
  key: string;
  label: string;
  kind: MergeFieldKind;
  group: string;
}

export const MERGE_FIELD_GROUPS = [
  "Identity",
  "Contact info",
  "Billing address",
  "Shipping address",
  "Size & revenue",
  "Sales context",
] as const;

export const MERGE_FIELDS: MergeFieldDef[] = [
  { key: "name", label: "Account name", kind: "text", group: "Identity" },
  { key: "account_type", label: "Account type", kind: "text", group: "Identity" },
  { key: "website", label: "Website", kind: "text", group: "Identity" },
  { key: "industry", label: "Industry", kind: "text", group: "Identity" },
  { key: "sic", label: "SIC code", kind: "text", group: "Identity" },
  { key: "sic_description", label: "SIC description", kind: "text", group: "Identity" },
  { key: "description", label: "Description", kind: "multiline", group: "Identity" },

  { key: "phone", label: "Phone", kind: "text", group: "Contact info" },
  { key: "phone_extension", label: "Phone extension", kind: "text", group: "Contact info" },
  { key: "fax", label: "Fax", kind: "text", group: "Contact info" },
  { key: "timezone", label: "Timezone", kind: "text", group: "Contact info" },

  { key: "billing_street", label: "Billing street", kind: "text", group: "Billing address" },
  { key: "billing_city", label: "Billing city", kind: "text", group: "Billing address" },
  { key: "billing_state", label: "Billing state", kind: "text", group: "Billing address" },
  { key: "billing_zip", label: "Billing ZIP", kind: "text", group: "Billing address" },
  { key: "billing_country", label: "Billing country", kind: "text", group: "Billing address" },

  { key: "shipping_street", label: "Shipping street", kind: "text", group: "Shipping address" },
  { key: "shipping_city", label: "Shipping city", kind: "text", group: "Shipping address" },
  { key: "shipping_state", label: "Shipping state", kind: "text", group: "Shipping address" },
  { key: "shipping_zip", label: "Shipping ZIP", kind: "text", group: "Shipping address" },
  { key: "shipping_country", label: "Shipping country", kind: "text", group: "Shipping address" },

  { key: "employees", label: "Number of employees", kind: "number", group: "Size & revenue" },
  { key: "fte_count", label: "FTE count", kind: "number", group: "Size & revenue" },
  { key: "fte_range", label: "FTE range", kind: "text", group: "Size & revenue" },
  { key: "number_of_providers", label: "Number of providers", kind: "number", group: "Size & revenue" },
  { key: "locations", label: "Number of locations", kind: "number", group: "Size & revenue" },
  { key: "annual_revenue", label: "Annual revenue", kind: "currency", group: "Size & revenue" },

  { key: "owner_user_id", label: "Account owner", kind: "owner", group: "Sales context" },
  { key: "lead_source", label: "Lead source", kind: "text", group: "Sales context" },
  { key: "lead_source_detail", label: "Lead source detail", kind: "text", group: "Sales context" },
  { key: "renewal_cadence_years", label: "Renews every (years)", kind: "cadence", group: "Sales context" },
  { key: "rating", label: "Rating", kind: "text", group: "Sales context" },
  { key: "next_steps", label: "Next steps", kind: "multiline", group: "Sales context" },
  { key: "project", label: "Project", kind: "text", group: "Sales context" },
  { key: "site", label: "Site", kind: "text", group: "Sales context" },
  { key: "ownership", label: "Ownership", kind: "text", group: "Sales context" },
  { key: "partner_account", label: "Partner account", kind: "text", group: "Sales context" },
  { key: "referring_partner", label: "Referring partner", kind: "text", group: "Sales context" },
];

/** Compliance flags shown as locked, combined rows (server ORs them). */
export const COMBINED_FLAG_FIELDS = [
  { key: "do_not_contact", label: "Do not contact" },
  { key: "partner_prospect", label: "Partner prospect" },
] as const;

export type MergeSide = "a" | "b";

export type MergeFieldState = "both_blank" | "only_a" | "only_b" | "identical" | "conflict";

export interface MergeFieldRow {
  def: MergeFieldDef;
  aValue: unknown;
  bValue: unknown;
  state: MergeFieldState;
}

/** Blank = null/undefined or a whitespace-only string. 0 and false are real. */
export function isBlankValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function normalized(v: unknown): unknown {
  if (typeof v === "string") return v.trim();
  return v;
}

export function classifyPair(aValue: unknown, bValue: unknown): MergeFieldState {
  const aBlank = isBlankValue(aValue);
  const bBlank = isBlankValue(bValue);
  if (aBlank && bBlank) return "both_blank";
  if (!aBlank && bBlank) return "only_a";
  if (aBlank && !bBlank) return "only_b";
  return normalized(aValue) === normalized(bValue) ? "identical" : "conflict";
}

/** One row per whitelisted field, in display order — blanks included. */
export function buildFieldRows(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): MergeFieldRow[] {
  return MERGE_FIELDS.map((def) => {
    const aValue = a[def.key];
    const bValue = b[def.key];
    return { def, aValue, bValue, state: classifyPair(aValue, bValue) };
  });
}

/**
 * The default pick for a row, given which side survives:
 *  - only one side has a value  -> the populated side (regardless of survivor)
 *  - both blank / identical / conflict -> the survivor's side.
 * Deterministic and visible: the UI re-derives defaults whenever the
 * survivor flips, then the user may swap any row.
 */
export function defaultSideFor(state: MergeFieldState, survivorSide: MergeSide): MergeSide {
  if (state === "only_a") return "a";
  if (state === "only_b") return "b";
  return survivorSide;
}

export function buildDefaultPicks(
  rows: MergeFieldRow[],
  survivorSide: MergeSide,
): Record<string, MergeSide> {
  const picks: Record<string, MergeSide> = {};
  for (const row of rows) picks[row.def.key] = defaultSideFor(row.state, survivorSide);
  return picks;
}

/**
 * The survivor recommendation — the same "strongest candidate" order the
 * admin dedup tool uses: a record with a closed-won deal beats one
 * without; then the older record wins; id is the stable tiebreak.
 */
export function recommendSurvivor(
  a: { id: string; created_at: string | null; has_closed_won: boolean },
  b: { id: string; created_at: string | null; has_closed_won: boolean },
): MergeSide {
  if (a.has_closed_won !== b.has_closed_won) return a.has_closed_won ? "a" : "b";
  const aT = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
  const bT = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
  if (aT !== bT) return aT < bT ? "a" : "b";
  return a.id <= b.id ? "a" : "b";
}

/**
 * The payload for merge_account_pair.p_field_choices: ONLY fields whose
 * picked value differs from what the survivor already has. Picking the
 * blank side over a populated survivor value sends null (an explicit
 * clear). Identical/untouched fields stay out of the payload entirely, so
 * the audit's field_choices reads as "what the reviewer actually decided".
 */
export function buildFieldChoices(
  rows: MergeFieldRow[],
  picks: Record<string, MergeSide>,
  survivorSide: MergeSide,
): Record<string, unknown> {
  const choices: Record<string, unknown> = {};
  for (const row of rows) {
    const pick = picks[row.def.key] ?? defaultSideFor(row.state, survivorSide);
    const survivorValue = survivorSide === "a" ? row.aValue : row.bValue;
    const pickedValue = pick === "a" ? row.aValue : row.bValue;
    const survivorBlank = isBlankValue(survivorValue);
    const pickedBlank = isBlankValue(pickedValue);
    if (survivorBlank && pickedBlank) continue; // nothing to do
    if (!survivorBlank && !pickedBlank && normalized(survivorValue) === normalized(pickedValue)) {
      continue; // keeping what's already there
    }
    if (pickedBlank) {
      choices[row.def.key] = null; // explicit clear
    } else {
      choices[row.def.key] = typeof pickedValue === "string" ? pickedValue.trim() : pickedValue;
    }
  }
  return choices;
}

/** Count of rows where the two records genuinely disagree (for the UI). */
export function conflictCount(rows: MergeFieldRow[]): number {
  return rows.filter((r) => r.state === "conflict").length;
}
