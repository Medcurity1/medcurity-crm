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

// ── Staging-only enforcement ─────────────────────────────────────────────

/** Known Staging Supabase project ref. Audience actions fail closed on any
 *  other project so accidental Production promotion cannot serve AI
 *  audience features. Non-audience actions are unaffected. */
export const STAGING_PROJECT_REF = "baekcgdyjedgxmejbytc";

/** Allowed frontend hostnames for Ask AI visibility. */
export const AI_AUDIENCE_ALLOWED_HOSTS = [
  "staging.crm.medcurity.com",
  "localhost",
  "127.0.0.1",
] as const;

/** Returns true if the SUPABASE_URL belongs to the known Staging project. */
export function isStagingProject(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  return supabaseUrl.includes(STAGING_PROJECT_REF);
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

/**
 * Validate a model-provided label (campaign_name, target_audience) as
 * safe single-line plain text. Returns an error string or null if valid.
 * Rejects: controls, HTML, URLs/protocols, domains, Markdown syntax,
 * template tokens, bare emails, stray/spaced delimiters.
 */
export function validateSafeLabel(s: string, field: string): string | null {
  if (!s.trim()) return `${field} is empty`;
  if (s.length > 80) return `${field} exceeds 80 characters`;
  // D3: ASCII controls + Unicode zero-width/bidi/separator characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f\u200B-\u200F\u2028-\u202F\uFEFF]/.test(s)) return `${field} contains control characters`;
  if (/<[^>]*>/.test(s)) return `${field} contains HTML`;
  if (/https?:|ftp:|mailto:|www\.|:\/\//i.test(s)) return `${field} contains URL/protocol`;
  if (/[a-z0-9.-]+\.[a-z]{2,}/i.test(s) && !/\bmedcurity\.com\b/i.test(s)) return `${field} contains domain`;
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return `${field} contains email address`;
  if (/\[\[|\]\]|\{\{|\}\}|\{%|%\}|%signature%|\$\{|<%/i.test(s)) return `${field} contains template syntax`;
  if (/[*_`#>]/.test(s)) return `${field} contains Markdown syntax`;
  if (/\[.+\]\(.+\)/.test(s)) return `${field} contains Markdown link`;
  return null;
}

// ── Audience draft content validator (pure, deterministic) ───────────────
//
// Validates a complete AI-generated campaign draft against the Staging
// content contract. Returns an array of human-readable error strings
// (empty = valid). Fail-closed: any unrecognized structure is rejected.
// Importable by both Deno edge functions and Node test suites.

export interface AudienceDraftEmail {
  seq_number: unknown;
  delay_days: unknown;
  subject: unknown;
  body_html: unknown;
}

export interface AudienceDraftPayload {
  campaign_name: unknown;
  target_audience: unknown;
  sequence: unknown;
}

const DRAFT_ALLOWED_TOKENS = new Set(["[[First name]]", "[[Organization]]", "[[Signature]]"]);

/** Count words in visible text (strips HTML tags and entities). */
function wordCount(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/&\w+;/g, " ").replace(/\[\[[^\]]*\]\]/g, "X").trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Validate safe single-line plain text: no HTML, no controls (including
 * CR/LF/tab), no URLs, no Markdown, no template tokens, no claims.
 */
function validateSafePlainText(s: string, field: string, maxLen: number, errors: string[]): void {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) errors.push(`${field} contains control characters`);
  if (/<[^>]+>/.test(s)) errors.push(`${field} contains HTML`);
  if (/https?:\/\/|www\.|:\/\/|mailto:|ftp:/i.test(s)) errors.push(`${field} contains URL/protocol`);
  if (/\[\[|\]\]|\{\{|\}\}|\{%|%\}|%signature%|\$\{|<%/i.test(s)) errors.push(`${field} contains template syntax`);
  if (/\[.+\]\(.+\)|[*_`#]/.test(s)) errors.push(`${field} contains Markdown syntax`);
  if (s.length > maxLen) errors.push(`${field} exceeds ${maxLen} characters`);
  if (/\n|\r/.test(s)) errors.push(`${field} must be single-line`);
  // Claims
  if (/\d[\d,]*\+?\s*(?:healthcare\s+)?(?:organizations?|customers?|clients?|providers?|hospitals?)\b/i.test(s)) errors.push(`${field} contains unsupported claim`);
  if (/\d+\s*%/i.test(s)) errors.push(`${field} contains percentage claim`);
  if (/\b(?:guarantee|certified|proven|award|#1|best.in.class|number.one|ensures?\s+compliance|fully?\s+compliant)\b/i.test(s)) errors.push(`${field} contains unsupported claim`);
}

/** Check HTML is structurally balanced for the safe tag set. */
function checkHtmlBalance(body: string): string | null {
  const stack: string[] = [];
  const tags = [...body.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)];
  const VOID_TAGS = new Set(["br"]);
  const SAFE = new Set(["p", "br", "strong", "b", "em", "i"]);
  for (const m of tags) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (!SAFE.has(tag) && tag !== "a") continue; // unknown tags caught elsewhere
    if (VOID_TAGS.has(tag)) continue;
    if (closing) {
      if (stack.length === 0 || stack[stack.length - 1] !== tag) return `unmatched </${tag}>`;
      stack.pop();
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) return `unclosed <${stack[stack.length - 1]}>`;
  return null;
}

/**
 * Validate a complete audience-draft payload (rendered form with body_html).
 * Returns all errors found (empty array = valid). Pure, deterministic,
 * no side effects. Fail-closed: root null/primitive and null sequence
 * entries produce controlled errors, never unhandled TypeError.
 * Returns a bounded actionable list (continues validating after
 * structural errors where safe).
 */
export function validateAudienceDraft(raw: AudienceDraftPayload): string[] {
  // Root null/primitive guard
  if (!raw || typeof raw !== "object") return ["payload is null or not an object"];
  const errors: string[] = [];

  // ── Top-level: single-line safe plain text ────────────────────────
  if (typeof raw.campaign_name !== "string" || !String(raw.campaign_name).trim()) {
    errors.push("Empty campaign_name");
  } else {
    validateSafePlainText(String(raw.campaign_name), "campaign_name", 200, errors);
  }
  if (typeof raw.target_audience !== "string" || !String(raw.target_audience).trim()) {
    errors.push("Empty target_audience");
  } else {
    validateSafePlainText(String(raw.target_audience), "target_audience", 200, errors);
  }

  // ── Sequence structure ────────────────────────────────────────────
  if (!Array.isArray(raw.sequence)) { errors.push("sequence is not an array"); return errors; }
  if (raw.sequence.length !== 3) { errors.push(`sequence must have exactly 3 emails, got ${raw.sequence.length}`); return errors; }

  for (let i = 0; i < raw.sequence.length; i++) {
    const entry = raw.sequence[i];
    const n = i + 1;
    const pfx = `Email ${n}: `;

    // Null/primitive guard
    if (!entry || typeof entry !== "object") { errors.push(pfx + "entry is null or not an object"); continue; }
    const email = entry as Record<string, unknown>;

    // ── Structural fields (continue validating other fields after error) ──
    if (email.seq_number !== n) errors.push(pfx + `seq_number must be ${n}`);
    if (typeof email.delay_days !== "number" || !Number.isInteger(email.delay_days)) {
      errors.push(pfx + "delay_days must be an integer");
    } else {
      if (n === 1 && email.delay_days !== 0) errors.push(pfx + "first email delay_days must be 0");
      if (n > 1 && (email.delay_days < 3 || email.delay_days > 4)) errors.push(pfx + `follow-up delay_days must be 3-4, got ${email.delay_days}`);
    }

    if (typeof email.subject !== "string" || !(email.subject as string).trim()) { errors.push(pfx + "missing subject"); }
    if (typeof email.body_html !== "string" || !(email.body_html as string).trim()) { errors.push(pfx + "missing body"); }

    // If subject or body missing, cannot validate content
    if (typeof email.subject !== "string" || typeof email.body_html !== "string") continue;

    const subj = email.subject as string;
    const body = email.body_html as string;
    const combined = body + subj;

    // ── Subject: single-line safe plain text <=60 chars ──────────
    validateSafePlainText(subj, pfx + "subject", 60, errors);
    if (/\[\[Signature\]\]/i.test(subj)) errors.push(pfx + "subject must not contain [[Signature]]");

    // ── Template/alternate syntax rejection ──────────────────────
    if (/\{\{/.test(combined)) errors.push(pfx + "contains {{...}} template syntax");
    if (/\{%/.test(combined)) errors.push(pfx + "contains {%...%} template syntax");
    if (/%signature%/i.test(combined)) errors.push(pfx + "contains %signature%");
    if (/\$\{/.test(combined)) errors.push(pfx + "contains ${...} interpolation");
    if (/<%.+%>/s.test(combined)) errors.push(pfx + "contains <% %> template syntax");
    // Unknown/malformed [[ tokens
    const bracketTokens = combined.match(/\[\[[^\]]*\]\]/g) ?? [];
    for (const tok of bracketTokens) {
      if (!DRAFT_ALLOWED_TOKENS.has(tok)) errors.push(pfx + `unknown token ${tok}`);
    }
    // Unclosed/stray delimiters (opening [[ without ]] or lone ]])
    if (/\[\[(?![^\]]*\]\])/.test(combined)) errors.push(pfx + "unclosed [[ delimiter");
    if (/(?<!\[\[.*)\]\]/.test(combined) && !bracketTokens.length) errors.push(pfx + "stray ]] delimiter");

    // ── External reference rejection ─────────────────────────────
    // Reject all protocols, www, domain/path patterns, mailto, ftp
    // Allow exact bare "medcurity.com" only
    if (/https?:\/\//i.test(body)) errors.push(pfx + "contains http(s):// URL");
    if (/\/\//i.test(body) && !/<\//.test(body.replace(/<\/[a-z]+>/gi, ""))) errors.push(pfx + "contains protocol-relative //");
    if (/\bwww\./i.test(body)) errors.push(pfx + "contains www. URL");
    if (/\bmailto:/i.test(body)) errors.push(pfx + "contains mailto: URL");
    if (/\bftp:/i.test(body)) errors.push(pfx + "contains ftp: URL");
    // Domain/path (word.word/path) but exclude medcurity.com
    const bodyWithoutMedcurity = body.replace(/\bmedcurity\.com\b/g, "ALLOWED_DOMAIN");
    if (/\b[a-z0-9-]+\.[a-z]{2,}\/\S/i.test(bodyWithoutMedcurity)) errors.push(pfx + "contains domain/path URL");

    // ── Markdown in HTML rejection (within paragraph text) ───────
    if (/\[[^\]]+\]\([^)]+\)/.test(body)) errors.push(pfx + "Markdown link");
    if (/#{1,6}\s/.test(body.replace(/<[^>]+>/g, ""))) errors.push(pfx + "Markdown heading");
    if (/(?:^|>)\s*[-*+]\s/m.test(body.replace(/<[^>]+>/g, "\n"))) errors.push(pfx + "Markdown bullet");
    if (/(?:^|>)\s*\d+[.)]\s/m.test(body.replace(/<[^>]+>/g, "\n"))) errors.push(pfx + "Markdown numbered list");
    if (/(?:^|>)\s*>/m.test(body.replace(/<[^>]+>/g, "\n"))) errors.push(pfx + "Markdown blockquote");
    if (/`/.test(body)) errors.push(pfx + "Markdown code");
    if (/\*\*[^*]+\*\*/.test(body.replace(/<[^>]+>/g, ""))) errors.push(pfx + "Markdown bold");
    if (/__[^_]+__/.test(body.replace(/<[^>]+>/g, ""))) errors.push(pfx + "Markdown underscore emphasis");

    // ── Strict canonical HTML grammar ────────────────────────────
    const BODY_SAFE_TAGS = new Set(["p", "br", "strong", "b", "em", "i"]);
    const tagMatches = [...body.matchAll(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi)];
    for (const m of tagMatches) {
      const tag = m[1].toLowerCase();
      const attrs = (m[2] ?? "").trim();
      if (tag === "a") { errors.push(pfx + "v1 does not allow <a> links"); break; }
      if (!BODY_SAFE_TAGS.has(tag)) { errors.push(pfx + `unsupported tag <${tag}>`); continue; }
      if (attrs && !/^\/?$/.test(attrs)) errors.push(pfx + `<${tag}> must not have attributes`);
    }
    // Nested <p> (invalid HTML)
    if (/<p[^>]*>(?:(?!<\/p>).)*<p/is.test(body)) errors.push(pfx + "nested <p> tags");
    // Stray closing tags without opener, or spaced variants like < /p>
    if (/<\s+\/?\w/i.test(body)) errors.push(pfx + "malformed spaced tag delimiter");
    // Structural balance
    const balanceErr = checkHtmlBalance(body);
    if (balanceErr) errors.push(pfx + `malformed HTML: ${balanceErr}`);
    // Dangerous HTML
    if (/<script|<style|<iframe|<object|<embed|<form/i.test(body)) errors.push(pfx + "dangerous HTML tag");
    if (/\bon\w+\s*=/i.test(body)) errors.push(pfx + "event-handler attribute");
    if (/javascript\s*:/i.test(body)) errors.push(pfx + "javascript: URL");
    if (/data\s*:/i.test(body)) errors.push(pfx + "data: URL");

    // Visible text required
    const visibleText = body.replace(/<[^>]+>/g, "").replace(/&\w+;/g, " ").replace(/\[\[[^\]]*\]\]/g, "").trim();
    if (!visibleText) errors.push(pfx + "no visible text content");

    // ── Signature: exactly one, exact final <p>[[Signature]]</p> ─
    const sigCount = (body.match(/\[\[Signature\]\]/g) ?? []).length;
    if (sigCount === 0) errors.push(pfx + "missing [[Signature]]");
    else if (sigCount > 1) errors.push(pfx + `${sigCount} [[Signature]] tokens; exactly one required`);
    if (sigCount === 1 && !/<p>\s*\[\[Signature\]\]\s*<\/p>\s*$/.test(body)) {
      errors.push(pfx + "[[Signature]] must be in the exact final <p>[[Signature]]</p>");
    }

    // ── Greeting: first email opens with [[First name]] ──────────
    if (n === 1 && !/^<p>[^<]*\[\[First name\]\]/i.test(body)) {
      errors.push(pfx + "first email must begin with a [[First name]] greeting");
    }

    // ── Word count ───────────────────────────────────────────────
    const wc = wordCount(body);
    const maxWords = n === 1 ? 150 : 100;
    if (wc > maxWords) errors.push(pfx + `body has ${wc} words; limit is ${maxWords}`);

    // ── Categorical claim gate ───────────────────────────────────
    // No structured approved-claim source exists. Safest v1: block all.
    if (/\d[\d,]*\+?\s*(?:healthcare\s+)?(?:organizations?|customers?|clients?|practices?|hospitals?|providers?|facilities|companies)\b/i.test(combined)) {
      errors.push(pfx + "quantitative social-proof claim");
    }
    if (/\b(?:hundreds?|thousands?|millions?)\s+(?:of\s+)?(?:healthcare\s+)?(?:organizations?|customers?|clients?|hospitals?|providers?)\b/i.test(combined)) {
      errors.push(pfx + "spelled-out social-proof claim");
    }
    if (/\d+\s*%/.test(combined)) errors.push(pfx + "percentage claim");
    if (/(?:\b(?:award[- ]?winning|industry[- ]?leading|best[- ]?in[- ]?class|number[- ]?one|top[- ]?rated)\b|(?:^|\s)#1\b)/i.test(combined)) {
      errors.push(pfx + "award/ranking claim");
    }
    if (/\b(?:guarantee[ds]?|certif(?:ied|ication)|testimonial|case\s+stud(?:y|ies)|proven\s+(?:results?|track\s+record|solution)|legally?\s+compliant|ensures?\s+compliance|full(?:y)?\s+compliant|100%|risk[- ]?free|money[- ]?back)\b/i.test(combined)) {
      errors.push(pfx + "guarantee/certification/compliance claim");
    }
    if (/\b(?:eliminates?|prevents?|stops?)\s+(?:all\s+)?(?:breaches?|violations?|fines?|penalties|risks?)\b/i.test(combined)) {
      errors.push(pfx + "capability/outcome claim");
    }
    if (/\b(?:act\s+now|don[''\u2019]t\s+miss|limited\s+time|deadline|expires?\s+soon|last\s+chance|urgent|hurry|while\s+supplies?\s+last)\b/i.test(combined)) {
      errors.push(pfx + "urgency/deadline language");
    }
  }

  return errors;
}
