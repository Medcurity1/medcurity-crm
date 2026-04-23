import { z } from "zod";

export const accountSchema = z.object({
  name: z.string().min(1, "Account name is required"),
  lifecycle_status: z.enum(["prospect", "customer", "former_customer"]),
  status: z.enum(["discovery", "pending", "active", "inactive", "churned"]).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  website: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  industry: z.string().optional().or(z.literal("")),
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
  account_type: z.string().optional().or(z.literal("")),
  account_number: z.string().optional().or(z.literal("")),
  parent_account_id: z.string().uuid().nullable().optional(),
  // Contact info
  phone: z.string().optional().or(z.literal("")),
  phone_extension: z.string().optional().or(z.literal("")),
  // Company details
  timezone: z.string().optional().or(z.literal("")),
  employees: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  locations: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  fte_count: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  fte_range: z.enum(["1-20", "21-50", "51-100", "101-250", "251-500", "501-750", "751-1000", "1001-1500", "1501-2000", "2001-5000", "5001-10000"]).optional().or(z.literal("")),
  number_of_providers: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  annual_revenue: z.coerce.number().nonnegative().optional().or(z.literal("")),
  // Contract & Renewal
  active_since: z.string().optional().or(z.literal("")),
  renewal_type: z.enum(["auto_renew", "manual_renew", "no_auto_renew", "full_auto_renew", "platform_only_auto_renew"]).optional().or(z.literal("")),
  every_other_year: z.boolean().optional(),
  contracts: z.string().optional().or(z.literal("")),
  current_contract_start_date: z.string().optional().or(z.literal("")),
  current_contract_end_date: z.string().optional().or(z.literal("")),
  current_contract_length_months: z.coerce.number().int().positive().optional().or(z.literal("")),
  acv: z.coerce.number().nonnegative().optional().or(z.literal("")),
  lifetime_value: z.coerce.number().nonnegative().optional().or(z.literal("")),
  churn_amount: z.coerce.number().nonnegative().optional().or(z.literal("")),
  churn_date: z.string().optional().or(z.literal("")),
  // Billing address
  billing_street: z.string().optional().or(z.literal("")),
  billing_city: z.string().optional().or(z.literal("")),
  billing_state: z.string().optional().or(z.literal("")),
  billing_zip: z.string().optional().or(z.literal("")),
  billing_country: z.string().optional().or(z.literal("")),
  // Shipping address
  shipping_street: z.string().optional().or(z.literal("")),
  shipping_city: z.string().optional().or(z.literal("")),
  shipping_state: z.string().optional().or(z.literal("")),
  shipping_zip: z.string().optional().or(z.literal("")),
  shipping_country: z.string().optional().or(z.literal("")),
  // Partner
  partner_account: z.string().optional().or(z.literal("")),
  partner_prospect: z.boolean().optional(),
  lead_source: z.string().optional().or(z.literal("")),
  lead_source_detail: z.string().optional().or(z.literal("")),
  // Additional
  priority_account: z.boolean().optional(),
  project: z.string().optional().or(z.literal("")),
  project_segment: z
    .enum([
      "rural_hospital","community_hospital","enterprise","medium_sized","small_sized",
      "fqhc","voa","franchise","strategic_partner","it_vendor_third_party",
      "independent_associations","other",
    ])
    .optional().nullable().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  next_steps: z.string().optional().or(z.literal("")),
  // Custom fields
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export type AccountFormValues = z.input<typeof accountSchema>;
