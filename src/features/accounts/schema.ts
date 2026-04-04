import { z } from "zod";

export const accountSchema = z.object({
  name: z.string().min(1, "Account name is required"),
  lifecycle_status: z.enum(["prospect", "customer", "former_customer"]),
  status: z.enum(["discovery", "pending", "active", "inactive", "churned"]).optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  website: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  industry: z.string().optional().or(z.literal("")),
  account_type: z.string().optional().or(z.literal("")),
  // Company details
  timezone: z.string().optional().or(z.literal("")),
  employees: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  locations: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  fte_count: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  fte_range: z.string().optional().or(z.literal("")),
  annual_revenue: z.coerce.number().nonnegative().optional().or(z.literal("")),
  // Contract
  active_since: z.string().optional().or(z.literal("")),
  renewal_type: z.enum(["auto_renew", "manual_renew", "no_auto_renew"]).optional().or(z.literal("")),
  current_contract_start_date: z.string().optional().or(z.literal("")),
  current_contract_end_date: z.string().optional().or(z.literal("")),
  current_contract_length_months: z.coerce.number().int().positive().optional().or(z.literal("")),
  acv: z.coerce.number().nonnegative().optional().or(z.literal("")),
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
  // Notes
  notes: z.string().optional().or(z.literal("")),
  // Custom fields
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export type AccountFormValues = z.input<typeof accountSchema>;
