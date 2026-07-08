import { z } from "zod";
import { blankableNumber } from "@/lib/zodFields";

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
  // blankableNumber keeps a blank input as null (bare z.coerce.number()
  // turned "" into 0), so the admin-required-field gate can flag a blank
  // Amount and clearing it can't silently zero a deal. The DB column is
  // NOT NULL — the form payload maps a null amount back to 0 via
  // Number(values.amount). See src/lib/zodFields.ts.
  amount: blankableNumber(z.coerce.number().min(0, "Amount must be positive")),
  expected_close_date: z.string().optional().or(z.literal("")),
  close_date: z.string().optional().or(z.literal("")),
  contract_start_date: z.string().optional().or(z.literal("")),
  contract_end_date: z.string().optional().or(z.literal("")),
  // Optional numeric fields — must accept undefined / null / empty
  // string, and a blank must stay null (never coerce to 0) so the
  // admin "Required" toggle is the only thing that gates them.
  contract_length_months: blankableNumber(z.coerce.number().int().min(0)),
  contract_signed_date: z.string().optional().or(z.literal("")),
  contract_year: blankableNumber(z.coerce.number().int().min(0)),
  loss_reason: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  // New fields
  probability: blankableNumber(z.coerce.number().min(0).max(100)),
  next_step: z.string().optional().or(z.literal("")),
  lead_source: z.enum(["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "webinar", "podcast", "conference", "sql", "mql", "other"]).optional().nullable(),
  lead_source_detail: z.string().optional().or(z.literal("")),
  payment_frequency: z.enum(["monthly", "quarterly", "semi_annually", "annually", "one_time"]).optional().nullable(),
  cycle_count: blankableNumber(z.coerce.number().int().min(0)),
  auto_renewal: z.boolean().optional(),
  description: z.string().optional().or(z.literal("")),
  promo_code: z.string().optional().or(z.literal("")),
  // Discount can be a PERCENT (0–100) or a flat dollar AMOUNT (the inline
  // DiscountField on the detail page sets the type). A flat-$ discount can
  // exceed 100 (e.g. $4,300 off), but a PERCENT can't exceed 100% — you can't
  // give more than 100% off. The conditional cap is enforced in the
  // superRefine below (we need discount_type to know which rule applies).
  discount: blankableNumber(z.coerce.number().min(0)),
  discount_type: z.enum(["percent", "amount"]).optional().or(z.literal("")),
  subtotal: blankableNumber(z.coerce.number().min(0)),
  follow_up: z.boolean().optional(),
  service_amount: blankableNumber(z.coerce.number().min(0)),
  product_amount: blankableNumber(z.coerce.number().min(0)),
  services_included: z.boolean().optional(),
  one_time_project: z.boolean().optional(),
  // FTE snapshot
  fte_count: blankableNumber(z.coerce.number().int().nonnegative()),
  fte_range: z.enum(["1-20", "21-50", "51-100", "101-250", "251-500", "501-750", "751-1000", "1001-1500", "1501-2000", "2001-5000", "5001-10000"]).optional().or(z.literal("")).nullable(),
  created_by_automation: z.boolean().optional(),
  // Assignment tracking
  assigned_assessor_id: z.string().uuid().nullable().optional(),
  original_sales_rep_id: z.string().uuid().nullable().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
}).superRefine((val, ctx) => {
  // A PERCENT discount can't exceed 100% (you can't give more than 100% off).
  // A flat-dollar ('amount') discount has no such ceiling. Treat an unset type
  // as percent, matching the form/detail defaults.
  const isPercent = !val.discount_type || val.discount_type === "percent";
  if (isPercent && val.discount != null && val.discount > 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["discount"],
      message: "A percent discount can't be more than 100%.",
    });
  }
});

export type OpportunityFormValues = z.input<typeof opportunitySchema>;
