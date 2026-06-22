import { z } from "zod";

export const contactSchema = z.object({
  // Optional: a contact may be account-less (individual, unknown company).
  // The form's "no account" sentinel and "" both resolve to null on submit.
  account_id: z.string().optional(),
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  email2: z.string().email("Invalid email").optional().or(z.literal("")),
  email3: z.string().email("Invalid email").optional().or(z.literal("")),
  title: z.string().optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  department: z.string().optional().or(z.literal("")),
  linkedin_url: z
    .string()
    .url("Must be a valid URL")
    .optional()
    .or(z.literal("")),
  do_not_contact: z.boolean(),
  do_not_call: z.boolean(),
  no_longer_employed: z.boolean(),
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
}).superRefine((v, ctx) => {
  // Up to 3 emails total, none duplicated, slot 2 filled before slot 3.
  // Mirrors the DB constraints so the user gets a friendly message first.
  const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
  const e1 = norm(v.email), e2 = norm(v.email2), e3 = norm(v.email3);
  if (e3 && !e2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email3"], message: "Add a second email before a third." });
  }
  if (e2 && e2 === e1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email2"], message: "Same as the primary email." });
  }
  if (e3 && e3 === e1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email3"], message: "Same as the primary email." });
  }
  if (e3 && e2 && e3 === e2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email3"], message: "Same as the second email." });
  }
});

export type ContactFormValues = z.input<typeof contactSchema>;
