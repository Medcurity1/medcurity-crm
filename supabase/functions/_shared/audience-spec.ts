// audience-spec.ts — Strict versioned AudienceSpec v1 for AI Campaigns.
//
// This is the ONLY shape the AI interpretation can produce and the audience
// resolver will accept. No SQL, no ILIKE, no operators, no contact IDs, no
// raw query fragments, no arbitrary fields. Values must come from the
// allowlisted enum/picklist sets defined below (source: migrations
// 20260418000001 + 20260506000002 for industry_category, 20260418000001 for
// project_segment, 20260630000002 for customer_status).
//
// Shared between playbook-ai (interpret-audience) and the resolve-audience
// action. The Deno edge function runtime imports this directly.

// ── Allowlisted value sets (source-verified from migrations) ──────────────

/** Full industry_category enum: 25 original + 56 expanded (20260506000002) = 81 values. */
export const INDUSTRY_CATEGORY_VALUES = [
  // Original 25 (20260418000001)
  "hospital", "medical_group", "fqhc", "rural_health_clinic", "skilled_nursing",
  "long_term_care", "home_health", "hospice", "behavioral_health", "dental",
  "pediatrics", "specialty_clinic", "urgent_care", "imaging_center", "lab_services",
  "pharmacy", "telemedicine", "tribal_health", "public_health_agency",
  "healthcare_it_vendor", "managed_service_provider", "healthcare_consulting",
  "insurance_payer", "other_healthcare", "other",
  // Expanded (20260506000002)
  "rural_hospital", "community_health_center", "university_hospital",
  "medical_practice", "multi_specialty", "primary_care", "primary_care_association",
  "internal_medicine", "family_medicine", "women_health", "group_purchasing_organization",
  "cardiology", "dermatology", "oncology", "urology", "ophthalmology", "audiology",
  "orthopedics", "rheumatology", "gastroenterology", "general_surgery", "neurology",
  "endocrinology", "nephrology", "pulmonology", "chiropractic", "optometry",
  "podiatry", "physical_therapy", "pain_management", "ent_otolaryngology",
  "radiology", "anesthesiology", "emergency_medicine", "plastic_surgery",
  "allergy_immunology", "psychiatry", "mental_health", "vascular",
  "reproductive_medicine", "sleep_medicine", "geriatrics", "rehabilitation",
  "naturopathy", "colon_rectal",
  "pharmaceuticals", "medical_device", "non_profit", "business_associate",
  "direct_care", "consulting", "accounting", "technology", "higher_education",
  "association", "government",
] as const;
export type IndustryCategory = typeof INDUSTRY_CATEGORY_VALUES[number];
const INDUSTRY_CATEGORY_SET = new Set<string>(INDUSTRY_CATEGORY_VALUES);

/** Full project_segment enum (20260418000001). */
export const PROJECT_SEGMENT_VALUES = [
  "rural_hospital", "community_hospital", "enterprise", "medium_sized",
  "small_sized", "fqhc", "voa", "franchise", "strategic_partner",
  "it_vendor_third_party", "independent_associations", "other",
] as const;
export type ProjectSegment = typeof PROJECT_SEGMENT_VALUES[number];
const PROJECT_SEGMENT_SET = new Set<string>(PROJECT_SEGMENT_VALUES);

/** US state abbreviations — the only allowed values for state_values. */
export const US_STATE_CODES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY",
] as const;
export type USStateCode = typeof US_STATE_CODES[number];
const US_STATE_SET = new Set<string>(US_STATE_CODES);

/** customer_status CHECK values (20260630000002). */
export const CUSTOMER_STATUS_VALUES = ["client", "prospect", "former_client"] as const;
export type CustomerStatus = typeof CUSTOMER_STATUS_VALUES[number];

// ── AudienceSpec v1 ───────────────────────────────────────────────────────

export interface AudienceSpecV1 {
  version: 1;
  filters: {
    industry_category_values?: IndustryCategory[];
    project_segment_values?: ProjectSegment[];
    state_values?: USStateCode[];
  };
  // All exclusion flags are locked true in v1 — never false.
  exclude_customers: true;
  exclude_former_customers: true;
  exclude_partners: true;
  exclude_suppressed: true;
  exclude_active_enrollments: true;
  // Result cap
  max_results: number;
  // AI interpretation metadata (set by interpret-audience, not by user)
  ambiguous_criteria?: string[];
  unsupported_criteria?: string[];
}

/** Hard ceiling for max_results. */
export const MAX_RESULTS_HARD_CAP = 2000;
/** Default max_results when not specified. */
export const MAX_RESULTS_DEFAULT = 500;
/** Maximum raw brief length (characters) accepted by interpret-audience. */
export const BRIEF_MAX_LENGTH = 2000;

// ── Contact-pattern screen (lightweight, not exhaustive) ─────────────────

/** Current version identifier for the privacy screen. Persisted on
 *  interpretation records so provenance shows which screen ran. */
export const PRIVACY_SCREEN_VERSION = "contact_pattern_v1";

/**
 * Screen a brief for obvious contact patterns before sending to AI or
 * storing. Returns an array of pattern types found (empty = clean).
 * Intentionally lightweight: catches email addresses, US phone numbers,
 * and SSN patterns. Not a substitute for a full PII scanner.
 */
export function detectPiiPatterns(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const found: string[] = [];
  // Email addresses
  if (/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)) {
    found.push("email address");
  }
  // US phone numbers (10 digits with optional separators, optional +1)
  if (/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text)) {
    found.push("phone number");
  }
  // SSN pattern (XXX-XX-XXXX)
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
    found.push("Social Security number");
  }
  return found;
}

/** Human-readable rejection for contact patterns found in a brief. */
export function piiRejectionMessage(piiTypes: string[]): string {
  return `Brief contains what looks like a ${piiTypes.join(" and ")}. Remove personal contact information before submitting — describe your audience by organization type, geography, and segment, not by individual identity.`;
}

// ── Validation ────────────────────────────────────────────────────────────

export interface SpecValidationError {
  field: string;
  message: string;
}

/**
 * Validate an AudienceSpec v1 object. Returns an array of errors (empty = valid).
 * Rejects any SQL, ILIKE patterns, operators, contact IDs, raw query fragments,
 * or values outside the allowlisted sets. Rejects decimals, non-string array
 * members, empty strings, and unknown keys.
 */
export function validateAudienceSpec(raw: unknown): SpecValidationError[] {
  const errors: SpecValidationError[] = [];
  if (!raw || typeof raw !== "object") {
    errors.push({ field: "spec", message: "Spec must be a non-null object" });
    return errors;
  }
  const spec = raw as Record<string, unknown>;

  // Version
  if (spec.version !== 1) {
    errors.push({ field: "version", message: "Only version 1 is supported" });
  }

  // Exclusion flags must be true
  for (const flag of [
    "exclude_customers", "exclude_former_customers", "exclude_partners",
    "exclude_suppressed", "exclude_active_enrollments",
  ]) {
    if (spec[flag] !== true) {
      errors.push({ field: flag, message: `${flag} must be true in v1` });
    }
  }

  // max_results — must be a positive finite INTEGER (no decimals)
  const maxResults = spec.max_results;
  if (typeof maxResults !== "number" || !Number.isFinite(maxResults) || maxResults < 1 || !Number.isInteger(maxResults)) {
    errors.push({ field: "max_results", message: "max_results must be a positive integer" });
  } else if (maxResults > MAX_RESULTS_HARD_CAP) {
    errors.push({ field: "max_results", message: `max_results cannot exceed ${MAX_RESULTS_HARD_CAP}` });
  }

  // Filters
  const filters = spec.filters;
  if (!filters || typeof filters !== "object") {
    errors.push({ field: "filters", message: "filters must be a non-null object" });
    return errors;
  }
  const f = filters as Record<string, unknown>;

  // Validate enum arrays
  validateEnumArray(f.industry_category_values, "filters.industry_category_values", INDUSTRY_CATEGORY_SET, errors);
  validateEnumArray(f.project_segment_values, "filters.project_segment_values", PROJECT_SEGMENT_SET, errors);
  validateEnumArray(f.state_values, "filters.state_values", US_STATE_SET, errors);

  // Reject any unknown filter keys (no arbitrary fields)
  const ALLOWED_FILTER_KEYS = new Set([
    "industry_category_values", "project_segment_values", "state_values",
  ]);
  for (const key of Object.keys(f)) {
    if (!ALLOWED_FILTER_KEYS.has(key)) {
      errors.push({ field: `filters.${key}`, message: `Unknown filter key: ${key}` });
    }
  }

  // Reject any unknown top-level keys (no arbitrary fields)
  const ALLOWED_TOP_KEYS = new Set([
    "version", "filters", "exclude_customers", "exclude_former_customers",
    "exclude_partners", "exclude_suppressed", "exclude_active_enrollments",
    "max_results", "ambiguous_criteria", "unsupported_criteria",
  ]);
  for (const key of Object.keys(spec)) {
    if (!ALLOWED_TOP_KEYS.has(key)) {
      errors.push({ field: key, message: `Unknown spec key: ${key}` });
    }
  }

  // Validate ambiguous_criteria / unsupported_criteria are string arrays
  validateStringArray(spec.ambiguous_criteria, "ambiguous_criteria", errors);
  validateStringArray(spec.unsupported_criteria, "unsupported_criteria", errors);

  return errors;
}

/** Validate a value is either undefined or an array of non-empty strings. */
function validateStringArray(
  value: unknown,
  field: string,
  errors: SpecValidationError[],
): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push({ field, message: `${field} must be an array` });
    return;
  }
  if (value.length > 50) {
    errors.push({ field, message: `${field} cannot exceed 50 entries` });
    return;
  }
  for (const item of value) {
    if (typeof item !== "string") {
      errors.push({ field, message: `${field} values must be strings` });
      return;
    }
    if (item.trim().length === 0) {
      errors.push({ field, message: `${field} must not contain empty strings` });
      return;
    }
    if (containsSqlFragment(item)) {
      errors.push({ field, message: `${field} contains disallowed SQL fragment` });
      return;
    }
  }
}

function validateEnumArray(
  value: unknown,
  field: string,
  allowedSet: Set<string>,
  errors: SpecValidationError[],
): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    errors.push({ field, message: `${field} must be an array` });
    return;
  }
  if (value.length === 0) {
    errors.push({ field, message: `${field} must not be an empty array (omit the key instead)` });
    return;
  }
  if (value.length > 100) {
    errors.push({ field, message: `${field} cannot exceed 100 values` });
    return;
  }
  for (const item of value) {
    if (typeof item !== "string") {
      errors.push({ field, message: `${field} values must be strings` });
      return;
    }
    if (item.trim().length === 0) {
      errors.push({ field, message: `${field} must not contain empty strings` });
      return;
    }
    // Reject SQL injection patterns
    if (containsSqlFragment(item)) {
      errors.push({ field, message: `${field} contains disallowed SQL fragment: ${item.slice(0, 40)}` });
      return;
    }
    if (!allowedSet.has(item)) {
      errors.push({ field, message: `${field} contains unknown value: ${item.slice(0, 40)}` });
    }
  }
}

/** Detect SQL injection patterns, ILIKE, operators, etc. in a string value. */
export function containsSqlFragment(value: string): boolean {
  if (typeof value !== "string") return true;
  const lower = value.toLowerCase().trim();
  // Reject anything that looks like SQL
  const SQL_PATTERNS = [
    /;\s*(select|insert|update|delete|drop|alter|create|truncate|exec|union)/i,
    /'\s*(or|and)\s+/i,
    /--/,
    /\/\*/,
    /\bselect\s+/i,
    /\binsert\s+/i,
    /\bupdate\s+/i,
    /\bdelete\s+from/i,
    /\bdrop\s+/i,
    /\bunion\s+(all\s+)?select/i,
    /\bilike\b/i,
    /\blike\s+'%/i,
    /%.*%/,          // LIKE wildcards
    /[<>=!]{2,}/,    // operators
    /\b(true|false|null)\s*(=|<>|!=)/i,
  ];
  for (const pat of SQL_PATTERNS) {
    if (pat.test(lower)) return true;
  }
  return false;
}

/**
 * Returns true if the spec has no active filters — i.e. it would match every
 * contact. Callers must require explicit confirmation before resolving.
 */
export function isUnfilteredSpec(spec: AudienceSpecV1): boolean {
  const f = spec.filters;
  const hasIndustry = f.industry_category_values && f.industry_category_values.length > 0;
  const hasSegment = f.project_segment_values && f.project_segment_values.length > 0;
  const hasState = f.state_values && f.state_values.length > 0;
  return !hasIndustry && !hasSegment && !hasState;
}

/**
 * Basic email format validation. Not RFC 5322 — just enough to reject
 * clearly invalid entries (empty, missing @, missing domain).
 */
export function isPlausibleEmail(email: string): boolean {
  if (!email || typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  const atIndex = trimmed.indexOf("@");
  if (atIndex < 1) return false;
  const domain = trimmed.slice(atIndex + 1);
  if (domain.length < 3 || !domain.includes(".")) return false;
  return true;
}

/**
 * Build a canonical JSON string for hashing. Deterministic key ordering.
 */
export function canonicalSpecJson(spec: AudienceSpecV1): string {
  const canonical = {
    version: spec.version,
    filters: {
      industry_category_values: spec.filters.industry_category_values
        ? [...spec.filters.industry_category_values].sort()
        : undefined,
      project_segment_values: spec.filters.project_segment_values
        ? [...spec.filters.project_segment_values].sort()
        : undefined,
      state_values: spec.filters.state_values
        ? [...spec.filters.state_values].sort()
        : undefined,
    },
    exclude_customers: true,
    exclude_former_customers: true,
    exclude_partners: true,
    exclude_suppressed: true,
    exclude_active_enrollments: true,
    max_results: spec.max_results,
  };
  return JSON.stringify(canonical);
}

/**
 * SHA-256 hash of the canonical spec JSON. Used for launch recheck.
 */
export async function specHash(spec: AudienceSpecV1): Promise<string> {
  const data = new TextEncoder().encode(canonicalSpecJson(spec));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** US state name -> 2-letter code mapping for canonicalization. */
const US_STATE_NAME_TO_CODE: Record<string, string> = {
  "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
  "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
  "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
  "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
  "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
  "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
  "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
  "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
  "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
  "wisconsin": "WI", "wyoming": "WY",
};

/**
 * Canonicalize a state value to a 2-letter US state code.
 * Accepts: 2-letter code (case-insensitive), full state name, or
 * whitespace-padded variants. Returns null if not recognized.
 */
export function canonicalizeStateCode(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (US_STATE_SET.has(upper)) return upper;
  const lower = trimmed.toLowerCase();
  return US_STATE_NAME_TO_CODE[lower] ?? null;
}

/**
 * Normalize an email for deduplication (matches marketing_email_normalize in
 * 20260728100000 and the JS normalizeEmail in playbook-smartlead).
 */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}
