/**
 * CRM Branding Configuration
 *
 * Change these values to white-label the CRM for any company/industry.
 * This is the ONLY file you need to edit to rebrand the entire application.
 */

export const branding = {
  /** Company name shown in sidebar, login, page titles */
  companyName: "Medcurity",

  /** Product name shown next to company name */
  productName: "PulsePoint",

  /** Full product title (sidebar header) */
  fullTitle: "PulsePoint",

  /** Login page subtitle */
  loginSubtitle: "Sign in to your account",

  /** Short company name for collapsed sidebar */
  shortName: "P",

  /** Industry context — affects default field labels and terminology */
  industry: "healthcare" as "healthcare" | "saas" | "finance" | "consulting" | "general",

  /** Default account lifecycle stages */
  lifecycleLabels: {
    prospect: "Prospect",
    customer: "Customer",
    former_customer: "Former Customer",
  },

  /** Default opportunity stages — customize per sales process */
  stageLabels: {
    lead: "Lead",
    qualified: "Qualified",
    proposal: "Proposal",
    verbal_commit: "Verbal Commit",
    closed_won: "Closed Won",
    closed_lost: "Closed Lost",
  },

  /** Primary color (HSL) — changes the entire color scheme */
  primaryColor: "215 97% 52%",

  /** Whether to show the "Renewals" section (subscription businesses) */
  showRenewals: true,

  /** Whether to show the "Pipeline" section */
  showPipeline: true,

  /** Default currency */
  currency: "USD",

  /** Date format preference */
  dateFormat: "MMM d, yyyy",

  /** Company website (shown in login footer, optional) */
  companyUrl: "https://medcurity.com",

  /** Support email */
  supportEmail: "support@medcurity.com",
} as const;

/**
 * Quick rebrand helper — call this with a config object to override defaults:
 *
 * Example for a SaaS company:
 * ```
 * rebrand({
 *   companyName: "Acme",
 *   productName: "Sales Hub",
 *   shortName: "A",
 *   industry: "saas",
 *   primaryColor: "262 83% 58%", // purple
 *   showRenewals: true,
 * });
 * ```
 */
export type BrandingConfig = typeof branding;
