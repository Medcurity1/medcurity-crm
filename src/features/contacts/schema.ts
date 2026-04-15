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
});

export type ContactFormValues = z.input<typeof contactSchema>;
