import { z } from "zod";

export const contactSchema = z.object({
  account_id: z.string().uuid("Account is required"),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  title: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  department: z.string().optional().or(z.literal("")),
  linkedin_url: z
    .string()
    .url("Must be a valid URL")
    .optional()
    .or(z.literal("")),
  do_not_contact: z.boolean(),
  mailing_street: z.string().optional().or(z.literal("")),
  mailing_city: z.string().optional().or(z.literal("")),
  mailing_state: z.string().optional().or(z.literal("")),
  mailing_zip: z.string().optional().or(z.literal("")),
  mailing_country: z.string().optional().or(z.literal("")),
  is_primary: z.boolean(),
  owner_user_id: z.string().uuid().nullable().optional(),
  lead_source: z.string().nullable().optional(),
  mql_date: z.string().optional().or(z.literal("")),
  sql_date: z.string().optional().or(z.literal("")),
  // Picklist-backed fields. Source of truth is public.picklist_options
  // (admin-editable) + the Postgres enum on the column. Keeping a second
  // hardcoded list in zod made saves silently fail whenever the admin
  // added a value here — same regression that hit accounts/leads. Now
  // the schema only validates "is a string"; Postgres rejects garbage
  // at write time and that error surfaces as a visible toast.
  credential: z.string().optional().nullable().or(z.literal("")),
  phone_ext: z.string().optional().or(z.literal("")),
  mobile_phone: z.string().optional().or(z.literal("")),
  events_attended: z.array(z.string()).optional().nullable(),
  time_zone: z.string().optional().nullable().or(z.literal("")),
  type: z.string().optional().nullable().or(z.literal("")),
  business_relationship_tag: z.string().optional().nullable().or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  next_steps: z.string().optional().or(z.literal("")),
});

export type ContactFormValues = z.input<typeof contactSchema>;
