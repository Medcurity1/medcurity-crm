import { z } from "zod";

export const leadSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  // Loose validation: many leads have garbage emails from imported lists
  // (typos, missing @, etc.). Don't block saves on it — just store what
  // they have. Empty string is fine. The zod email validator was hard
  // blocking edit-save when the user hadn't even touched the email field.
  email: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  mobile_phone: z.string().optional().or(z.literal("")),
  do_not_contact: z.boolean().optional(),
  company: z.string().optional().or(z.literal("")),
  title: z.string().optional().or(z.literal("")),
  industry: z.string().optional().or(z.literal("")),
  // Loose: imported websites often missing protocol (e.g. "example.com")
  // and we don't want to block lead-edit saves on a field the user
  // didn't touch.
  website: z.string().optional().or(z.literal("")),
  // Picklist-backed fields: keep these LOOSE. The source of truth is
  // public.picklist_options (admin-editable in Admin → Picklists) plus
  // the Postgres enum on the column itself. A second source of truth in
  // a hardcoded zod enum keeps drifting (e.g. industry_category expanded
  // from 25 → ~80 values on May 6 — accounts/schema.ts got updated,
  // leads/schema.ts didn't, and saves silently failed). z.string() lets
  // any valid picklist value through; Postgres rejects garbage at write
  // time, and that error surfaces in the catch block / onInvalid toast.
  status: z.string().min(1, "Status is required"),
  source: z.string().optional().nullable().or(z.literal("")),
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
  qualification: z.string().optional().nullable().or(z.literal("")),
  score: z.coerce.number().int().nonnegative().optional().or(z.literal("")),
  mql_date: z.string().optional().or(z.literal("")),
  // Compliance
  do_not_market_to: z.boolean().optional(),
  // Phase 1 SF-parity additions — all picklist-backed, so the schema is
  // permissive. See note at the top of `status` above.
  credential: z.string().optional().nullable().or(z.literal("")),
  phone_ext: z.string().optional().or(z.literal("")),
  time_zone: z.string().optional().nullable().or(z.literal("")),
  type: z.string().optional().nullable().or(z.literal("")),
  priority_lead: z.boolean().optional(),
  project: z.string().optional().or(z.literal("")),
  business_relationship_tag: z.string().optional().nullable().or(z.literal("")),
  // Loose: same reason as website.
  linkedin_url: z.string().optional().or(z.literal("")),
  cold_lead: z.boolean().optional(),
  cold_lead_source: z.string().optional().or(z.literal("")),
  rating: z.string().optional().nullable().or(z.literal("")),
  industry_category: z.string().optional().nullable().or(z.literal("")),
  project_segment: z.string().optional().nullable().or(z.literal("")),
  // Custom fields
  custom_fields: z.record(z.string(), z.unknown()).optional(),
});

export type LeadFormValues = z.input<typeof leadSchema>;
