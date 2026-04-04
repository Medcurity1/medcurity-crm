import { z } from "zod";

export const opportunitySchema = z.object({
  account_id: z.string().uuid("Account is required"),
  primary_contact_id: z.string().uuid().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  team: z.enum(["sales", "renewals"]),
  kind: z.enum(["new_business", "renewal"]),
  name: z.string().min(1, "Opportunity name is required"),
  stage: z.enum(["lead", "qualified", "proposal", "verbal_commit", "closed_won", "closed_lost"]),
  amount: z.coerce.number().min(0, "Amount must be positive"),
  expected_close_date: z.string().optional().or(z.literal("")),
  close_date: z.string().optional().or(z.literal("")),
  contract_start_date: z.string().optional().or(z.literal("")),
  contract_end_date: z.string().optional().or(z.literal("")),
  contract_length_months: z.coerce.number().int().positive().optional().or(z.literal(0)),
  contract_year: z.coerce.number().int().positive().optional().or(z.literal(0)),
  loss_reason: z.string().optional().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  // New fields
  probability: z.coerce.number().min(0).max(100).optional().nullable(),
  next_step: z.string().optional().or(z.literal("")),
  lead_source: z.enum(["website", "referral", "cold_call", "trade_show", "partner", "social_media", "email_campaign", "other"]).optional().nullable(),
  payment_frequency: z.enum(["monthly", "quarterly", "semi_annually", "annually", "one_time"]).optional().nullable(),
  cycle_count: z.coerce.number().int().min(0).optional().nullable(),
  auto_renewal: z.boolean().optional(),
  description: z.string().optional().or(z.literal("")),
  promo_code: z.string().optional().or(z.literal("")),
  discount: z.coerce.number().min(0).optional().nullable(),
  subtotal: z.coerce.number().min(0).optional().nullable(),
  follow_up: z.boolean().optional(),
  service_amount: z.coerce.number().min(0).optional().nullable(),
  product_amount: z.coerce.number().min(0).optional().nullable(),
  services_included: z.boolean().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export type OpportunityFormValues = z.input<typeof opportunitySchema>;
