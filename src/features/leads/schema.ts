import { z } from "zod";

export const leadSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Must be a valid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  mobile_phone: z.string().optional().or(z.literal("")),
  do_not_contact: z.boolean().optional(),
  company: z.string().optional().or(z.literal("")),
  title: z.string().optional().or(z.literal("")),
  industry: z.string().optional().or(z.literal("")),
  website: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  status: z.enum(["new", "contacted", "qualified", "unqualified", "converted"]),
  source: z
    .enum([
      "website",
      "referral",
      "cold_call",
      "trade_show",
      "partner",
      "social_media",
      "email_campaign",
      "webinar",
      "podcast",
      "conference",
      "sql",
      "mql",
      "other",
    ])
    .optional()
    .or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  employees: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  annual_revenue: z.coerce.number().nonnegative().optional().or(z.literal("")),
  owner_user_id: z.string().uuid().nullable().optional(),
  // Address
  street: z.string().optional().or(z.literal("")),
  city: z.string().optional().or(z.literal("")),
  state: z.string().optional().or(z.literal("")),
  zip: z.string().optional().or(z.literal("")),
  country: z.string().optional().or(z.literal("")),
  // Qualification
  qualification: z.enum(["unqualified", "mql", "sql", "sal"]).optional(),
  score: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  mql_date: z.string().optional().or(z.literal("")),
  // Compliance
  do_not_market_to: z.boolean().optional(),
  // Phase 1 SF-parity additions
  credential: z
    .enum([
      "md", "do", "rn", "lpn", "np", "pa",
      "chc", "chps", "chpc", "hipaa_certified",
      "ceo", "cfo", "coo", "cio", "cto", "ciso", "cmo",
      "it_director", "practice_manager", "office_manager",
      "compliance_officer", "privacy_officer", "security_officer",
      "other",
    ])
    .optional()
    .nullable()
    .or(z.literal("")),
  phone_ext: z.string().optional().or(z.literal("")),
  time_zone: z
    .enum(["eastern", "central", "mountain", "pacific", "alaska", "hawaii", "arizona_no_dst"])
    .optional()
    .nullable()
    .or(z.literal("")),
  type: z
    .enum([
      "inbound_website", "inbound_referral",
      "outbound_cold", "purchased_list",
      "conference", "webinar",
      "partner", "existing_customer_expansion",
      "other",
    ])
    .optional()
    .nullable()
    .or(z.literal("")),
  priority_lead: z.boolean().optional(),
  project: z.string().optional().or(z.literal("")),
  business_relationship_tag: z
    .enum([
      "decision_maker", "influencer", "economic_buyer",
      "technical_buyer", "champion", "detractor",
      "end_user", "gatekeeper",
      "executive_sponsor", "other",
    ])
    .optional()
    .nullable()
    .or(z.literal("")),
  linkedin_url: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  cold_lead: z.boolean().optional(),
  cold_lead_source: z.string().optional().or(z.literal("")),
  rating: z.enum(["hot", "warm", "cold"]).optional().nullable().or(z.literal("")),
  industry_category: z
    .enum([
      "hospital","medical_group","fqhc","rural_health_clinic","skilled_nursing",
      "long_term_care","home_health","hospice","behavioral_health","dental",
      "pediatrics","specialty_clinic","urgent_care","imaging_center","lab_services",
      "pharmacy","telemedicine","tribal_health","public_health_agency",
      "healthcare_it_vendor","managed_service_provider","healthcare_consulting",
      "insurance_payer","other_healthcare","other",
    ])
    .optional().nullable().or(z.literal("")),
  project_segment: z
    .enum([
      "rural_hospital","community_hospital","enterprise","medium_sized","small_sized",
      "fqhc","voa","franchise","strategic_partner","it_vendor_third_party",
      "independent_associations","other",
    ])
    .optional().nullable().or(z.literal("")),
  // Custom fields
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export type LeadFormValues = z.input<typeof leadSchema>;
