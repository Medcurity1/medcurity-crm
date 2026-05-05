/**
 * Maps each `industry_category` enum value to keywords that should match the
 * legacy `leads.industry` free-text column. SF-imported leads sit with
 * `industry_category=null` and a free-text value in `industry` (e.g. "Hospital
 * & Health Care", "Rural Hospital", "Behavioral Health Services"), so a naive
 * `industry_category.in.(...)` filter misses most of the back-catalog. Use
 * `buildIndustryOrClause` to OR-match both columns.
 *
 * Keep keywords lowercase, distinctive, and free of `%`, `(`, `)`, or `,` —
 * those characters break PostgREST's `or()` parser.
 */
export const INDUSTRY_LEGACY_KEYWORDS: Record<string, string[]> = {
  behavioral_health: ["behavioral", "mental health"],
  dental: ["dental"],
  fqhc: ["fqhc", "federally qualified"],
  healthcare_consulting: ["consulting"],
  healthcare_it_vendor: ["healthcare it", "health it", "computer software"],
  home_health: ["home health"],
  hospice: ["hospice"],
  hospital: ["hospital"],
  imaging_center: ["imaging", "radiology"],
  insurance_payer: ["insurance", "payer", "payor"],
  lab_services: ["laboratory", "lab services"],
  long_term_care: ["long-term", "long term care"],
  managed_service_provider: ["managed service", "msp"],
  medical_group: ["medical group", "physician group", "medical practice"],
  pediatrics: ["pediatric"],
  pharmacy: ["pharmacy"],
  public_health_agency: ["public health"],
  rural_health_clinic: ["rural"],
  skilled_nursing: ["skilled nursing", "snf", "nursing home"],
  specialty_clinic: ["specialty clinic"],
  telemedicine: ["telemedicine", "telehealth"],
  tribal_health: ["tribal"],
  urgent_care: ["urgent care"],
  other_healthcare: [],
  other: [],
};

/**
 * Builds a PostgREST `or()` clause that matches a lead if EITHER its
 * normalized `industry_category` is in the selected categories, OR its
 * legacy free-text `industry` matches one of the mapped keywords. Returns
 * the comma-separated string ready to pass to `query.or(...)`.
 *
 * Returns null when the input is empty (caller should skip the filter).
 */
export function buildIndustryOrClause(categories: string[]): string | null {
  if (!categories.length) return null;
  const safeCategories = categories
    .map((c) => c.replace(/[(),]/g, ""))
    .join(",");
  const ilikeKeywords = categories
    .flatMap((c) => INDUSTRY_LEGACY_KEYWORDS[c] ?? [])
    .map((kw) => kw.replace(/[(),%]/g, " ").trim())
    .filter(Boolean);
  const clauses = [
    `industry_category.in.(${safeCategories})`,
    ...ilikeKeywords.map((kw) => `industry.ilike.%${kw}%`),
  ];
  return clauses.join(",");
}
