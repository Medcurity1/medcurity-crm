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
  // Phase 1 SF-parity additions
  credential: z
    .enum([
      "md", "do", "rn", "lpn", "np", "pa",
      "chc", "chps", "chpc", "hipaa_certified",
      "ceo", "cfo", "coo", "cio", "cto", "ciso", "cmo",
      "it_director", "practice_manager", "office_manager",
      "compliance_officer", "privacy_officer", "security_officer",
      "other",
    ])
    .optional()
    .nullable()
    .or(z.literal("")),
  phone_ext: z.string().optional().or(z.literal("")),
  time_zone: z
    .enum(["eastern", "central", "mountain", "pacific", "alaska", "hawaii", "arizona_no_dst"])
    .optional()
    .nullable()
    .or(z.literal("")),
  type: z
    .enum(["prospect", "customer", "partner", "vendor", "referral_source", "internal", "other"])
    .optional()
    .nullable()
    .or(z.literal("")),
  business_relationship_tag: z
    .enum([
      "decision_maker", "influencer", "economic_buyer",
      "technical_buyer", "champion", "detractor",
      "end_user", "gatekeeper",
      "executive_sponsor", "other",
    ])
    .optional()
    .nullable()
    .or(z.literal("")),
  notes: z.string().optional().or(z.literal("")),
  next_steps: z.string().optional().or(z.literal("")),
});

export type ContactFormValues = z.input<typeof contactSchema>;
