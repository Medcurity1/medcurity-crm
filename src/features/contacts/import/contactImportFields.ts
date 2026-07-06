// Field registry for the Contact Import wizard: the CRM contact/account
// fields a CSV column can map to, plus header auto-detection. Kept separate
// from playbook/csv.ts (which is campaign-recipient specific) — we reuse
// only its parseCsv().

export type ContactField =
  | "first_name"
  | "last_name"
  | "email"
  | "email2"
  | "email3"
  | "title"
  | "phone"
  | "mobile_phone"
  | "company"
  | "industry"
  | "website"
  | "linkedin_url"
  | "department"
  | "credential"
  | "lead_source"
  | "mailing_street"
  | "mailing_city"
  | "mailing_state"
  | "mailing_zip"
  | "mailing_country"
  | "notes"
  | "do_not_contact"
  | "skip";

export const CONTACT_FIELD_LABEL: Record<ContactField, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  email2: "Second Email",
  email3: "Third Email",
  title: "Title",
  phone: "Phone",
  mobile_phone: "Mobile Phone",
  company: "Company (account)",
  industry: "Industry",
  website: "Website",
  linkedin_url: "LinkedIn URL",
  department: "Department",
  credential: "Credential",
  lead_source: "Lead Source",
  mailing_street: "Street",
  mailing_city: "City",
  mailing_state: "State",
  mailing_zip: "Zip",
  mailing_country: "Country",
  notes: "Notes",
  do_not_contact: "Do Not Contact",
  skip: "Skip this column",
};

// The order fields appear in the mapping dropdown.
export const CONTACT_FIELD_ORDER: ContactField[] = [
  "first_name", "last_name", "email", "email2", "email3",
  "title", "phone", "mobile_phone", "company", "industry", "website",
  "linkedin_url", "department", "credential", "lead_source",
  "mailing_street", "mailing_city", "mailing_state", "mailing_zip", "mailing_country",
  "notes", "do_not_contact", "skip",
];

// Lowercased header synonyms → field. First match wins.
const HEADER_MAP: Record<string, ContactField> = {
  "first name": "first_name", firstname: "first_name", first_name: "first_name", fname: "first_name", "given name": "first_name", given_name: "first_name",
  "last name": "last_name", lastname: "last_name", last_name: "last_name", lname: "last_name", surname: "last_name", "family name": "last_name",
  name: "last_name", "full name": "last_name", fullname: "last_name", "contact name": "last_name",
  email: "email", "e-mail": "email", "email address": "email", emailaddress: "email", email_address: "email", "work email": "email",
  email2: "email2", "email 2": "email2", "second email": "email2", "secondary email": "email2", "alt email": "email2", "personal email": "email2",
  email3: "email3", "email 3": "email3", "third email": "email3",
  title: "title", "job title": "title", jobtitle: "title", position: "title", role: "title",
  phone: "phone", "phone number": "phone", telephone: "phone", "work phone": "phone", "office phone": "phone", "direct phone": "phone", "direct line": "phone",
  mobile: "mobile_phone", "mobile phone": "mobile_phone", cell: "mobile_phone", "cell phone": "mobile_phone",
  company: "company", "company name": "company", companyname: "company", organization: "company", org: "company", account: "company", employer: "company", practice: "company",
  industry: "industry",
  website: "website", web: "website", url: "website", domain: "website",
  linkedin: "linkedin_url", "linkedin url": "linkedin_url", "linkedin profile": "linkedin_url",
  department: "department", dept: "department",
  credential: "credential", credentials: "credential", degree: "credential", license: "credential",
  "lead source": "lead_source", source: "lead_source",
  street: "mailing_street", address: "mailing_street", "mailing street": "mailing_street", address1: "mailing_street", "address line 1": "mailing_street", "street address": "mailing_street",
  city: "mailing_city", "mailing city": "mailing_city", town: "mailing_city",
  state: "mailing_state", "mailing state": "mailing_state", province: "mailing_state", region: "mailing_state",
  zip: "mailing_zip", zipcode: "mailing_zip", "zip code": "mailing_zip", "postal code": "mailing_zip", postal: "mailing_zip", "mailing zip": "mailing_zip",
  country: "mailing_country", "mailing country": "mailing_country",
  notes: "notes", note: "notes", comments: "notes", comment: "notes",
  "do not contact": "do_not_contact", "do_not_contact": "do_not_contact", dnc: "do_not_contact", "opt out": "do_not_contact", "opted out": "do_not_contact", unsubscribe: "do_not_contact", unsubscribed: "do_not_contact",
};

export function guessContactField(header: string): ContactField {
  return HEADER_MAP[header.trim().toLowerCase()] ?? "skip";
}

// CSV truthy values → boolean for do_not_contact.
export function parseBoolish(v: string | undefined): boolean {
  if (!v) return false;
  return ["true", "yes", "y", "1", "x", "t"].includes(v.trim().toLowerCase());
}

// Which fields carry the values used to dedup an incoming row (primary email).
export function primaryEmailOf(record: Record<string, unknown>): string | null {
  const e = (record.email as string) || (record.email2 as string) || (record.email3 as string) || "";
  const trimmed = e.trim().toLowerCase();
  return trimmed || null;
}
