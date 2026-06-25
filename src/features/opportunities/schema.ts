import { z } from "zod";

export const opportunitySchema = z.object({
  account_id: z.string().uuid("Account is required"),
  primary_contact_id: z.string().uuid().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  team: z.enum(["sales", "renewals"]),
  kind: z.enum(["new_business", "renewal"]),
  business_type: z
    .enum([
      "new_business",
      "existing_business",
      "existing_business_new_product",
      "existing_business_new_service",
      "opportunity",
    ])
    .optional().nullable().or(z.literal("")),
  name: z.string().min(1, "Opportunity name is required"),
  stage: z.enum([
    // SF-matching stages (primary)
    "details_analysis",
    "demo",
    "proposal_and_price_quote",
    "proposal_conversation",
    "closed_won",
    "closed_lost",
    // Legacy values — accepted by the schema so existing records
    // that still carry them don't fail validation. Not surfaced
    // in the form picker.
    "lead",
    "qualified",
    "proposal",
    "verbal_commit",
  ]),
  amount: z.coerce.number().min(0, "Amount must be positive"),
  expected_close_date: z.string().optional().or(z.literal("")),
  close_date: z.string().optional().or(z.literal("")),
  contract_start_date: z.string().optional().or(z.literal("")),
  contract_end_date: z.string().optional().or(z.literal("")),
  // Optional numeric picklist fields — must accept undefined / null /
  // empty string. Using `.optional().nullable()` and `.min(0)` (not
  // `.positive()`) matches the pattern of every other optional numeric
  // field on this form (probability, cycle_count, fte_count) so the
  // page-layout "Required" toggle is the only thing that gates them.
  contract_length_months: z
    .preprocess(
      (v) => (v === "" || v === undefined || v === null ? null : v),
      z.coerce.number().int().min(0).nullable(),
    )
    .optional(),
  contract_signed_date: z.string().optional().or(z.literal("")),
  contract_year: z
    .preprocess(
      (v) => (v === "" || v === undefined || v === null ? null : v),
      z.coerce.number().int().min(0).nullable(),
    )
    .optional(),
  loss_reason: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  // New fields
  probability: z.coerce.number().min(0).max(100).optional().nullable(),
  next_step: z.string().optional().or(z.literal("")),
  lead_source: z.enum(["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "sql", "mql", "other"]).optional().nullable(),
  lead_source_detail: z.string().optional().or(z.literal("")),
  payment_frequency: z.enum(["monthly", "quarterly", "semi_annually", "annually", "one_time"]).optional().nullable(),
  cycle_count: z.coerce.number().int().min(0).optional().nullable(),
  auto_renewal: z.boolean().optional(),
  description: z.string().optional().or(z.literal("")),
  promo_code: z.string().optional().or(z.literal("")),
  // Discount can be a PERCENT (0–100) or a flat dollar AMOUNT (the inline
  // DiscountField on the detail page sets the type). No 100 cap here — a flat-$
  // discount can exceed 100 (e.g. $4,300 off). The percent input is UI-capped
  // at 100; recalc_opportunity_amount honors discount_type either way.
  discount: z.coerce.number().min(0).optional().nullable(),
  discount_type: z.enum(["percent", "amount"]).optional().or(z.literal("")),
  subtotal: z.coerce.number().min(0).optional().nullable(),
  follow_up: z.boolean().optional(),
  service_amount: z.coerce.number().min(0).optional().nullable(),
  product_amount: z.coerce.number().min(0).optional().nullable(),
  services_included: z.boolean().optional(),
  one_time_project: z.boolean().optional(),
  // FTE snapshot
  fte_count: z.coerce.number().int().nonnegative().optional().nullable(),
  fte_range: z.enum(["1-20", "21-50", "51-100", "101-250", "251-500", "501-750", "751-1000", "1001-1500", "1501-2000", "2001-5000", "5001-10000"]).optional().or(z.literal("")).nullable(),
  created_by_automation: z.boolean().optional(),
  // Assignment tracking
  assigned_assessor_id: z.string().uuid().nullable().optional(),
  original_sales_rep_id: z.string().uuid().nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export type OpportunityFormValues = z.input<typeof opportunitySchema>;
