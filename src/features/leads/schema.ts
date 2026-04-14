import { z } from "zod";

export const leadSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Must be a valid email").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
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
  // Custom fields
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export type LeadFormValues = z.input<typeof leadSchema>;
